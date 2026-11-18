import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createIsolatedWorktree, worktreeFilePatch } from '../src/worktrees.mjs';
import { InputError } from '../src/core.mjs';

function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }); }
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-patch-'));
  const root = path.join(dir, 'source');
  const dataDir = path.join(dir, 'state');
  fs.mkdirSync(root); fs.mkdirSync(dataDir);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'testing@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(root, 'README.md'), 'baseline\n');
  git(root, 'add', 'README.md'); git(root, 'commit', '-q', '-m', 'baseline');
  const workspace = createIsolatedWorktree({ projectRoot: root, dataDir, jobId: 'b1834d52-b4d7-4f3f-ac11-9bff364d2438' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { root, dataDir, workspace };
}
function applyCheck(root, content) {
  return spawnSync('git', ['-C', root, 'apply', '--check', '-'], { input: content, encoding: 'utf8' });
}

test('tracked and untracked patch exports can be validated by git apply without mutating source', t => {
  const { root, workspace } = setup(t);
  fs.writeFileSync(path.join(workspace.path, 'README.md'), 'edited\n');
  fs.writeFileSync(path.join(workspace.path, 'NEW.txt'), 'first\nsecond\n');
  const tracked = worktreeFilePatch(workspace, 'README.md');
  const fresh = worktreeFilePatch(workspace, 'NEW.txt');
  assert.equal(applyCheck(root, tracked.content).status, 0);
  assert.equal(applyCheck(root, fresh.content).status, 0);
  assert.match(fresh.content, /new file mode 100644/);
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'baseline\n');
  assert.ok(!fs.existsSync(path.join(root, 'NEW.txt')));
});

test('text patch supports no trailing newline without altering original', t => {
  const { root, workspace } = setup(t);
  fs.writeFileSync(path.join(workspace.path, 'plain.txt'), 'no newline');
  const patch = worktreeFilePatch(workspace, 'plain.txt');
  assert.match(patch.content, /No newline at end of file/);
  assert.equal(applyCheck(root, patch.content).status, 0);
});

test('patch export refuses binary, symlink, oversized, and unreadable files', t => {
  const { root, dataDir, workspace } = setup(t);
  fs.writeFileSync(path.join(workspace.path, 'binary.dat'), Buffer.from([0, 1]));
  fs.writeFileSync(path.join(workspace.path, 'big.txt'), Buffer.alloc(37000, 0x41));
  fs.writeFileSync(path.join(dataDir, 'private.txt'), 'private');
  fs.symlinkSync(path.join(dataDir, 'private.txt'), path.join(workspace.path, 'link'));
  fs.writeFileSync(path.join(workspace.path, 'empty.txt'), '');
  for (const file of ['binary.dat', 'big.txt', 'link', 'empty.txt', '../../etc/passwd']) {
    assert.throws(() => worktreeFilePatch(workspace, file), InputError);
  }
  fs.writeFileSync(path.join(workspace.path, 'bad-utf8.txt'), Buffer.from([0xff, 0xfe]));
  assert.throws(() => worktreeFilePatch(workspace, 'bad-utf8.txt'), InputError);
});
