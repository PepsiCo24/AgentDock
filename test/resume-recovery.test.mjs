import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, InputError } from '../src/core.mjs';
import { Runner } from '../src/agents.mjs';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Task did not finish');
    await delay(15);
  }
}
function setup(t, agentId = 'codex') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-reset-'));
  const store = new Store({ dataDir: path.join(dir, 'data') });
  const project = store.addProject({ name: 'Reset Test', path: dir });
  const session = store.addSession({ projectId: project.id, agentId });
  const calls = [];
  const runner = new Runner(store, { demoDelay: 150, maxRunMs: 3000,
    spawnImpl: (cmd, args, opts) => {
      calls.push({ cmd, args });
      return spawn(process.execPath, [fixture, cmd, ...args], opts);
    }
  });
  t.after(async () => {
    for (const id of [...runner.active.keys(), ...runner.awaiting.keys()]) runner.stop(id);
    await until(() => runner.active.size === 0, 2000).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store, session, runner, calls };
}

test('reset is explicit, persists to disk and next task starts a fresh CLI thread', async t => {
  const { dir, store, session, runner, calls } = setup(t);
  runner.send(session.id, 'initial');
  await until(() => session.lastRun?.outcome === 'completed');
  const old = session.remoteId;
  assert.equal(old, 'fake-codex-session');
  assert.throws(() => runner.resetRemote(session.id, 'old-stale-tab-id'), InputError);
  assert.equal(runner.resetRemote(session.id, old).reset, true);
  assert.equal(session.remoteId, null);
  assert.ok(session.messages.some(m => m.role === 'assistant'));
  assert.equal(new Store({ dataDir: path.join(dir, 'data') }).session(session.id).remoteId, null);
  assert.throws(() => runner.resetRemote(session.id, old), InputError);
  runner.send(session.id, 'fresh task');
  await until(() => session.lastRun?.outcome === 'completed' && calls.length >= 2);
  assert.equal(calls.length, 2);
  assert.ok(!calls[1].args.includes('resume'));
  assert.equal(store.runs(session.id).items[0].resumeMode, 'new');
});

test('cannot disconnect remote context while an Agent is running', async t => {
  const { session, runner } = setup(t);
  session.remoteId = 'known-id';
  runner.send(session.id, 'slow task');
  await until(() => session.status === 'running');
  assert.throws(() => runner.resetRemote(session.id, 'known-id'), InputError);
  assert.equal(session.remoteId, 'known-id');
  runner.stop(session.id);
  await until(() => session.status === 'stopped');
});

test('queued and awaiting-approval sessions cannot reset context', async t => {
  const { session, runner } = setup(t);
  session.remoteId = 'known-id';
  runner.send(session.id, 'edit task', [], 'edit');
  assert.equal(session.status, 'awaiting_approval');
  assert.throws(() => runner.resetRemote(session.id, 'known-id'), InputError);
  runner.send(session.id, 'queued after approval');
  assert.throws(() => runner.resetRemote(session.id, 'known-id'), InputError);
  runner.stop(session.id);
});

test('failed resumed run warns without auto-reset or replaying the task', async t => {
  const { session, runner, calls, store } = setup(t, 'claude');
  session.remoteId = 'known-id';
  runner.send(session.id, 'Please fail');
  await until(() => session.lastRun?.outcome === 'failed');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('--resume'));
  const latest = store.runs(session.id).items[0];
  assert.equal(latest.resumeMode, 'resume');
  assert.equal(latest.resumeWarning, true);
  await delay(100);
  assert.equal(calls.length, 1, 'must not silently replay failed or partially completed work');
});

test('structured CLI version diagnostics do not read credentials', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/diagnose.mjs');
  const result = spawnSync(process.execPath, [file, '--json'], { encoding: 'utf8', timeout: 6000,
    env: { ...process.env, A_SECRET_TEST_VALUE: 'never-output-this-secret-value' } });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.authentication, 'not-checked');
  assert.equal(report.compatibility, 'not-verified');
  assert.equal(report.agents.length, 4);
  assert.ok(report.agents.every(x => !('path' in x) && !('env' in x)));
  assert.doesNotMatch(JSON.stringify(report), /never-output-this-secret-value/);
  assert.notEqual(spawnSync(process.execPath, [file, '--invalid'], { encoding: 'utf8' }).status, 0);
});
