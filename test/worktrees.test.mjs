import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, InputError } from '../src/core.mjs';
import { Runner } from '../src/agents.mjs';
import { createIsolatedWorktree, mirrorAttachments, worktreeChanges } from '../src/worktrees.mjs';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs');
const delay = n => new Promise(resolve => setTimeout(resolve, n));
async function until(fn, timeout = 3500) {
  const expire = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > expire) throw new Error('timed out waiting for task');
    await delay(12);
  }
}
function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-worktree-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const projectRoot = path.join(dir, 'project');
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'committed\n');
  if (options.git !== false) {
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', projectRoot]);
    execFileSync('git', ['-C', projectRoot, 'add', 'README.md']);
    execFileSync('git', ['-C', projectRoot, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'initial']);
  }
  const store = new Store({ dataDir });
  const p = store.addProject({ name: 'Test', path: projectRoot });
  const s = store.addSession({ projectId: p.id, agentId: options.agentId || 'demo' });
  const cwdSeen = [];
  const spawnImpl = (cmd, args, opts) => {
    cwdSeen.push(opts.cwd);
    return spawn(process.execPath, [fixture, cmd, ...args], opts);
  };
  const runner = new Runner(store, { demoDelay: 30, spawnImpl, maxRunMs: 2000, maxConcurrent: options.maxConcurrent ?? 3 });
  t.after(async () => {
    for (const id of [...runner.active.keys(), ...runner.awaiting.keys()]) runner.stop(id);
    await until(() => runner.active.size === 0).catch(() => {});
  });
  return { dir, projectRoot, dataDir, store, p, s, runner, cwdSeen };
}

test('worktree uses committed HEAD, preserves original modifications and detects isolated edits', t => {
  const { projectRoot, dataDir } = setup(t);
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'uncommitted local edit\n');
  const id = 'a4e6e13f-faed-42a0-a49b-2349acbf082a';
  const workspace = createIsolatedWorktree({ projectRoot, dataDir, jobId: id });
  assert.equal(fs.readFileSync(path.join(workspace.path, 'README.md'), 'utf8'), 'committed\n');
  assert.equal(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8'), 'uncommitted local edit\n');
  fs.writeFileSync(path.join(workspace.path, 'README.md'), 'agent modified\n');
  fs.writeFileSync(path.join(workspace.path, 'NEW.txt'), 'hello');
  const diff = worktreeChanges(workspace);
  assert.ok(diff.changed.some(f => f.path === 'README.md'));
  assert.ok(diff.changed.some(f => f.path === 'NEW.txt'));
  assert.equal(fs.existsSync(path.join(projectRoot, 'NEW.txt')), false);
});

test('isolated input files are mirrored, bounded and not treated as output changes', t => {
  const { projectRoot, dataDir } = setup(t);
  const workspace = createIsolatedWorktree({ projectRoot, dataDir, jobId: 'a4e6e13f-faed-42a0-a49b-2349acbf082b' });
  const copied = mirrorAttachments(projectRoot, workspace.path, [path.join(projectRoot, 'README.md')]);
  assert.equal(copied.length, 1);
  assert.equal(fs.readFileSync(copied[0], 'utf8'), 'committed\n');
  assert.ok(!worktreeChanges(workspace).changed.some(f => f.path.startsWith('.agentdock/')));
  const outside = path.join(dataDir, 'private.txt');
  fs.writeFileSync(outside, 'private');
  assert.throws(() => mirrorAttachments(projectRoot, workspace.path, [outside]), InputError);
});

test('non-Git projects and nested project subdirectories cannot create a worktree', t => {
  const { projectRoot, dataDir } = setup(t, { git: false });
  assert.throws(() => createIsolatedWorktree({ projectRoot, dataDir, jobId: 'a4e6e13f-faed-42a0-a49b-2349acbf082c' }), InputError);
});

test('approved isolated CLI executes inside worktree, retains direct session remote ID', async t => {
  const { projectRoot, s, runner, cwdSeen, store } = setup(t, { agentId: 'codex' });
  s.remoteId = 'original-thread';
  runner.send(s.id, 'Write code inside a separate workspace', ['README.md'], 'edit', 'worktree');
  assert.equal(s.status, 'awaiting_approval');
  assert.equal(s.pendingApproval.workspaceMode, 'worktree');
  runner.approve(s.id, s.pendingApproval.id);
  await until(() => s.status === 'idle' && s.lastRun?.outcome === 'completed');
  assert.equal(cwdSeen.length, 1);
  assert.equal(cwdSeen[0], s.workspaces[0].path);
  assert.equal(s.remoteId, 'original-thread');
  assert.ok(s.workspaces[0].remoteId);
  assert.ok(fs.existsSync(path.join(cwdSeen[0], '.agentdock', 'inputs', '1-README.md')));
  assert.equal(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8'), 'committed\n');
  assert.equal(new Store({ dataDir: store.dir }).session(s.id).workspaces.length, 1);
});

test('no worktree may be requested for a plan task', t => {
  const { s, runner } = setup(t);
  assert.throws(() => runner.send(s.id, 'read data', [], 'plan', 'worktree'), InputError);
  assert.equal(s.messages.length, 0);
});

test('global concurrency limit queues other sessions and eventually drains them', async t => {
  const { store, p, s, runner } = setup(t, { maxConcurrent: 1 });
  runner.demoDelay = 80;
  const s2 = store.addSession({ agentId: 'demo', projectId: p.id });
  runner.send(s.id, 'first task');
  runner.send(s2.id, 'second task');
  assert.equal(s2.status, 'queued');
  assert.equal(runner.active.size, 1);
  await until(() => s.status === 'idle' && s2.status === 'idle', 4000);
  assert.equal(s.messages.filter(m => m.role === 'assistant').length, 1);
  assert.equal(s2.messages.filter(m => m.role === 'assistant').length, 1);
});

test('stopping a globally queued task prevents later execution', async t => {
  const { store, p, s, runner } = setup(t, { maxConcurrent: 1 });
  runner.demoDelay = 100;
  const s2 = store.addSession({ agentId: 'demo', projectId: p.id });
  runner.send(s.id, 'running');
  runner.send(s2.id, 'queued');
  assert.equal(s2.status, 'queued');
  assert.equal(runner.stop(s2.id).stopped, true);
  await until(() => s.status === 'idle', 3000);
  assert.equal(s2.messages.filter(m => m.role === 'assistant').length, 0);
  assert.equal(s2.status, 'stopped');
});
