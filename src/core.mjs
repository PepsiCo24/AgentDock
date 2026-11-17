import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const MAX_PROJECTS = 100;
const MAX_SESSIONS = 1000;
const MAX_MESSAGES = 500;
const MAX_RUNS = 150;
const NON_TERMINAL_RUNS = new Set(['queued', 'awaiting_approval', 'running']);

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InputError';
    this.status = status;
  }
}

export function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function resolveProjectFile(projectRoot, relative = '.') {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)) {
    throw new InputError('文件路径必须是项目内的相对路径');
  }
  const base = fs.realpathSync(projectRoot);
  const candidate = path.resolve(base, relative);
  if (!within(base, candidate)) throw new InputError('路径不能超出项目目录', 403);
  let real;
  try { real = fs.realpathSync(candidate); }
  catch (err) {
    if (err.code === 'ENOENT') throw new InputError('文件或目录不存在', 404);
    throw err;
  }
  if (!within(base, real)) throw new InputError('符号链接指向项目目录之外', 403);
  return real;
}

function checkText(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new InputError(`${label}不能为空，且长度不能超过 ${max} 字符`);
  }
  return value.trim();
}

export class Store {
  constructor({ dataDir = process.env.AGENTDOCK_DATA_DIR || path.join(os.homedir(), '.agentdock'), sampleRoot } = {}) {
    this.dir = dataDir;
    this.file = path.join(this.dir, 'state.json');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    let state = { projects: [], sessions: [] };
    if (fs.existsSync(this.file)) state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!Array.isArray(state.projects) || !Array.isArray(state.sessions)) {
      throw new Error('State file is invalid. Back it up before restarting.');
    }
    this.state = state;
    for (const s of this.state.sessions) {
      if (['running', 'awaiting_approval', 'queued'].includes(s.status)) s.status = 'interrupted';
      if (!Array.isArray(s.runs)) {
        // V0.3 migration: preserve its last run even though a recoverable prompt
        // link was not recorded. Never pretend this legacy entry is retryable.
        s.runs = s.lastRun ? [{
          id: randomUUID(), messageId: null, status: s.lastRun.outcome || 'interrupted',
          promptPreview: 'V0.3 历史任务（无重试凭据）', mode: s.lastRun.mode,
          workspaceMode: s.lastRun.workspaceMode || 'project',
          createdAt: s.lastRun.startedAt || s.updatedAt || now(),
          startedAt: s.lastRun.startedAt || null, finishedAt: s.lastRun.finishedAt || null,
          durationMs: s.lastRun.durationMs ?? null, usage: s.lastRun.usage || null,
          workspaceId: s.lastRun.workspace?.id || null, legacy: true
        }] : [];
      }
      for (const run of s.runs) {
        if (NON_TERMINAL_RUNS.has(run.status)) {
          run.status = 'interrupted';
          run.finishedAt = now();
          run.error = 'AgentDock 重启，任务不会自动重放';
        }
      }
      if (s.lastRun?.outcome === 'running') {
        s.lastRun.outcome = 'interrupted';
        s.lastRun.finishedAt = now();
      }
      s.pendingApproval = null;
      s.activity ??= [];
      s.lastRun ??= null;
      s.workspaces ??= []; // Retain completed detached worktrees for user review.
      s.queue = []; // Never auto-run queued commands after a restart.
      s.draft = '';
    }
    if (!state.projects.length && sampleRoot && fs.existsSync(sampleRoot)) {
      state.projects.push({ id: randomUUID(), name: 'Welcome · 示例项目', path: fs.realpathSync(sampleRoot), createdAt: now() });
    }
    this.save();
  }

  save() {
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  projects() { return this.state.projects; }
  sessions() {
    return this.state.sessions.map(({ messages, queue, draft, runs, ...session }) => ({ ...session, queueLength: queue.length, messageCount: messages.length }));
  }
  sessionView(id) {
    const { queue, runs, ...session } = this.session(id);
    return { ...session, queueLength: queue.length };
  }
  addRun(session, job, messageId) {
    const entry = {
      id: job.id, messageId, status: 'queued', mode: job.mode,
      workspaceMode: job.workspaceMode, promptPreview: job.prompt.slice(0, 160),
      createdAt: now(), approvedAt: null, startedAt: null, finishedAt: null,
      durationMs: null, usage: null, workspaceId: null, error: null,
      retryOf: job.retryOf || null
    };
    session.runs ??= [];
    session.runs.unshift(entry);
    session.runs = session.runs.slice(0, MAX_RUNS);
    this.save();
    return entry;
  }
  updateRun(session, id, patch) {
    const record = session.runs?.find(run => run.id === id);
    if (!record) return null; // A very long-running session may prune old entries.
    Object.assign(record, patch);
    this.save();
    return record;
  }
  runs(sessionId, { limit = 20, offset = 0 } = {}) {
    const session = this.session(sessionId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
        !Number.isInteger(offset) || offset < 0 || offset > MAX_RUNS) {
      throw new InputError('执行历史分页参数无效');
    }
    const all = session.runs || [];
    return {
      total: all.length, limit, offset,
      items: all.slice(offset, offset + limit).map(run => ({
        ...run,
        retryable: ['failed', 'interrupted'].includes(run.status) &&
          Boolean(session.messages.some(m => m.id === run.messageId && m.role === 'user'))
      }))
    };
  }
  project(id) {
    const found = this.state.projects.find(p => p.id === id);
    if (!found) throw new InputError('未找到项目', 404);
    return found;
  }
  session(id) {
    const found = this.state.sessions.find(s => s.id === id);
    if (!found) throw new InputError('未找到会话', 404);
    return found;
  }
  addProject(body) {
    if (this.state.projects.length >= MAX_PROJECTS) throw new InputError('项目数量已达上限');
    const name = checkText(body?.name, '项目名称', 120);
    const requested = checkText(body?.path, '项目路径', 2048);
    if (!path.isAbsolute(requested)) throw new InputError('项目路径必须是绝对路径');
    let canonical;
    try { canonical = fs.realpathSync(requested); }
    catch (err) {
      if (err.code === 'ENOENT') throw new InputError('本地项目目录不存在');
      throw err;
    }
    if (!fs.statSync(canonical).isDirectory()) throw new InputError('项目路径必须是文件夹');
    const duplicate = this.state.projects.find(p => p.path === canonical);
    if (duplicate) return duplicate;
    const project = { id: randomUUID(), name, path: canonical, createdAt: now() };
    this.state.projects.push(project);
    this.save();
    return project;
  }
  addSession(body) {
    if (this.state.sessions.length >= MAX_SESSIONS) throw new InputError('会话数量已达上限');
    this.project(body?.projectId);
    if (!['demo', 'codex', 'claude', 'antigravity'].includes(body?.agentId)) {
      throw new InputError('不支持的 Agent');
    }
    const session = {
      id: randomUUID(), projectId: body.projectId, agentId: body.agentId,
      title: typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : '新会话',
      status: 'idle', remoteId: null, queue: [], messages: [], draft: '',
      pendingApproval: null, lastRun: null, runs: [], activity: [], workspaces: [], createdAt: now(), updatedAt: now()
    };
    this.state.sessions.unshift(session);
    this.save();
    return session;
  }
  addMessage(session, role, text, extra = {}) {
    const message = { id: randomUUID(), role, text, createdAt: now(), ...extra };
    session.messages.push(message);
    if (session.messages.length > MAX_MESSAGES) session.messages = session.messages.slice(-MAX_MESSAGES);
    session.updatedAt = now();
    this.save();
    return message;
  }
  renameSession(session, title) {
    session.title = checkText(title, '会话标题', 120);
    session.updatedAt = now();
    this.save();
    return session;
  }
  files(projectId, relative = '.') {
    const root = this.project(projectId).path;
    const dir = resolveProjectFile(root, relative);
    if (!fs.statSync(dir).isDirectory()) throw new InputError('目标不是目录');
    const hidden = new Set(['.git', 'node_modules', '.agentdock', '.next', 'dist']);
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !hidden.has(e.name) && !e.isSymbolicLink())
      .slice(0, 300)
      .map(e => {
        const filePath = path.join(dir, e.name);
        return { name: e.name, path: path.relative(root, filePath), type: e.isDirectory() ? 'dir' : 'file' };
      })
      .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'dir' ? -1 : 1);
  }
  searchFiles(projectId, query, limit = 100) {
    const root = fs.realpathSync(this.project(projectId).path);
    const q = checkText(query, '搜索关键词', 120).toLocaleLowerCase();
    const results = [];
    const ignore = new Set(['.git', 'node_modules', '.agentdock', '.next', 'dist', 'build', '.venv']);
    const stack = [{ dir: root, depth: 0 }];
    let visited = 0;
    while (stack.length && results.length < limit && visited < 5000) {
      const { dir, depth } = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const entry of entries) {
        if (++visited > 5000 || results.length >= limit) break;
        if (entry.isSymbolicLink() || ignore.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full);
        if (entry.name.toLocaleLowerCase().includes(q)) results.push({ name: entry.name, path: rel, type: entry.isDirectory() ? 'dir' : 'file' });
        if (entry.isDirectory() && depth < 8) stack.push({ dir: full, depth: depth + 1 });
      }
    }
    return results;
  }
  static messageText(value) { return checkText(value, '消息', 12000); }
}
