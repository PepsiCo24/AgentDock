import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, InputError } from '../src/core.mjs';
import { Runner } from '../src/agents.mjs';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for run');
    await delay(10);
  }
}
function setup(t, agentId = 'demo', maxConcurrent = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-history-'));
  const projectDir = path.join(dir, 'project');
  fs.mkdirSync(projectDir);
  const dataDir = path.join(dir, 'data');
  const store = new Store({ dataDir });
  const p = store.addProject({ name: 'History', path: projectDir });
  const s = store.addSession({ projectId: p.id, agentId });
  const runner = new Runner(store, {
    demoDelay: 75, maxConcurrent, maxRunMs: 2500,
    spawnImpl: (cmd, args, options) => spawn(process.execPath, [fixture, cmd, ...args], options)
  });
  t.after(async () => {
    for (const id of new Set([...runner.active.keys(), ...runner.awaiting.keys()])) runner.stop(id);
    await until(() => runner.active.size === 0, 2000).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, projectDir, dataDir, store, p, s, runner };
}

test('runs are recorded, paginated, persisted and exclude queued prompt data in session views', async t => {
  const { store, s, runner, dataDir } = setup(t);
  const first = runner.send(s.id, 'first task');
  const second = runner.send(s.id, 'second task');
  assert.match(first.jobId, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.jobId, second.jobId);
  assert.equal(store.sessionView(s.id).runs, undefined);
  assert.equal(store.sessions()[0].runs, undefined);
  assert.equal(store.runs(s.id).items[0].status, 'queued');
  await until(() => store.runs(s.id).items.every(r => r.status === 'completed'));
  const page1 = store.runs(s.id, { offset: 0, limit: 1 });
  const page2 = store.runs(s.id, { offset: 1, limit: 1 });
  assert.equal(page1.total, 2);
  assert.equal(page1.items.length, 1);
  assert.notEqual(page1.items[0].id, page2.items[0].id);
  assert.equal(new Store({ dataDir }).runs(s.id).items.length, 2);
  assert.throws(() => store.runs(s.id, { limit: 51 }), InputError);
  assert.throws(() => store.runs(s.id, { offset: -1 }), InputError);
});

test('rejected and cancelled jobs have terminal, non-retryable audit records', async t => {
  const { store, s, runner } = setup(t);
  const waiting = runner.send(s.id, 'edit project', [], 'edit');
  assert.equal(store.runs(s.id).items[0].status, 'awaiting_approval');
  runner.reject(s.id, waiting.jobId);
  assert.equal(store.runs(s.id).items[0].status, 'rejected');
  assert.equal(store.runs(s.id).items[0].retryable, false);
  const ongoing = runner.send(s.id, 'running read');
  const queued = runner.send(s.id, 'cancel queued read');
  runner.stop(s.id);
  await until(() => store.runs(s.id).items.find(r => r.id === ongoing.jobId)?.status === 'stopped');
  assert.equal(store.runs(s.id).items.find(r => r.id === queued.jobId).status, 'stopped');
  assert.throws(() => runner.retry(s.id, waiting.jobId), err => err instanceof InputError && err.status === 409);
});

test('failed fake CLI job can retry only with explicit invocation', async t => {
  const { store, s, runner } = setup(t, 'claude');
  const original = runner.send(s.id, 'Please fail');
  await until(() => s.status === 'failed');
  const failed = store.runs(s.id).items.find(r => r.id === original.jobId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryable, true);
  assert.ok(failed.finishedAt);
  assert.equal(store.runs(s.id).total, 1); // No implicit retry.
  const retry = runner.retry(s.id, original.jobId);
  assert.notEqual(retry.jobId, original.jobId);
  await until(() => store.runs(s.id).items.find(r => r.id === retry.jobId)?.status === 'failed');
  assert.equal(store.runs(s.id).items[0].retryOf, original.jobId);
});

test('a retried edit command gets a new approval, not the old approval', async t => {
  const { store, s, runner } = setup(t, 'claude');
  const first = runner.send(s.id, 'Please fail', [], 'edit');
  runner.approve(s.id, first.jobId);
  await until(() => s.status === 'failed');
  const second = runner.retry(s.id, first.jobId);
  assert.equal(s.status, 'awaiting_approval');
  assert.equal(s.pendingApproval.id, second.jobId);
  assert.equal(store.runs(s.id).items[0].status, 'awaiting_approval');
  assert.equal(store.runs(s.id).items[0].approvedAt, null);
  runner.reject(s.id, second.jobId);
});

test('startup invalidates queued, running and awaiting approval history without replay', async t => {
  const { store, p, s, runner, dataDir } = setup(t, 'demo', 1);
  const s2 = store.addSession({ projectId: p.id, agentId: 'demo' });
  const s3 = store.addSession({ projectId: p.id, agentId: 'demo' });
  const a = runner.send(s.id, 'run long');
  const b = runner.send(s2.id, 'queued long');
  const c = runner.send(s3.id, 'approval pending', [], 'edit');
  // With concurrency limit reached, approval is still queued and not granted.
  assert.equal(s.status, 'running');
  assert.equal(s2.status, 'queued');
  assert.equal(s3.status, 'queued');
  const resumed = new Store({ dataDir });
  for (const [sessionId, jobId] of [[s.id, a.jobId], [s2.id, b.jobId], [s3.id, c.jobId]]) {
    assert.equal(resumed.session(sessionId).status, 'interrupted');
    assert.equal(resumed.session(sessionId).queue.length, 0);
    assert.equal(resumed.runs(sessionId).items.find(r => r.id === jobId).status, 'interrupted');
  }
  assert.equal(new Runner(resumed).active.size, 0);
  runner.stop(s.id); runner.stop(s2.id); runner.stop(s3.id);
});

test('explicit retry fails safely when a previous attachment disappeared', async t => {
  const { store, s, runner, projectDir } = setup(t, 'claude');
  fs.writeFileSync(path.join(projectDir, 'input.txt'), 'hello');
  const first = runner.send(s.id, 'Please fail', ['input.txt']);
  await until(() => s.status === 'failed');
  fs.unlinkSync(path.join(projectDir, 'input.txt'));
  assert.throws(() => runner.retry(s.id, first.jobId), InputError);
  assert.equal(store.runs(s.id).total, 1);
});

test('V0.3 lastRun migrates into non-retryable metadata without losing messages', t => {
  const { store, s, dataDir } = setup(t);
  store.addMessage(s, 'user', 'legacy request');
  s.lastRun = { mode: 'edit', workspaceMode: 'worktree', outcome: 'completed',
    startedAt: '2026-11-17T08:00:00Z', finishedAt: '2026-11-17T08:00:02Z', durationMs: 2000 };
  delete s.runs;
  store.save();
  const next = new Store({ dataDir });
  assert.equal(next.runs(s.id).total, 1);
  assert.equal(next.runs(s.id).items[0].status, 'completed');
  assert.equal(next.runs(s.id).items[0].retryable, false);
  assert.equal(next.session(s.id).messages[0].text, 'legacy request');
});

test('explicit retry after restart creates a new task, never revives stale approval', async t => {
  const { store, s, dataDir, runner } = setup(t, 'demo');
  const a = runner.send(s.id, 'incomplete task', [], 'edit');
  assert.equal(s.status, 'awaiting_approval');
  const restored = new Store({ dataDir });
  const second = new Runner(restored, { demoDelay: 20 });
  const old = restored.runs(s.id).items[0];
  assert.equal(old.status, 'interrupted');
  assert.equal(old.retryable, true);
  const b = second.retry(s.id, a.jobId);
  assert.notEqual(b.jobId, a.jobId);
  assert.equal(restored.session(s.id).status, 'awaiting_approval');
  assert.equal(restored.session(s.id).pendingApproval.id, b.jobId);
  assert.throws(() => second.approve(s.id, a.jobId), InputError);
  second.reject(s.id, b.jobId);
  runner.stop(s.id);
});
