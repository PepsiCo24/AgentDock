import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, InputError, within, resolveProjectFile } from '../src/core.mjs';
import { Runner, interpretEvent, buildInvocation } from '../src/agents.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-test-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('within correctly checks directory boundary', () => {
  assert.equal(within('/project', '/project/src/main.js'), true);
  assert.equal(within('/project', '/project-evil/x'), false);
  assert.equal(within('/project', '/tmp/x'), false);
});

test('project file resolution refuses traversal and symlink escape', t => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'safe.txt'), 'hello');
  assert.equal(resolveProjectFile(root, 'safe.txt'), fs.realpathSync(path.join(root, 'safe.txt')));
  assert.throws(() => resolveProjectFile(root, '../other.txt'), InputError);
  assert.throws(() => resolveProjectFile(root, '/etc/passwd'), InputError);
  assert.throws(() => resolveProjectFile(root, 'missing.txt'), InputError);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'outside'));
  assert.throws(() => resolveProjectFile(root, 'outside'), InputError);
});

test('Store persists projects, sessions and messages', t => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'main.js'), 'console.log("hello")');
  const store = new Store({ dataDir: path.join(root, 'data') });
  const p = store.addProject({ name: 'Demo', path: projectDir });
  assert.equal(store.addProject({ name: 'Again', path: projectDir }).id, p.id);
  const session = store.addSession({ agentId: 'demo', projectId: p.id });
  store.addMessage(session, 'user', 'Hello');
  assert.equal(store.session(session.id).messages.length, 1);
  assert.equal(store.files(p.id).length, 1);
  assert.throws(() => store.addSession({ agentId: 'invalid', projectId: p.id }), InputError);
  const reloaded = new Store({ dataDir: path.join(root, 'data') });
  assert.equal(reloaded.session(session.id).messages[0].text, 'Hello');
});

test('Runner queues same-session messages, persists results', async t => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store({ dataDir: path.join(root, 'data') });
  const project = store.addProject({ name: 'Test', path: root });
  const session = store.addSession({ agentId: 'demo', projectId: project.id });
  const runner = new Runner(store, { demoDelay: 25 });
  runner.send(session.id, 'first');
  assert.equal(runner.send(session.id, 'second').queued, true);
  await delay(110);
  assert.equal(session.status, 'idle');
  assert.equal(session.messages.filter(m => m.role === 'assistant').length, 2);
  assert.equal(session.queue.length, 0);
});

test('Stopping demo does not hang and clears queue', async t => {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store({ dataDir: path.join(root, 'data') });
  const p = store.addProject({ name: 'Test', path: root });
  const s = store.addSession({ agentId: 'demo', projectId: p.id });
  const runner = new Runner(store, { demoDelay: 500 });
  runner.send(s.id, 'first');
  runner.send(s.id, 'second');
  assert.equal(runner.stop(s.id).stopped, true);
  await delay(30);
  assert.equal(s.status, 'stopped');
  assert.equal(s.queue.length, 0);
  assert.equal(s.messages.filter(m => m.role === 'assistant').length, 0);
});

test('CLI arguments and stream events preserve session IDs and displayed result', () => {
  assert.deepEqual(buildInvocation({ agentId: 'codex', remoteId: null }, '/project', 'do it').args.slice(0, 3), ['exec', '--json', '--sandbox']);
  assert.ok(buildInvocation({ agentId: 'codex', remoteId: 'abc' }, '/project', 'do it').args.includes('resume'));
  assert.ok(buildInvocation({ agentId: 'claude', remoteId: 'abc' }, '/project', 'do it').args.includes('--resume'));
  assert.ok(buildInvocation({ agentId: 'antigravity', remoteId: 'abc' }, '/project', 'do it').args.includes('--conversation'));
  assert.equal(interpretEvent('codex', { type: 'thread.started', thread_id: 'abc' }).remoteId, 'abc');
  assert.equal(interpretEvent('claude', { type: 'result', session_id: '123', result: 'OK' }).final, 'OK');
  assert.equal(interpretEvent('antigravity', { event: 'result', result: { status: 'SUCCESS', response: 'OK' } }).final, 'OK');
});
