import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { InputError, within } from './core.mjs';

const MAX_GIT_OUTPUT = 256 * 1024;
const MAX_DIFF_CHARS = 72 * 1024;
const MAX_UNTRACKED_BYTES = 36 * 1024;

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

/** Bounded, text-only preview of one changed file; never mutates the repository. */
export function worktreeFileDiff(workspace, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) {
    throw new InputError('请选择工作区内的有效变更文件');
  }
  const changes = worktreeChanges(workspace);
  const entry = changes.changed.find(item => item.path === relative);
  if (!entry) throw new InputError('文件不在当前工作区的变更列表中', 404);
  const root = changes.path;
  const absolute = path.resolve(root, relative);
  if (!within(root, absolute)) throw new InputError('不能查看工作区之外的文件', 403);
  // Git status can include symlinks. Never follow links to outside the worktree.
  if (fs.existsSync(absolute)) {
    const info = fs.lstatSync(absolute);
    if (info.isSymbolicLink()) {
      return { path: relative, status: entry.status, kind: 'special', content: '符号链接变更不提供文件内容预览', truncated: false };
    }
    if (!within(root, fs.realpathSync(absolute))) throw new InputError('文件链接指向工作区之外', 403);
  }
  if (entry.status === '??') {
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      return { path: relative, status: entry.status, kind: 'special', content: '目录或特殊类型文件无法预览', truncated: false };
    }
    if (fs.statSync(absolute).size > MAX_UNTRACKED_BYTES) {
      return { path: relative, status: entry.status, kind: 'too-large', content: '新文件过大，请在本机编辑器中审查', truncated: true };
    }
    const bytes = fs.readFileSync(absolute);
    if (bytes.includes(0)) return { path: relative, status: entry.status, kind: 'binary', content: '二进制文件不提供内容预览', truncated: false };
    const text = bytes.toString('utf8');
    const content = `--- /dev/null\n+++ b/${relative}\n` + text.split('\n').map(line => `+${line}`).join('\n');
    return { path: relative, status: entry.status, kind: 'text', content: content.slice(0, MAX_DIFF_CHARS), truncated: content.length > MAX_DIFF_CHARS };
  }
  // HEAD covers staged and unstaged tracked edits without invoking user diff drivers.
  const raw = git(root, ['-c', 'core.safecrlf=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', 'HEAD', '--', relative], 8000);
  if (!raw) return { path: relative, status: entry.status, kind: 'special', content: '没有可显示的文本差异，请检查 Git 索引状态', truncated: false };
  if (/^Binary files .* differ/m.test(raw) || /^GIT binary patch/m.test(raw)) {
    return { path: relative, status: entry.status, kind: 'binary', content: '二进制差异不提供内容预览', truncated: false };
  }
  return { path: relative, status: entry.status, kind: 'text', content: raw.slice(0, MAX_DIFF_CHARS), truncated: raw.length > MAX_DIFF_CHARS };
}


/** Download-only, bounded patch for one reviewed text file; never applies changes. */
export function worktreeFilePatch(workspace, relative) {
  const preview = worktreeFileDiff(workspace, relative);
  if (preview.kind !== 'text' || preview.truncated) {
    throw new InputError('Only complete, text-only diffs can be exported', 422);
  }
  // Simplify Git patch headers rather than attempting to implement Git C-style quoting.
  if (/[\x00-\x1f\x7f"\\]/.test(relative)) {
    throw new InputError('This filename requires review in a local Git client', 422);
  }
  if (preview.status !== '??') return { path: relative, content: preview.content };

  const root = fs.realpathSync(workspace.path);
  const absolute = path.resolve(root, relative);
  if (!within(root, absolute)) throw new InputError('File is outside the worktree', 403);
  const info = fs.lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink() || !within(root, fs.realpathSync(absolute))) {
    throw new InputError('Special files cannot be exported', 422);
  }
  const bytes = fs.readFileSync(absolute);
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) {
    throw new InputError('Invalid UTF-8 file cannot be exported as a text patch', 422);
  }
  if (!value.length) {
    throw new InputError('Empty new file requires a local Git client for patch export', 422);
  }
  const lines = value.split('\n');
  const trailingNewline = value.endsWith('\n');
  if (trailingNewline) lines.pop();
  const header = `diff --git a/${relative} b/${relative}\nnew file mode 100644\n--- /dev/null\n+++ b/${relative}\n@@ -0,0 +1,${lines.length} @@\n`;
  const body = lines.map((line, i) => `+${line}\n${i === lines.length - 1 && !trailingNewline ? '\\ No newline at end of file\n' : ''}`).join('');
  const content = header + body;
  if (Buffer.byteLength(content, 'utf8') > MAX_DIFF_CHARS) throw new InputError('Patch exceeds review size limit', 422);
  return { path: relative, content };
}
