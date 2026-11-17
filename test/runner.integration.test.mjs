import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, InputError } from '../src/core.mjs';
import { Runner, buildInvocation, interpretEvent } from '../src/agents.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'fake-agent.mjs');
function setup(t, agent = 'demo', demoDelay = 20) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store({ dataDir: path.join(dir, 'data') });
  const p = store.addProject({ name: 'A', path: dir });
  const s = store.addSession({ agentId: agent, projectId: p.id });
  const spawnImpl = (cmd, args, opts) => spawn(process.execPath, [fixture, cmd, ...args], opts);
  const runner = new Runner(store, { demoDelay, spawnImpl, maxRunMs: 5000 });
  t.after(async () => {
    for (const id of [...runner.active.keys(), ...runner.awaiting.keys()]) runner.stop(id);
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  return { dir, store, p, s, runner };
}
const delay = n => new Promise(resolve => setTimeout(resolve, n));
async function until(fn, ms = 2500) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await delay(12);
  }
}

test('plan tasks execute immediately and edit tasks wait for job-specific approval', async t => {
  const { s, runner } = setup(t);
  const task = runner.send(s.id, 'Write code', [], 'edit');
  assert.equal(task.approvalRequired, true);
  assert.equal(s.status, 'awaiting_approval');
  assert.equal(s.messages.filter(m => m.role === 'assistant').length, 0);
  assert.throws(() => runner.approve(s.id, 'stale-id'), InputError);
  const id = s.pendingApproval.id;
  runner.approve(s.id, id);
  await until(() => s.status === 'idle');
  assert.equal(s.lastRun.mode, 'edit');
  assert.equal(s.lastRun.outcome, 'completed');
  assert.equal(s.messages.filter(m => m.role === 'assistant').length, 1);
  assert.throws(() => runner.approve(s.id, id), InputError);
});

test('rejecting edit does not spawn a process and continues queued plans', async t => {
  const { s, runner } = setup(t);
  runner.send(s.id, 'Do risky action', [], 'edit');
  runner.send(s.id, 'Please analyze', [], 'plan');
  const id = s.pendingApproval.id;
  assert.equal(s.queue.length, 1);
  runner.reject(s.id, id);
  await until(() => s.status === 'idle' && s.messages.some(m => m.role === 'assistant'));
  assert.match(s.messages.find(m => m.role === 'system').text, /拒绝/);
  assert.equal(s.lastRun.mode, 'plan');
});

test('restarting never resumes an old approval or queued prompt', t => {
  const { s, store, runner, dir } = setup(t);
  runner.send(s.id, 'do edit', [], 'edit');
  assert.equal(s.status, 'awaiting_approval');
  const second = new Store({ dataDir: path.join(dir, 'data') });
  assert.equal(second.session(s.id).status, 'interrupted');
  assert.equal(second.session(s.id).pendingApproval, null);
  assert.equal(second.session(s.id).queue.length, 0);
  assert.throws(() => new Runner(second).approve(s.id, s.pendingApproval.id), InputError);
  runner.stop(s.id);
});

test('file search ignores private tree and symbolic links', t => {
  const { p, dir, store } = setup(t);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'README.demo.md'), '# hi');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'README-hidden.md'), 'not visible');
  fs.symlinkSync(os.tmpdir(), path.join(dir, 'outside'));
  assert.deepEqual(store.searchFiles(p.id, 'readme').map(x => x.path), ['src/README.demo.md']);
  assert.throws(() => store.searchFiles(p.id, ''), InputError);
});

test('CLI flags scope permissions and do not enable bypass switches', () => {
  for (const agentId of ['codex', 'claude', 'antigravity']) {
    const read = buildInvocation({ agentId, remoteId: null }, '/project', 'Plan', 'plan');
    const edit = buildInvocation({ agentId, remoteId: 'my-session' }, '/project', 'Edit', 'edit');
    assert.ok(read.args.includes('plan') || read.args.includes('read-only'));
    assert.ok(edit.args.includes('workspace-write') || edit.args.includes('acceptEdits') || edit.args.includes('accept-edits'));
    assert.doesNotMatch(edit.args.join(' '), /dangerously|yolo|bypass/i);
    assert.ok(edit.args.includes('my-session'));
  }
});

test('event interpreter redacts raw tool command and retains safe usage', () => {
  const raw = { type: 'item.started', item: { type: 'command_execution', command: 'SECRET_VALUE' } };
  assert.doesNotMatch(JSON.stringify(interpretEvent('codex', raw)), /SECRET_VALUE/);
  const token = interpretEvent('codex', { type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 2, nonsense: 'SECRET' } });
  assert.deepEqual(token.usage, { input_tokens: 4, output_tokens: 2 });
});

for (const [agent, expected] of [['codex', 'Codex simulated answer'], ['claude', 'Claude simulated answer'], ['antigravity', 'Antigravity simulated answer']]) {
  test(`${agent} fake NDJSON subprocess streams events and captures usage`, async t => {
    const { s, runner } = setup(t, agent);
    runner.send(s.id, 'Please analyze this', [], 'plan');
    await until(() => s.lastRun?.outcome === 'completed');
    assert.equal(s.messages.find(m => m.role === 'assistant').text, expected);
    assert.ok(s.remoteId?.startsWith('fake-'));
    assert.ok(s.lastRun.usage.input_tokens > 0);
    assert.doesNotMatch(JSON.stringify(s.activity), /PRIVATE_TOKEN/);
    assert.ok(s.lastRun.durationMs >= 0);
  });
}

test('failed subprocess sets failed state without exposing stderr', async t => {
  const { s, runner } = setup(t, 'claude');
  runner.send(s.id, 'Please fail');
  await until(() => s.status === 'failed');
  assert.equal(s.lastRun.outcome, 'failed');
  assert.ok(s.messages.find(m => m.role === 'system'));
});

test('stop sends signal to fake subprocess and clears pending queue', async t => {
  const { s, runner } = setup(t, 'codex');
  runner.send(s.id, 'slow task');
  runner.send(s.id, 'next task');
  await until(() => s.remoteId === 'fake-codex-session');
  assert.equal(runner.stop(s.id).stopped, true);
  await until(() => s.status === 'stopped');
  assert.equal(s.queue.length, 0);
  assert.equal(s.lastRun.outcome, 'stopped');
});
