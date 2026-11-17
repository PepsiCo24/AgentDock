import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { InputError, within } from './core.mjs';

const MAX_GIT_OUTPUT = 256 * 1024;

function git(cwd, args, timeout = 15000) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', timeout, maxBuffer: MAX_GIT_OUTPUT, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new InputError('未检测到 Git，无法创建隔离工作区', 422);
    throw new InputError(`Git 工作区操作失败（${String(error.status ?? error.code ?? 'unknown')}），请检查仓库状态和本地 Git 配置`, 422);
  }
}

/**
 * Allocate a fresh detached Git worktree from HEAD.
 * This is an opt-in file isolation convenience, NOT an OS/process sandbox.
 * It does not copy uncommitted changes and does not merge changes automatically.
 */
export function createIsolatedWorktree({ projectRoot, dataDir, jobId }) {
  const root = fs.realpathSync(projectRoot);
  const canonicalDataDir = fs.realpathSync(dataDir);
  if (within(root, canonicalDataDir)) {
    throw new InputError('AgentDock 数据目录位于项目中，不允许在项目内部创建嵌套工作区', 422);
  }
  const gitRoot = git(root, ['rev-parse', '--show-toplevel']).trim();
  if (fs.realpathSync(gitRoot) !== root) {
    throw new InputError('隔离工作区只能用于以 Git 仓库顶层目录添加的项目', 422);
  }
  const baseCommit = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
  const pool = path.join(canonicalDataDir, 'worktrees');
  fs.mkdirSync(pool, { recursive: true, mode: 0o700 });
  const canonicalPool = fs.realpathSync(pool);
  if (!within(canonicalDataDir, canonicalPool)) throw new InputError('工作区目录存在不安全的符号链接', 403);
  const dir = path.join(canonicalPool, jobId);
  if (!/^[a-f0-9-]{36}$/i.test(jobId) || fs.existsSync(dir)) throw new InputError('工作区标识无效或已存在', 409);
  git(root, ['worktree', 'add', '--detach', dir, baseCommit], 30000);
  return { id: jobId, path: fs.realpathSync(dir), baseCommit, createdAt: new Date().toISOString(), status: 'ready' };
}

/** Copy attachments selected from the original project into the new worktree. */
export function mirrorAttachments(projectRoot, workspaceRoot, files) {
  if (!files.length) return [];
  const root = fs.realpathSync(projectRoot);
  const worktree = fs.realpathSync(workspaceRoot);
  const inputDir = path.join(worktree, '.agentdock', 'inputs');
  fs.mkdirSync(inputDir, { recursive: true, mode: 0o700 });
  const realInputDir = fs.realpathSync(inputDir);
  if (!within(worktree, realInputDir)) throw new InputError('工作区附件目录不安全', 403);
  const mapped = [];
  for (let i = 0; i < files.length; i++) {
    const source = fs.realpathSync(files[i]);
    if (!within(root, source) || !fs.statSync(source).isFile()) throw new InputError('只能镜像项目中的真实文件', 403);
    if (fs.statSync(source).size > 10 * 1024 * 1024) throw new InputError('单个附件超出 10MB 限制', 413);
    const safeName = path.basename(source).replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 120);
    const target = path.join(realInputDir, `${i + 1}-${safeName}`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
    mapped.push(target);
  }
  return mapped;
}

export function worktreeChanges(workspace) {
  const canonical = fs.realpathSync(workspace.path);
  if (canonical !== workspace.path || !fs.statSync(canonical).isDirectory()) {
    throw new InputError('工作区不存在或路径已变化', 404);
  }
  const raw = git(canonical, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 8000);
  const parts = raw.split('\0').filter(Boolean);
  const changed = [];
  for (let i = 0; i < parts.length && changed.length < 200; i++) {
    const chunk = parts[i];
    const code = chunk.slice(0, 2);
    const file = chunk.slice(3);
    if (!file || file.startsWith('.agentdock/')) continue;
    changed.push({ status: code, path: file });
    if (code.includes('R') || code.includes('C')) i++; // porcelain -z includes source path
  }
  return { id: workspace.id, path: canonical, baseCommit: workspace.baseCommit, changed, truncated: changed.length >= 200 };
}
