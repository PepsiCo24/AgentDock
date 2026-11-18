import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { InputError, resolveProjectFile, Store } from './core.mjs';
import { createIsolatedWorktree, mirrorAttachments, worktreeChanges } from './worktrees.mjs';
import { NdjsonDecoder } from './ndjson.mjs';

export const AGENT_CONFIGS = [
  { id: 'demo', name: 'Demo Agent', short: 'DE', color: '#eac08b', description: '本地演示 · 不消耗模型额度' },
  { id: 'codex', name: 'Codex', short: 'CX', color: '#8ea9f3', description: 'OpenAI Codex CLI' },
  { id: 'claude', name: 'Claude Code', short: 'CL', color: '#de9977', description: 'Anthropic Claude Code CLI' },
  { id: 'antigravity', name: 'Antigravity', short: 'AG', color: '#91c5aa', description: 'Google Antigravity CLI' }
];
const COMMANDS = { codex: 'codex', claude: 'claude', antigravity: 'agy' };
const MODES = new Set(['plan', 'edit']);
const WORKSPACE_MODES = new Set(['project', 'worktree']);
const MAX_WORKTREES_PER_SESSION = 30;
const MAX_OUTPUT = 100_000;
const STREAM_UPDATE_INTERVAL_MS = 120;
const TOOL_LABELS = Object.freeze({
  command_execution: '运行命令', file_change: '更新文件', mcp_tool_call: '扩展工具',
  web_search: '搜索资料', agent_message: 'Agent 回复', reasoning: '内部推理',
  tool_use: '调用工具', read_file: '读取文件', write_to_file: '写入文件',
  run_command: '运行命令', ask_permission: '请求权限', user_input: '用户输入'
});

/** A CLI-supplied resume ID is never allowed to become an option or a path. */
export function validatedRemoteId(remoteId) {
  if (remoteId === null || remoteId === undefined || remoteId === '') return null;
  if (typeof remoteId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(remoteId)) {
    throw new InputError('无效的 Agent 会话 ID，请新建会话重试', 409);
  }
  return remoteId;
}


function hasCommand(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' });
  return result.status === 0;
}
export function installedAgents() {
  return AGENT_CONFIGS.map(agent => ({
    ...agent, installed: agent.id === 'demo' || hasCommand(COMMANDS[agent.id]),
    mode: agent.id === 'demo' ? 'demo' : 'local-cli'
  }));
}

/** Non-authenticating local CLI presence/version check. Never returns executable paths or env. */
export function agentDiagnostics() {
  return AGENT_CONFIGS.map(agent => {
    if (agent.id === 'demo') return { id: agent.id, installed: true, version: 'built-in', auth: 'not-required' };
    const command = COMMANDS[agent.id];
    if (!hasCommand(command)) return { id: agent.id, installed: false, version: null, auth: 'not-checked' };
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 2500, maxBuffer: 32 * 1024, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
    const version = result.status === 0
      ? String(result.stdout || result.stderr || '').split(/[\r\n]/).find(Boolean)?.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120) || 'unknown'
      : null;
    return { id: agent.id, installed: true, version, auth: 'not-checked', check: result.status === 0 ? 'ok' : 'version-unavailable' };
  });
}

export function buildInvocation(session, projectPath, prompt, mode = 'plan') {
  if (!MODES.has(mode)) throw new InputError('未知执行模式');
  const resumeId = validatedRemoteId(session.remoteId);
  switch (session.agentId) {
    case 'codex': {
      const args = ['exec', '--json', '--sandbox', mode === 'plan' ? 'read-only' : 'workspace-write', '--skip-git-repo-check'];
      if (resumeId) args.push('resume', resumeId);
      args.push('-');
      return { command: 'codex', args, input: prompt, cwd: projectPath };
    }
    case 'claude': {
      const args = ['-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--permission-mode', mode === 'plan' ? 'plan' : 'acceptEdits'];
      if (resumeId) args.push('--resume', resumeId);
      args.push(prompt);
      return { command: 'claude', args, input: null, cwd: projectPath };
    }
    case 'antigravity': {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--mode', mode === 'plan' ? 'plan' : 'accept-edits'];
      if (resumeId) args.push('--conversation', resumeId);
      return { command: 'agy', args, input: null, cwd: projectPath };
    }
    default: throw new InputError('不支持的 Agent');
  }
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const fields = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_read_input_tokens', 'cache_read_tokens', 'total_tokens', 'thinking_tokens'];
  const out = {};
  for (const k of fields) if (Number.isFinite(usage[k]) && usage[k] >= 0) out[k] = Math.trunc(usage[k]);
  return Object.keys(out).length ? out : undefined;
}

// Only allow event type/status labels from fixed vocabulary. Tool inputs, command
// arguments, raw JSON and reasoning are never exposed to any browser client.
export function interpretEvent(agentId, event) {
  if (!event || typeof event !== 'object') return {};
  if (agentId === 'codex') {
    if (event.type === 'thread.started') {
      return { remoteId: validatedRemoteId(event.thread_id), activity: 'Codex 会话已连接', kind: 'session' };
    }
    if (event.type === 'turn.started') return { activity: '开始运行', kind: 'status' };
    if (event.type === 'item.started' || event.type === 'item.completed') {
      const type = event.item?.type;
      if (type === 'agent_message' && event.type === 'item.completed') {
        return { append: typeof event.item.text === 'string' ? event.item.text : '' };
      }
      if (type && type !== 'agent_message') {
        return { activity: `${TOOL_LABELS[type] || '工具步骤'} · ${event.type === 'item.completed' ? '完成' : '进行中'}`, kind: 'tool' };
      }
    }
    if (event.type === 'turn.completed') return { usage: safeUsage(event.usage), activity: '本轮完成', kind: 'result' };
    if (event.type === 'turn.failed' || event.type === 'error') {
      return { error: 'Codex 返回错误，请在本机终端检查 CLI', activity: '本轮失败', kind: 'error' };
    }
  }
  if (agentId === 'claude') {
    const remoteId = validatedRemoteId(event.session_id);
    if (event.type === 'system' && event.subtype === 'init') return { remoteId, activity: 'Claude 会话已连接', kind: 'session' };
    if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event?.delta?.type === 'text_delta') {
      const delta = event.event.delta.text;
      return { remoteId, ...(typeof delta === 'string' ? { append: delta, partial: true } : {}) };
    }
    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      const text = event.message.content.filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
      const hasTools = event.message.content.some(x => x?.type === 'tool_use');
      return { remoteId, ...(text ? { current: text } : {}), ...(hasTools ? { activity: '调用工具', kind: 'tool' } : {}) };
    }
    if (event.type === 'result') {
      return {
        remoteId, final: typeof event.result === 'string' ? event.result : '',
        usage: safeUsage(event.usage),
        error: event.is_error ? 'Claude 任务失败，请在本机终端检查 CLI' : undefined,
        activity: event.is_error ? '任务失败' : '任务完成', kind: event.is_error ? 'error' : 'result'
      };
    }
    return remoteId ? { remoteId } : {};
  }
  if (agentId === 'antigravity') {
    if (event.event === 'init') return {
      remoteId: validatedRemoteId(event.conversation_id), activity: 'Antigravity 会话已连接', kind: 'session'
    };
    if (event.event === 'step_update') {
      const step = event.step_update || {};
      if (step.step_type === 'agent_response') {
        return { append: typeof step.text_delta === 'string' ? step.text_delta : '', usage: safeUsage(step.usage) };
      }
      const label = TOOL_LABELS[step.step_type] || 'Agent 步骤';
      const state = { DONE: '完成', RUNNING: '进行中', IN_PROGRESS: '进行中', ERROR: '失败', FAILED: '失败' }[step.state] || '更新';
      return { activity: `${label} · ${state}`, kind: 'tool', usage: safeUsage(step.usage) };
    }
    if (event.event === 'result') {
      const successful = event.result?.status === 'SUCCESS';
      return {
        remoteId: validatedRemoteId(event.result?.conversation_id),
        final: typeof event.result?.response === 'string' ? event.result.response : '',
        usage: safeUsage(event.result?.usage),
        error: successful ? undefined : 'Antigravity 任务失败，请在本机终端检查 CLI',
        activity: successful ? '任务完成' : '任务失败', kind: successful ? 'result' : 'error'
      };
    }
  }
  return {};
}

export class Runner extends EventEmitter {
  constructor(store, { demoDelay = 900, maxRunMs = 30 * 60 * 1000, maxConcurrent = 3, spawnImpl = spawn } = {}) {
    super();
    this.store = store;
    this.active = new Map();
    this.awaiting = new Map();
    this.demoDelay = demoDelay;
    this.maxRunMs = maxRunMs;
    this.maxConcurrent = Math.max(1, Math.min(8, Number(maxConcurrent) || 3));
    this.spawnImpl = spawnImpl;
  }
  emitUpdate(session) {
    this.emit('change', { sessionId: session.id, status: session.status, queueLength: session.queue.length });
  }
  activity(session, label, kind = 'status', jobId = null) {
    const type = ['status', 'tool', 'result', 'error', 'session'].includes(kind) ? kind : 'status';
    session.activity = [...(session.activity || []), {
      at: new Date().toISOString(), label: String(label).slice(0, 90), kind: type, jobId
    }].slice(-60);
    this.store.save();
    this.emitUpdate(session);
  }
  send(sessionId, text, attachments = [], mode = 'plan', workspaceMode = 'project', retryOf = null) {
    const session = this.store.session(sessionId);
    const project = this.store.project(session.projectId);
    const content = Store.messageText(text);
    if (!MODES.has(mode)) throw new InputError('模式必须为 plan 或 edit');
    if (!WORKSPACE_MODES.has(workspaceMode) || (workspaceMode === 'worktree' && mode !== 'edit')) {
      throw new InputError('隔离 Git worktree 仅能用于可写任务');
    }
    if (workspaceMode === 'worktree' && (session.workspaces?.length || 0) >= MAX_WORKTREES_PER_SESSION) {
      throw new InputError('当前会话已保留 30 个隔离工作区，请先人工清理旧工作区', 409);
    }
    if (!Array.isArray(attachments) || attachments.length > 12 || attachments.some(a => typeof a !== 'string')) {
      throw new InputError('最多附加 12 个有效文件');
    }
    const resolved = attachments.map(file => {
      const real = resolveProjectFile(project.path, file);
      if (!fs.statSync(real).isFile()) throw new InputError('附件必须是文件');
      if (fs.statSync(real).size > 10 * 1024 * 1024) throw new InputError('附件文件超过 10MB 限制', 413);
      return real;
    });
    const message = this.store.addMessage(session, 'user', content, { attachments, mode, workspaceMode, ...(retryOf ? { retryOf } : {}) });
    if (session.title === '新会话') session.title = content.split('\n')[0].slice(0, 46);
    const job = { id: randomUUID(), prompt: content, attachments: resolved, mode, workspaceMode, retryOf };
    this.store.addRun(session, job, message.id);
    session.queue.push(job);
    this.store.save();
    this.emitUpdate(session);
    const queued = this.active.has(sessionId) || this.awaiting.has(sessionId) || session.queue.length > 1;
    if (!queued) void this.runNext(sessionId);
    return { jobId: job.id, queued: queued || session.status === 'queued', queueLength: session.queue.length, sessionId, approvalRequired: mode === 'edit', workspaceMode };
  }
  /** Explicit user-triggered retry only. Never reuses edit approvals or runs on boot. */
  retry(sessionId, runId) {
    const session = this.store.session(sessionId);
    const historical = session.runs?.find(run => run.id === runId);
    if (!historical) throw new InputError('未找到执行历史', 404);
    if (!['failed', 'interrupted'].includes(historical.status)) {
      throw new InputError('只有失败或中断的任务可以重试', 409);
    }
    const original = session.messages.find(m => m.id === historical.messageId && m.role === 'user');
    if (!original) throw new InputError('原始消息已被清理，无法安全重试', 409);
    // send rechecks that the original attachments still exist within this project.
    return this.send(sessionId, original.text, original.attachments || [],
      historical.mode, historical.workspaceMode || 'project', historical.id);
  }
  /** Explicitly start a fresh remote CLI context without erasing local chat/history. */
  resetRemote(sessionId, expectedRemoteId) {
    const session = this.store.session(sessionId);
    if (session.agentId === 'demo' || !session.remoteId) {
      throw new InputError('No remote CLI session to disconnect', 409);
    }
    if (typeof expectedRemoteId !== 'string' || expectedRemoteId !== session.remoteId) {
      throw new InputError('Remote session changed in another window; refresh before resetting', 409);
    }
    if (this.active.has(sessionId) || this.awaiting.has(sessionId) || session.queue.length) {
      throw new InputError('Cannot reset remote context while tasks are active, queued or awaiting approval', 409);
    }
    session.remoteId = null;
    session.remoteResetAt = new Date().toISOString();
    this.activity(session, 'Remote CLI context disconnected manually; local history retained', 'session');
    return { reset: true, remoteId: null, remoteResetAt: session.remoteResetAt };
  }
  approve(sessionId, jobId) {
    const session = this.store.session(sessionId);
    const job = this.awaiting.get(sessionId);
    if (!job || job.id !== jobId) throw new InputError('授权已失效或任务编号不匹配', 409);
    this.awaiting.delete(sessionId);
    session.pendingApproval = null;
    this.activity(session, '用户批准本次可写任务');
    // A previously approved job may have to wait for the global CLI concurrency slot.
    job.approved = true;
    this.store.updateRun(session, job.id, { status: 'queued', approvedAt: new Date().toISOString() });
    session.queue.unshift(job);
    session.status = 'queued';
    this.store.save();
    this.schedule();
    return { started: this.active.has(sessionId), queued: !this.active.has(sessionId) };
  }
  reject(sessionId, jobId) {
    const session = this.store.session(sessionId);
    const job = this.awaiting.get(sessionId);
    if (!job || job.id !== jobId) throw new InputError('授权已失效或任务编号不匹配', 409);
    this.awaiting.delete(sessionId);
    session.pendingApproval = null;
    session.status = 'idle';
    this.store.updateRun(session, job.id, { status: 'rejected', finishedAt: new Date().toISOString(), durationMs: 0 });
    this.store.addMessage(session, 'system', '用户拒绝了本次可写任务，Agent 未执行。');
    this.activity(session, '用户拒绝本次可写任务');
    void this.runNext(sessionId);
    return { rejected: true };
  }
  stop(sessionId) {
    const session = this.store.session(sessionId);
    const active = this.active.get(sessionId);
    const queued = [...session.queue];
    const waitingJob = this.awaiting.get(sessionId);
    const waiting = this.awaiting.delete(sessionId);
    session.pendingApproval = null;
    session.queue = [];
    const finishedAt = new Date().toISOString();
    for (const job of [...queued, ...(waitingJob ? [waitingJob] : [])]) {
      this.store.updateRun(session, job.id, { status: 'stopped', finishedAt, error: '用户取消，未执行' });
    }
    if (active) {
      active.cancelled = true;
      if (active.resolveDemo) active.resolveDemo();
      if (active.child && active.child.exitCode === null) {
        try { active.child.kill('SIGINT'); } catch { /* exited */ }
        active.forceKill = setTimeout(() => {
          if (active.child && active.child.exitCode === null) active.child.kill('SIGKILL');
        }, 1800);
        active.forceKill.unref?.();
      }
    } else {
      session.status = 'stopped';
      if (waiting) this.store.addMessage(session, 'system', '待授权任务已取消，未执行。');
    }
    this.store.save();
    this.emitUpdate(session);
    this.schedule();
    return { stopped: Boolean(active || waiting || queued.length) };
  }
  schedule() {
    // Approval is not a CLI execution slot: notify users of editable jobs
    // even when all worker slots are busy.
    for (const session of this.store.state.sessions) {
      if (session.queue.length && !this.active.has(session.id) && !this.awaiting.has(session.id)) {
        void this.runNext(session.id);
      }
    }
  }
  async runNext(sessionId) {
    if (this.active.has(sessionId) || this.awaiting.has(sessionId)) return;
    const session = this.store.session(sessionId);
    const next = session.queue[0];
    if (!next) return;
    if (next.mode === 'edit' && !next.approved) {
      const job = session.queue.shift();
      this.awaiting.set(sessionId, job);
      session.status = 'awaiting_approval';
      this.store.updateRun(session, job.id, { status: 'awaiting_approval' });
      session.pendingApproval = {
        id: job.id, summary: job.prompt.slice(0, 180),
        workspaceMode: job.workspaceMode, createdAt: new Date().toISOString()
      };
      this.activity(session, 'Awaiting explicit approval for an editable task');
      return;
    }
    if (this.active.size >= this.maxConcurrent) {
      if (session.status !== 'queued') {
        session.status = 'queued';
        this.store.save();
        this.emitUpdate(session);
      }
      return;
    }
    const job = session.queue.shift();
    await this.runJob(sessionId, job);
  }
  async runJob(sessionId, job) {
    if (this.active.has(sessionId)) throw new Error('Session already running');
    const session = this.store.session(sessionId);
    const active = { cancelled: false, child: null, forceKill: null, resolveDemo: null, progressTimer: null, lastProgressAt: 0 };
    this.active.set(sessionId, active);
    const started = Date.now();
    session.status = 'running';
    session.pendingApproval = null;
    session.draft = '';
    session.lastRun = { mode: job.mode, workspaceMode: job.workspaceMode || 'project', startedAt: new Date(started).toISOString(), usage: null, outcome: 'running', durationMs: null };
    this.store.updateRun(session, job.id, { status: 'running', startedAt: new Date(started).toISOString() });
    this.activity(session, `开始 ${job.mode === 'edit' ? '可写' : '受限'}任务`);
    let output = '';
    let error = '';
    const previousRemoteId = session.remoteId;
    // Invalid persisted IDs are rejected by buildInvocation within the guarded run path.
    const resumedFrom = job.workspaceMode === 'worktree' ? null : (typeof previousRemoteId === 'string' ? previousRemoteId : null);
    this.store.updateRun(session, job.id, { resumedFrom, resumeMode: job.workspaceMode === 'worktree' ? 'isolated' : resumedFrom ? 'resume' : 'new' });
    let isolated = null;
    let partialTextReceived = false;
    // Coalesce fast token streams so one large CLI response does not synchronously
    // rewrite state.json and broadcast SSE for every text chunk.
    const publishProgress = () => {
      if (active.progressTimer) return;
      const elapsed = Date.now() - active.lastProgressAt;
      if (elapsed >= STREAM_UPDATE_INTERVAL_MS) {
        active.lastProgressAt = Date.now();
        this.store.save();
        this.emitUpdate(session);
      } else {
        active.progressTimer = setTimeout(() => {
          active.progressTimer = null;
          if (this.active.get(sessionId) !== active) return;
          active.lastProgressAt = Date.now();
          this.store.save();
          this.emitUpdate(session);
        }, STREAM_UPDATE_INTERVAL_MS - elapsed);
        active.progressTimer.unref?.();
      }
    };
    const update = part => {
      if (part.remoteId && typeof part.remoteId === 'string') {
        const remoteId = validatedRemoteId(part.remoteId);
        if (isolated) isolated.remoteId = remoteId;
        else session.remoteId = remoteId;
        this.store.updateRun(session, job.id, { remoteId });
      }
      if (typeof part.current === 'string' && !partialTextReceived) output = part.current;
      if (typeof part.append === 'string') {
        output += part.append;
        if (part.partial) partialTextReceived = true;
      }
      if (typeof part.final === 'string' && (part.final || !output)) output = part.final;
      if (part.error) error = part.error;
      if (part.usage) {
        session.lastRun.usage = part.usage;
        const record = session.runs?.find(r => r.id === job.id);
        if (record) record.usage = part.usage;
      }
      if (part.activity) this.activity(session, part.activity, part.kind, job.id);
      output = output.slice(-MAX_OUTPUT);
      session.draft = output;
      if (!part.activity) publishProgress();
    };
    try {
      const project = this.store.project(session.projectId);
      let cwd = project.path;
      let attachments = job.attachments || [];
      if (job.workspaceMode === 'worktree') {
        isolated = createIsolatedWorktree({ projectRoot: project.path, dataDir: this.store.dir, jobId: job.id });
        session.workspaces ??= [];
        session.workspaces.push(isolated);
        session.lastRun.workspace = { ...isolated };
        this.store.updateRun(session, job.id, { workspaceId: isolated.id });
        cwd = isolated.path;
        attachments = mirrorAttachments(project.path, cwd, attachments);
        this.activity(session, 'Git 隔离工作区已创建（基于 HEAD，不复制未提交修改）');
      }
      const appendix = attachments.length ? '\n\nAttached local project files:\n' + attachments.map(f => `- ${f}`).join('\n') : '';
      const prompt = job.prompt + appendix;
      if (session.agentId === 'demo') {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, this.demoDelay);
          active.resolveDemo = () => { clearTimeout(timer); resolve(); };
        });
        if (!active.cancelled) output = `Demo Agent 完成 ${job.mode === 'edit' ? '授权写入' : '受限'}模拟任务。此模式不执行真实 CLI，也不会修改项目文件。`;
      } else {
        // Isolated jobs start fresh CLI conversations, so a thread from the original
        // directory cannot accidentally re-use its original working directory.
        const invocationSession = isolated ? { ...session, remoteId: null } : session;
        const spec = buildInvocation(invocationSession, cwd, prompt, job.mode);
        await new Promise(resolve => {
          let finished = false;
          let timer;
          let meaningfulEvents = 0;
          let terminalEvent = false;
          const decoder = new NdjsonDecoder(event => {
            const normalized = interpretEvent(session.agentId, event);
            if (Object.keys(normalized).length) meaningfulEvents++;
            if ((session.agentId === 'codex' && event.type === 'turn.completed') ||
                (session.agentId === 'claude' && event.type === 'result') ||
                (session.agentId === 'antigravity' && event.event === 'result')) terminalEvent = true;
            update(normalized);
          });
          const finish = code => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (code !== 0 && !active.cancelled && !error) error = `Agent 退出代码 ${code ?? '未知'}，请在本机终端检查 CLI 状态`;
            if (code === 0 && (!meaningfulEvents || !terminalEvent) && !active.cancelled && !error) {
              error = 'CLI 未返回完整的可识别任务结果，请检查本地 CLI 版本兼容性';
            }
            resolve();
          };
          let child;
          try {
            child = this.spawnImpl(spec.command, spec.args, {
              cwd: spec.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
              windowsHide: true, env: { ...process.env, NO_COLOR: '1' }
            });
          } catch (err) { error = '启动 CLI 失败'; resolve(); return; }
          active.child = child;
          timer = setTimeout(() => {
            error = '任务运行超时，已终止';
            child.kill('SIGKILL');
          }, this.maxRunMs);
          timer.unref?.();
          child.on('error', err => {
            error = err.code === 'ENOENT' ? `${spec.command} CLI 未安装或不在 PATH 中` : '启动 CLI 失败';
            finish(-1);
          });
          child.stdout.on('data', chunk => {
            try { decoder.write(chunk); }
            catch (err) {
              error = 'CLI 输出事件超过大小限制或格式错误';
              child.kill('SIGKILL');
            }
          });
          // stderr may contain secrets or command output; deliberately never relay it.
          child.stderr.on('data', () => {});
          child.on('close', code => {
            try { decoder.end(); }
            catch { if (!error) error = 'CLI 输出事件格式错误'; }
            finish(code);
          });
          if (spec.input === null) child.stdin.end();
          else child.stdin.end(spec.input);
          child.stdin.on('error', () => {});
        });
      }
    } catch (err) { error = err instanceof InputError ? err.message : 'Agent 运行异常，请检查本地 CLI'; }
    finally {
      if (active.progressTimer) clearTimeout(active.progressTimer);
      active.progressTimer = null;
      if (isolated) {
        session.remoteId = previousRemoteId;
        try {
          const changes = worktreeChanges(isolated);
          isolated.changedCount = changes.changed.length;
          session.lastRun.workspace = { ...isolated };
        } catch { /* preserve worktree for manual inspection even when git status fails */ }
      }
      if (active.forceKill) clearTimeout(active.forceKill);
      session.status = active.cancelled ? 'stopped' : error ? 'failed' : 'idle';
      session.lastRun.outcome = active.cancelled ? 'stopped' : error ? 'failed' : 'completed';
      session.lastRun.durationMs = Date.now() - started;
      session.lastRun.finishedAt = new Date().toISOString();
      this.store.updateRun(session, job.id, {
        status: session.lastRun.outcome, durationMs: session.lastRun.durationMs,
        finishedAt: session.lastRun.finishedAt, usage: session.lastRun.usage,
        error: active.cancelled ? '用户主动停止' : (error || null),
        remoteId: isolated?.remoteId || session.remoteId || null
      });
      if (output.trim() && !active.cancelled) this.store.addMessage(session, 'assistant', output.trim());
      if (error && resumedFrom && !active.cancelled) {
        // Do NOT assume the resume ID caused the error, or replay a possibly mutating task.
        this.store.updateRun(session, job.id, { resumeWarning: true });
        this.activity(session, 'A resumed CLI task failed; cause unknown. Manual reset and explicit retry are available.', 'error', job.id);
      }
      if (error && !active.cancelled) this.store.addMessage(session, 'system', error);
      if (active.cancelled) this.store.addMessage(session, 'system', '任务已停止，后续队列已清空。');
      session.draft = '';
      this.active.delete(sessionId);
      this.activity(session, `任务${session.lastRun.outcome === 'completed' ? '完成' : session.lastRun.outcome === 'failed' ? '失败' : '停止'}`);
      this.schedule();
    }
  }
}
