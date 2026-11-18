import { startupSelection, uploadSlots, isCurrentFileView, conversationRenderKey, acceptsInternalDrag } from './ui-state.mjs';
const q = selector => document.querySelector(selector);
const ui = {
  app: q('#app'), agents: q('#agent-tabs'), projectSelect: q('#project-select'), projectPath: q('#project-path'),
  sessions: q('#session-list'), avatar: q('#header-avatar'), title: q('#header-title'),
  subtitle: q('#header-subtitle'), conversation: q('#conversation'), composer: q('#composer'),
  chips: q('#attachment-chips'), queue: q('#queue-indicator'), stop: q('#stop-task'), send: q('#send-message'),
  fileList: q('#file-list'), currentDir: q('#current-dir'), previewTitle: q('#preview-title'),
  previewContent: q('#preview-content'), inspector: q('#inspector'), dialog: q('#project-dialog'),
  toast: q('#toast'), uploadInput: q('#upload-input'),
  approvalPanel: q('#approval-panel'), approvalSummary: q('#approval-summary'), mode: q('#execution-mode'),
  activityList: q('#activity-list'), runMetrics: q('#run-metrics'), search: q('#file-search'), worktree: q('#use-worktree'),
  runHistory: q('#run-history'), historyCount: q('#history-count'), historyMore: q('#history-more'), connection: q('#connection-state'), resetRemote: q('#reset-cli-context')
};
const state = {
  token: '', agents: [], projects: [], sessions: [], session: null, agentId: 'demo', projectId: null,
  currentDir: '.', files: [], attachments: [], preview: null, connected: false, reloading: false, searchText: '',
  runHistory: [], historyTotal: 0, bootId: null
};
let refreshTimer = null;
let needsCatalogRefresh = false;
let toastTimer = null;
let sending = false;
let uploading = false;
let creatingSession = false;
let addingProject = false;
let renderedConversationKey = null;
let viewEpoch = 0;
let fileEpoch = 0;
let previewEpoch = 0;
let historyEpoch = 0;
let historyLoading = false;
const sessionDrafts = new Map();
function rememberDraft() {
  if (state.session?.id) sessionDrafts.set(state.session.id, ui.composer.value);
}
const selectionKey = 'agentdock.selection.v1';
function readSelection() {
  try { return JSON.parse(sessionStorage.getItem(selectionKey) || '{}'); }
  catch { return {}; }
}
function saveSelection() {
  try { sessionStorage.setItem(selectionKey, JSON.stringify({
    projectId: state.projectId, agentId: state.agentId, sessionId: state.session?.id || null
  })); } catch { /* private browsing may disable storage */ }
}
function isCompact() { return window.matchMedia('(max-width:660px)').matches; }
function syncPanels() {
  q('#toggle-sidebar').setAttribute('aria-expanded', String(isCompact() && ui.app.classList.contains('mobile-sidebar-open')));
  q('#toggle-inspector').setAttribute('aria-expanded', String(isCompact()
    ? ui.app.classList.contains('mobile-inspector-open')
    : !ui.app.classList.contains('inspector-hidden')));
}
function closeMobileSidebar() {
  ui.app.classList.remove('mobile-sidebar-open');
  syncPanels();
}
function closeMobilePanels() {
  ui.app.classList.remove('mobile-sidebar-open', 'mobile-inspector-open');
  syncPanels();
}


async function api(endpoint, { method = 'GET', data = null, binary = false } = {}) {
  const options = { method, headers: {} };
  if (method !== 'GET') options.headers['X-AgentDock-Token'] = state.token;
  if (data !== null) {
    if (binary) { options.headers['Content-Type'] = 'application/octet-stream'; options.body = data; }
    else { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
  }
  const response = await fetch(endpoint, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
  return result;
}
function node(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined && content !== null) el.textContent = String(content);
  return el;
}
function clear(el) { el.replaceChildren(); }
const BRAND_ASSETS = Object.freeze({
  codex: '/brands/codex.svg',
  claude: '/brands/claude-code.svg',
  antigravity: '/brands/antigravity.svg'
});
function agentVendor(agentId) {
  return agentId === 'codex' ? 'OpenAI' : agentId === 'claude' ? 'Anthropic' : agentId === 'antigravity' ? 'Google' : 'Local';
}
function applyBrandMark(target, agentId, fallback = 'DE') {
  clear(target);
  target.dataset.agent = agentId || 'demo';
  const asset = BRAND_ASSETS[agentId];
  if (!asset) {
    target.append(node('span', 'demo-brand-symbol', 'A'));
    return;
  }
  const mark = node('img', 'brand-logo');
  mark.src = asset;
  mark.alt = '';
  mark.decoding = 'async';
  mark.addEventListener('error', () => {
    if (mark.isConnected) mark.replaceWith(node('span', 'brand-logo-fallback', fallback));
  }, { once: true });
  target.append(mark);
}
function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3500);
}
function agent() { return state.agents.find(a => a.id === state.agentId) || state.agents[0]; }
function project() { return state.projects.find(p => p.id === state.projectId); }
function sessionsForCurrent() {
  return state.sessions.filter(s => s.agentId === state.agentId && s.projectId === state.projectId);
}
function statusText(session) {
  if (!session) return '尚未创建会话';
  const labels = { queued: '等待可用执行槽位', running: '正在执行', awaiting_approval: '等待执行授权', idle: '空闲 · 准备就绪', failed: '上个任务失败', stopped: '任务已停止', interrupted: '会话因重启而中断' };
  return `${labels[session.status] || session.status}${session.queueLength ? ` · 排队 ${session.queueLength}` : ''}`;
}
function renderAgents() {
  clear(ui.agents);
  for (const a of state.agents) {
    const btn = node('button', `agent-button${a.id === state.agentId ? ' selected' : ''}${a.installed ? '' : ' disabled'}`);
    btn.title = a.installed ? a.description : `${a.description}（未检测到 CLI）`;
    btn.setAttribute('aria-label', `${a.name}${a.installed ? '' : '，未安装'}`);
    const avatar = node('span', 'agent-avatar brand-avatar');
    applyBrandMark(avatar, a.id, a.short);
    btn.style.setProperty('--agent-accent', a.color);
    const textWrap = node('span', 'agent-copy');
    textWrap.append(node('span', 'agent-label', a.name === 'Antigravity' ? 'Anti' : a.name === 'Claude Code' ? 'Claude' : a.name));
    textWrap.append(node('span', 'agent-vendor', agentVendor(a.id)));
    btn.append(avatar, textWrap);
    btn.onclick = () => void switchAgent(a.id);
    ui.agents.append(btn);
  }
}
function renderProjects() {
  clear(ui.projectSelect);
  for (const p of state.projects) {
    const opt = node('option', '', p.name);
    opt.value = p.id;
    ui.projectSelect.append(opt);
  }
  if (state.projectId) ui.projectSelect.value = state.projectId;
  ui.projectPath.textContent = project()?.path || '请先添加项目';
  ui.projectPath.title = project()?.path || '';
}
function renderSessions() {
  clear(ui.sessions);
  const list = sessionsForCurrent();
  if (!list.length) {
    ui.sessions.append(node('div', 'sidebar-empty', '当前 Agent 暂无会话。\n点击「新建会话」开始。'));
    return;
  }
  for (const s of list) {
    const btn = node('button', `session-item${s.id === state.session?.id ? ' active' : ''}`);
    const icon = node('span', 'session-icon', '◌');
    const meta = node('div', 'session-meta');
    meta.append(node('div', 'session-name', s.title));
    const subtitle = node('div', 'session-subtitle');
    subtitle.append(node('span', `session-dot ${s.status || ''}`), node('span', '', s.status === 'running' ? '执行中' : s.status === 'queued' ? '排队中' : s.status === 'awaiting_approval' ? '待授权' : s.messageCount ? `${s.messageCount} 条消息` : '空会话'));
    meta.append(subtitle);
    btn.append(icon, meta);
    btn.onclick = () => void selectSession(s.id);
    ui.sessions.append(btn);
  }
}
function renderHeader() {
  const a = agent();
  applyBrandMark(ui.avatar, a?.id || 'demo', a?.short || 'DE');
  ui.avatar.style.background = a ? a.color + '1a' : '#394353';
  ui.avatar.style.borderColor = a ? a.color + '55' : '#596575';
  ui.avatar.style.color = a?.color || '#fff';
  ui.title.textContent = a?.name || 'AgentDock';
  ui.subtitle.textContent = a?.installed ? agentVendor(a?.id) + ' · ' + statusText(state.session) : agentVendor(a?.id) + ' · 未检测到对应的本地 CLI · 可查看已有会话';
  ui.resetRemote.hidden = !state.session?.remoteId || state.session?.agentId === 'demo';
  ui.resetRemote.disabled = Boolean(state.session && (
    ['running', 'awaiting_approval', 'queued'].includes(state.session.status) || state.session.queueLength > 0
  ));
  const running = state.session?.status === 'running';
  const waiting = state.session?.status === 'awaiting_approval';
  ui.stop.hidden = !(running || waiting);
  ui.queue.textContent = running || waiting ? `排队 ${state.session?.queueLength || 0}` : '';
  ui.approvalPanel.hidden = !waiting;
  ui.approvalSummary.textContent = waiting ? state.session.pendingApproval?.summary || '' : '';
  ui.worktree.disabled = ui.mode.value !== 'edit';
  if (ui.worktree.disabled) ui.worktree.checked = false;
  const canCompose = Boolean(state.session && a?.installed);
  ui.composer.disabled = !canCompose;
  ui.send.disabled = !canCompose || sending;
  q('#new-session').disabled = creatingSession || !state.projectId || !a?.installed;
  q('#new-session').title = !a?.installed ? 'CLI is not installed; see diagnostics' : '';
  ui.composer.placeholder = state.session && !a?.installed ? 'CLI unavailable: install it, then refresh diagnostics' : !state.session ? '点击「新建会话」开始' : '给 Agent 发送任务，支持拖入文件...';
}
function createMessage({ role, text, createdAt, attachments = [] }, draft = false) {
  const wrap = node('article', `message ${role}${draft ? ' draft-message' : ''}`);
  wrap.append(node('div', 'message-avatar', role === 'user' ? 'YOU' : role === 'system' ? '!' : agent()?.short || 'AI'));
  const main = node('div', 'message-main');
  const header = node('div', 'message-head');
  header.append(node('span', '', role === 'user' ? '你' : role === 'system' ? '系统' : agent()?.name || 'Agent'));
  if (createdAt) header.append(node('span', 'message-time', new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
  main.append(header, node('div', 'message-body', text || ''));
  if (draft) {
    const thinking = node('div', 'thinking');
    thinking.append(node('span', 'pulse'), node('span', '', '正在执行 · 流式同步中'));
    main.append(thinking);
  }
  if (attachments.length) {
    const bar = node('div', 'message-attachments');
    for (const rel of attachments) {
      const btn = node('button', '', `▤ ${rel.split('/').at(-1)}`);
      btn.onclick = () => void showPreview(rel);
      bar.append(btn);
    }
    main.append(bar);
  }
  wrap.append(main);
  return wrap;
}
function renderConversation() {
  const nearBottom = ui.conversation.scrollHeight - ui.conversation.scrollTop - ui.conversation.clientHeight < 180;
  const key = conversationRenderKey(state.session);
  const hasContent = Boolean(state.session && (state.session.messages.length || state.session.draft));
  // Streaming fragments update only the in-progress bubble, not every historical
  // message. This preserves scrolled position, text selection, and file buttons.
  if (hasContent && key === renderedConversationKey) {
    const draftBody = ui.conversation.querySelector('.draft-message .message-body');
    if (draftBody) {
      const next = state.session.draft || '任务已提交，正在等待 Agent 响应...';
      if (draftBody.textContent !== next) draftBody.textContent = next;
    }
    if (nearBottom) ui.conversation.scrollTop = ui.conversation.scrollHeight;
    return;
  }
  renderedConversationKey = hasContent ? key : null;
  clear(ui.conversation);
  const body = node('div', 'conversation-inner');
  if (!state.session || (!state.session.messages.length && !state.session.draft)) {
    const welcome = node('div', 'welcome');
    const currentAgent = agent();
    const noSession = !state.session;
    welcome.append(node('div', 'welcome-icon', noSession ? '＋' : '✦'),
      node('h2', '', noSession ? '准备开始新的会话' : '让每个 Agent 各司其职'),
      node('p', '', noSession
        ? currentAgent?.installed ? '使用 ' + currentAgent.name + ' 开始工作，项目文件和历史记录保留在本地。' : (currentAgent?.name || '所选 Agent') + ' 尚未安装，安装后点击「检查 Agent CLI」刷新状态。'
        : '在一个工作台中切换 AI 编程助手、管理多个项目和独立会话。拖入文件，查看运行状态，把任务排队执行。'));
    if (noSession) {
      const start = node('button', 'welcome-action', currentAgent?.installed ? '＋ 新建会话' : '检查 Agent CLI');
      start.onclick = () => q(currentAgent?.installed ? '#new-session' : '#diagnose-agents').click();
      welcome.append(start);
    } else {
      const pills = node('div', 'feature-pills');
      for (const label of ['⌁ 多 Agent 切换', '◷ 并行会话', '▤ 文件拖拽与预览', '↳ 队列与任务停止']) pills.append(node('span', '', label));
      welcome.append(pills);
    }
    body.append(welcome);
  } else {
    for (const message of state.session.messages) body.append(createMessage(message));
    if (state.session.status === 'running') body.append(createMessage({ role: 'assistant', text: state.session.draft || '任务已提交，正在等待 Agent 响应...' }, true));
  }
  ui.conversation.append(body);
  if (nearBottom) ui.conversation.scrollTop = ui.conversation.scrollHeight;
}
function renderAttachments() {
  clear(ui.chips);
  for (let i = 0; i < state.attachments.length; i++) {
    const item = state.attachments[i];
    const chip = node('span', 'attachment-chip', `▤ ${item.name}`);
    const remove = node('button', '', '×');
    remove.title = '移除附件';
    remove.onclick = () => { state.attachments.splice(i, 1); renderAttachments(); };
    chip.append(remove);
    ui.chips.append(chip);
  }
}
function renderFiles() {
  ui.currentDir.textContent = state.currentDir === '.' ? '/' : `/${state.currentDir}`;
  clear(ui.fileList);
  if (!state.files.length) {
    ui.fileList.append(node('div', 'file-empty', '此目录暂无文件'));
    return;
  }
  for (const file of state.files) {
    const btn = node('button', `file-item ${file.type}`);
    btn.draggable = file.type === 'file';
    btn.append(node('span', 'file-symbol', file.type === 'dir' ? '▰' : '▤'), node('span', 'file-name', file.name));
    if (file.type === 'file') btn.append(node('span', 'file-drag', '⋮⋮'));
    btn.onclick = () => file.type === 'dir' ? void openDirectory(file.path) : void showPreview(file.path);
    if (file.type === 'file') btn.addEventListener('dragstart', event => {
      event.dataTransfer.setData('application/x-agentdock-file', file.path);
      event.dataTransfer.setData('application/x-agentdock-project', state.projectId || '');
      event.dataTransfer.setData('text/plain', file.path);
      event.dataTransfer.effectAllowed = 'copy';
    });
    ui.fileList.append(btn);
  }
}
function renderPreview() {
  clear(ui.previewContent);
  const p = state.preview;
  ui.previewTitle.textContent = p?.name || '选择文件预览';
  for (const id of ['#attach-preview', '#reveal-preview', '#download-preview']) q(id).disabled = !p;
  if (!p) return ui.previewContent.append(node('div', 'preview-empty', '选择文件即可在侧边预览'));
  if (p.kind === 'image') {
    const img = node('img');
    img.alt = p.name;
    img.src = `/api/projects/${encodeURIComponent(state.projectId)}/raw?path=${encodeURIComponent(p.path)}`;
    ui.previewContent.append(img);
  } else ui.previewContent.append(node('pre', '', p.content));
}
function renderActivity() {
  clear(ui.activityList);
  const run = state.session?.lastRun;
  const usage = run?.usage;
  ui.runMetrics.textContent = !run ? '暂无执行记录' : `${run.mode === 'edit' ? '可写' : '受限'} · ${run.outcome === 'running' ? '运行中' : run.outcome === 'completed' ? '已完成' : run.outcome === 'stopped' ? '已停止' : '失败'}${run.durationMs == null ? '' : ` · ${(run.durationMs / 1000).toFixed(1)}s`}${usage ? ` · Token: ${usage.total_tokens ?? `${usage.input_tokens || 0} / ${usage.output_tokens || 0}`}` : ''}`;
  const activitySessionId = state.session?.id;
  const workspaces = [...(state.session?.workspaces || [])].reverse().slice(0, 3);
  for (const workspace of workspaces) {
    const info = node('div', 'workspace-summary');
    info.append(node('strong', '', 'Git 隔离工作区'), node('code', 'workspace-path', workspace.path));
    const actions = node('div', 'workspace-actions');
    const changesButton = node('button', 'small-outline', '查看更改');
    changesButton.onclick = async () => {
      try {
        const sessionId = activitySessionId;
        if (state.session?.id !== sessionId) return;
        const route = `/api/sessions/${sessionId}/workspaces/${workspace.id}`;
        const data = await api(`${route}/changes`);
        if (state.session?.id !== sessionId) return;
        const details = node('div', 'workspace-changes');
        if (!data.changed.length) details.append(node('p', 'workspace-empty', '没有检测到文件修改'));
        for (const file of data.changed) {
          const row = node('div', 'workspace-change-row');
          const btn = node('button', 'workspace-change-file', `${file.status} ${file.path}`);
          btn.title = '查看本文件的差异';
          btn.onclick = async () => {
            try {
              const diff = await api(`${route}/diff?path=${encodeURIComponent(file.path)}`);
              if (state.session?.id !== sessionId) return;
              const oldDiff = details.querySelector('.file-diff');
              if (oldDiff) oldDiff.remove();
              const pre = node('pre', 'file-diff', diff.content + (diff.truncated ? '\n…显示已截断，请在本机编辑器中审查完整文件' : ''));
              details.append(pre);
            } catch (err) { toast(err.message); }
          };
          row.append(btn);
          const download = node('button', 'small-outline workspace-patch-download', 'Export patch');
          download.title = 'Download a reviewed, complete text patch only (never auto-applied)';
          download.onclick = async () => {
            try {
              const response = await fetch(`${route}/patch?path=${encodeURIComponent(file.path)}`);
              if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.error || `Export failed (${response.status})`);
              }
              const blob = await response.blob();
              const href = URL.createObjectURL(blob);
              const a = node('a');
              a.href = href;
              a.download = `${workspace.id.slice(0, 8)}-${file.path.split(/[\/]/).at(-1)}.patch`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(href), 3000);
            } catch (err) { toast(err.message); }
          };
          row.append(download);
          details.append(row);
        }
        if (data.truncated) details.append(node('p', 'workspace-empty', '超过显示上限，后续更改已截断'));
        const old = info.querySelector('.workspace-changes');
        if (old) old.remove();
        info.append(details);
      } catch (err) { toast(err.message); }
    };
    const openButton = node('button', 'small-outline', '在文件管理器中打开');
    openButton.onclick = async () => {
      if (state.session?.id !== activitySessionId) return;
      try { await api(`/api/sessions/${activitySessionId}/workspaces/${workspace.id}/reveal`, { method: 'POST', data: {} }); }
      catch (err) { toast(err.message); }
    };
    actions.append(changesButton, openButton);
    info.append(actions);
    ui.activityList.append(info);
  }
  for (const event of [...(state.session?.activity || [])].reverse().slice(0, 20)) {
    const item = node('div', `activity-item activity-${event.kind || 'status'}`);
    const marker = ({ tool: '⌘', session: '↔', result: '✓', error: '!', status: '·' })[event.kind] || '·';
    item.append(node('span', 'activity-marker', marker), node('span', 'activity-time', new Date(event.at).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit', second:'2-digit'})), node('span', '', event.label));
    ui.activityList.append(item);
  }
}
function runStatusText(status) {
  return ({ queued: '排队中', awaiting_approval: '待授权', running: '执行中',
    completed: '已完成', failed: '失败', interrupted: '重启中断',
    stopped: '已停止', rejected: '已拒绝' })[status] || status;
}
function renderHistory() {
  clear(ui.runHistory);
  ui.historyCount.textContent = state.session ? `${state.historyTotal} 次` : '';
  ui.historyMore.hidden = !state.session || state.runHistory.length >= state.historyTotal;
  if (!state.session || !state.runHistory.length) {
    ui.runHistory.append(node('div', 'history-empty', '暂无执行历史'));
    return;
  }
  const renderedSessionId = state.session.id;
  for (const record of state.runHistory) {
    const item = node('div', 'history-entry');
    const head = node('div', 'history-head');
    const when = record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    head.append(node('span', 'history-time', when), node('span', `history-status status-${record.status}`, runStatusText(record.status)));
    item.append(head, node('p', 'history-prompt', record.promptPreview || '历史任务'));
    const details = node('div', 'history-detail', `${record.mode === 'edit' ? '可写' : '受限'} · ${record.workspaceMode === 'worktree' ? 'Git 隔离' : '原项目'}${record.durationMs == null ? '' : ` · ${(record.durationMs / 1000).toFixed(1)}s`}`);
    if (record.resumeMode && record.resumeMode !== 'new') {
      details.append(node('span', 'history-resume', record.resumeMode === 'isolated' ? ' · 独立新上下文' : ' · 续接 CLI 会话'));
    }
    if (record.resumeWarning) {
      details.append(node('span', 'history-resume-warning', ' · CLI continuation failed (cause unconfirmed); you may reset and retry manually'));
    }
    item.append(details);
    if (record.retryable) {
      const button = node('button', 'small-outline history-retry', '重新执行');
      button.title = '显式重新提交原指令；可能重复执行已有副作用';
      button.onclick = async () => {
        if (state.session?.id !== renderedSessionId) return;
        const id = renderedSessionId;
        const accepted = window.confirm('重新执行之前失败或中断的任务？先前任务可能已经修改文件，重试可能产生重复副作用。可写任务需要重新授权。');
        if (!accepted) return;
        button.disabled = true;
        try {
          const result = await api(`/api/sessions/${id}/runs/${record.id}/retry`, { method: 'POST', data: {} });
          if (state.session?.id !== id) return;
          await refresh();
          await loadHistory();
          toast(result.approvalRequired ? '已重新提交：请审核本次可写任务的授权' : '任务已重新提交');
        } catch (err) { toast(err.message); }
        finally { button.disabled = false; }
      };
      item.append(button);
    }
    ui.runHistory.append(item);
  }
}
async function loadHistory(append = false) {
  if (append && historyLoading) return;
  const ticket = ++historyEpoch;
  const sid = state.session?.id;
  if (!sid) { state.runHistory = []; state.historyTotal = 0; renderHistory(); return; }
  historyLoading = true;
  ui.historyMore.disabled = true;
  const offset = append ? state.runHistory.length : 0;
  try {
    const data = await api(`/api/sessions/${sid}/runs?offset=${offset}&limit=20`);
    if (ticket !== historyEpoch || state.session?.id !== sid) return;
    state.runHistory = append ? [...state.runHistory, ...data.items] : data.items;
    state.historyTotal = data.total;
    renderHistory();
  } catch (err) { if (ticket === historyEpoch) toast(err.message); }
  finally {
    if (ticket === historyEpoch) { historyLoading = false; ui.historyMore.disabled = false; }
  }
}
function renderAll() {
  renderAgents(); renderProjects(); renderSessions(); renderHeader(); renderConversation(); renderAttachments(); renderFiles(); renderPreview(); renderActivity(); renderHistory();
}
async function refresh({ bootstrap = false } = {}) {
  if (state.reloading) { requestRefresh(bootstrap); return; }
  state.reloading = true;
  try {
    const previousProject = state.projectId;
    const selectedAtStart = state.session?.id;
    const viewAtStart = viewEpoch;
    const data = bootstrap ? await api('/api/bootstrap') : null;
    if (data) {
      state.token = data.token; state.agents = data.agents; state.projects = data.projects; state.sessions = data.sessions;
      state.bootId = data.bootId || state.bootId;
      if (!data.projects.some(p => p.id === state.projectId)) state.projectId = data.projects[0]?.id || null;
    } else state.sessions = await api('/api/sessions');
    if (state.session && state.session.id === selectedAtStart && viewEpoch === viewAtStart) {
      const previous = state.session;
      const current = state.sessions.find(s => s.id === selectedAtStart);
      const detail = current ? await api(`/api/sessions/${current.id}`) : null;
      if (viewEpoch !== viewAtStart || state.session?.id !== selectedAtStart) return;
      state.session = detail;
      const justFinished = previous.status === 'running' && detail?.status !== 'running';
      if (!detail || previous.status !== detail.status ||
          previous.queueLength !== detail.queueLength ||
          previous.lastRun?.finishedAt !== detail.lastRun?.finishedAt) await loadHistory();
      if (justFinished) await loadFiles();
    }
    if (viewEpoch !== viewAtStart) { requestRefresh(bootstrap); return; }
    if (previousProject !== state.projectId) { state.currentDir = '.'; state.preview = null; previewEpoch++; await loadFiles(); }
    renderAgents(); renderProjects(); renderSessions(); renderHeader(); renderConversation(); renderActivity();
  } catch (err) { toast(err.message); }
  finally { state.reloading = false; }
}
function requestRefresh(bootstrap = false) {
  needsCatalogRefresh ||= bootstrap;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const rebuild = needsCatalogRefresh;
    needsCatalogRefresh = false;
    void refresh({ bootstrap: rebuild });
  }, 130);
}
function showConnectionStatus(online) {
  state.connected = online;
  if (ui.connection) {
    ui.connection.textContent = online ? '● 已同步' : '○ 正在重连';
    ui.connection.classList.toggle('connection-offline', !online);
  }
}
async function selectSession(id) {
  const ticket = ++viewEpoch;
  rememberDraft();
  // A slow HTTP response must never leave the previous session writable while
  // navigation is in progress.
  state.session = null;
  state.runHistory = []; state.historyTotal = 0;
  historyEpoch++;
  renderHeader(); renderConversation(); renderHistory();
  try {
    const detail = await api(`/api/sessions/${id}`);
    if (ticket !== viewEpoch) return;
    state.session = detail;
    ui.composer.value = sessionDrafts.get(detail.id) || '';
    state.agentId = detail.agentId;
    state.projectId = detail.projectId;
    state.attachments = [];
    state.runHistory = []; state.historyTotal = 0;
    state.currentDir = '.'; state.preview = null; previewEpoch++;
    state.searchText = ''; ui.search.value = '';
    ui.mode.value = 'plan'; ui.worktree.checked = false;
    saveSelection(); closeMobileSidebar();
    await Promise.all([loadFiles(), loadHistory()]);
    if (ticket !== viewEpoch) return;
    renderAll();
    ui.conversation.scrollTop = ui.conversation.scrollHeight;
  } catch (err) { if (ticket === viewEpoch) toast(err.message); }
}
async function switchAgent(agentId) {
  if (!state.agents.some(a => a.id === agentId)) return;
  rememberDraft();
  state.agentId = agentId;
  state.session = null;
  renderHeader(); renderConversation();
  const target = sessionsForCurrent()[0];
  if (target) await selectSession(target.id);
  else {
    viewEpoch++; state.session = null; state.attachments = [];
    state.runHistory = []; state.historyTotal = 0;
    historyEpoch++; saveSelection(); renderAll(); closeMobileSidebar();
  }
}
async function switchProject(projectId) {
  if (!state.projects.some(p => p.id === projectId)) return;
  const ticket = ++viewEpoch;
  rememberDraft();
  state.projectId = projectId;
  state.session = null;
  renderHeader(); renderConversation();
  state.attachments = []; state.currentDir = '.';
  state.preview = null; previewEpoch++; state.searchText = ''; ui.search.value = '';
  await loadFiles();
  if (ticket !== viewEpoch) return;
  const target = sessionsForCurrent()[0];
  if (target) await selectSession(target.id);
  else {
    state.session = null; state.runHistory = []; state.historyTotal = 0;
    historyEpoch++; saveSelection(); renderAll(); closeMobileSidebar();
  }
}
async function newSession() {
  if (creatingSession) return;
  if (!state.projectId) return toast('请先添加本地项目');
  if (!agent()?.installed) return toast('本机没有检测到该 Agent 的 CLI。请先安装并完成登录。');
  const projectId = state.projectId;
  const agentId = state.agentId;
  const epoch = viewEpoch;
  creatingSession = true;
  renderHeader();
  try {
    const s = await api('/api/sessions', { method: 'POST', data: { projectId, agentId } });
    await refresh();
    if (epoch === viewEpoch && state.projectId === projectId && state.agentId === agentId) {
      await selectSession(s.id);
      ui.composer.focus();
    } else requestRefresh(true);
  } catch (err) { toast(err.message); }
  finally { creatingSession = false; renderHeader(); }
}
async function loadFiles() {
  const ticket = ++fileEpoch;
  const snapshot = { projectId: state.projectId, directory: state.currentDir, query: state.searchText };
  if (!snapshot.projectId) { state.files = []; renderFiles(); return; }
  try {
    const files = snapshot.query
      ? await api(`/api/projects/${encodeURIComponent(snapshot.projectId)}/search?q=${encodeURIComponent(snapshot.query)}`)
      : await api(`/api/projects/${encodeURIComponent(snapshot.projectId)}/files?path=${encodeURIComponent(snapshot.directory)}`);
    if (ticket !== fileEpoch || !isCurrentFileView(snapshot, {
      projectId: state.projectId, directory: state.currentDir, query: state.searchText
    })) return;
    state.files = files;
    renderFiles();
  } catch (err) {
    if (ticket !== fileEpoch) return;
    state.files = []; renderFiles(); toast(err.message);
  }
}
async function openDirectory(relative) {
  state.currentDir = relative || '.';
  if (state.searchText) { state.searchText = ''; ui.search.value = ''; }
  await loadFiles();
}
async function showPreview(relative) {
  const projectId = state.projectId;
  const ticket = ++previewEpoch;
  if (!projectId) return;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(projectId)}/preview?path=${encodeURIComponent(relative)}`);
    if (ticket !== previewEpoch || state.projectId !== projectId) return;
    state.preview = { ...result, path: relative, projectId };
    renderPreview();
  } catch (err) { if (ticket === previewEpoch) toast(err.message); }
}
function attachProjectFile(rel) {
  if (!state.session || !agent()?.installed) return toast('请先选择可用的 Agent 会话');
  if (!rel || state.attachments.some(f => f.path === rel)) return;
  if (state.attachments.length >= 12) return toast('单次消息最多添加 12 个文件');
  state.attachments.push({ path: rel, name: rel.split('/').at(-1) });
  renderAttachments();
  ui.composer.focus();
}
async function uploadFiles(files) {
  const projectId = state.projectId;
  if (!projectId) return toast('Please add a project first');
  if (uploading) return toast('File upload already in progress');
  const available = uploadSlots(state.attachments.length, files.length);
  if (!available) return toast('At most 12 attachments per message');
  if (available < files.length) toast(`Only ${available} more attachments fit in this message`);
  uploading = true;
  let completed = 0;
  try {
    for (const file of files.slice(0, available)) {
      if (state.projectId !== projectId) break;
      if (file.size > 10 * 1024 * 1024) { toast(`${file.name}: exceeds 10 MB`); continue; }
      try {
        const item = await api(`/api/projects/${encodeURIComponent(projectId)}/upload?name=${encodeURIComponent(file.name)}`, {
          method: 'POST', data: file, binary: true
        });
        if (state.projectId !== projectId) { toast('Upload finished in the previous project; attachment not added'); break; }
        if (state.attachments.length >= 12) break;
        if (!state.attachments.some(a => a.path === item.path)) state.attachments.push(item);
        completed++;
        renderAttachments();
      } catch (err) { toast(`Upload failed: ${err.message}`); }
    }
    if (completed && state.projectId === projectId) await loadFiles();
  } finally { uploading = false; }
}
async function sendMessage() {
  if (sending || !state.session || !agent()?.installed) return;
  const id = state.session.id;
  const raw = ui.composer.value;
  const text = raw.trim();
  if (!text) return toast('Please enter a task');
  const attachments = state.attachments.map(item => item.path);
  const mode = ui.mode.value;
  const workspaceMode = ui.worktree.checked ? 'worktree' : 'project';
  sending = true;
  renderHeader();
  try {
    const result = await api(`/api/sessions/${id}/messages`, {
      method: 'POST', data: { text, attachments, mode, workspaceMode }
    });
    if (sessionDrafts.get(id) === raw) sessionDrafts.set(id, '');
    if (state.session?.id === id) {
      if (ui.composer.value === raw) ui.composer.value = '';
      state.attachments = state.attachments.filter(item => !attachments.includes(item.path));
      renderAttachments();
      await refresh();
      if (result.queued) toast('Task added to queue');
      ui.conversation.scrollTop = ui.conversation.scrollHeight;
    }
  } catch (err) { toast(err.message); }
  finally { sending = false; renderHeader(); }
}
function bindUI() {
  ui.historyMore.onclick = () => void loadHistory(true);
  q('#new-session').onclick = () => void newSession();
  q('#diagnose-agents').onclick = async () => {
    try {
      const checks = await api('/api/agents/diagnostics');
      const details = checks.map(x => `${x.id}: ${x.installed ? x.version || '版本未知' : '未安装'}`).join(' | ');
      toast(details + '（不会检查登录状态）');
      await refresh({ bootstrap: true });
    } catch (err) { toast(err.message); }
  };
  ui.projectSelect.onchange = () => void switchProject(ui.projectSelect.value);
  q('#add-project').onclick = () => ui.dialog.showModal();
  q('#cancel-project').onclick = () => ui.dialog.close();
  q('#project-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (addingProject) return;
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    addingProject = true;
    submit.disabled = true;
    try {
      const p = await api('/api/projects', { method: 'POST', data: values });
      ui.dialog.close(); form.reset();
      if (!state.projects.some(project => project.id === p.id)) state.projects.push(p);
      await switchProject(p.id);
      requestRefresh(true);
      toast('本地项目已添加');
    } catch (err) { toast(err.message); }
    finally { addingProject = false; submit.disabled = false; }
  });
  ui.mode.onchange = () => { ui.worktree.disabled = ui.mode.value !== 'edit'; if (ui.worktree.disabled) ui.worktree.checked = false; };
  q('#send-message').onclick = () => void sendMessage();
  ui.composer.addEventListener('input', rememberDraft);
  ui.composer.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage(); }
  });
  q('#approve-task').onclick = async () => {
    if (!state.session?.pendingApproval) return;
    try { await api(`/api/sessions/${state.session.id}/approve`, { method: 'POST', data: { jobId: state.session.pendingApproval.id } }); await refresh(); }
    catch (err) { toast(err.message); }
  };
  q('#reject-task').onclick = async () => {
    if (!state.session?.pendingApproval) return;
    try { await api(`/api/sessions/${state.session.id}/reject`, { method: 'POST', data: { jobId: state.session.pendingApproval.id } }); await refresh(); }
    catch (err) { toast(err.message); }
  };
  ui.resetRemote.onclick = async () => {
    if (!state.session?.remoteId) return;
    const sid = state.session.id;
    const expectedRemoteId = state.session.remoteId;
    if (!window.confirm('Disconnect CLI continuation for this AgentDock session? Local messages remain; the next task starts fresh. Any pending task must finish first.')) return;
    try {
      await api(`/api/sessions/${sid}/reset-remote`, { method: 'POST', data: { expectedRemoteId } });
      await refresh();
      toast('CLI continuation disconnected. The next task will use a fresh remote context.');
    } catch (err) { toast(err.message); requestRefresh(); }
  };
  q('#open-window').onclick = () => {
    if (!state.session) return toast('请先选择会话');
    window.open(`/?session=${encodeURIComponent(state.session.id)}`, '_blank', 'noopener');
  };
  q('#stop-task').onclick = async () => {
    if (!state.session) return;
    try { await api(`/api/sessions/${state.session.id}/stop`, { method: 'POST', data: {} }); requestRefresh(); }
    catch (err) { toast(err.message); }
  };
  q('#toggle-inspector').onclick = () => {
    if (isCompact()) {
      ui.app.classList.remove('mobile-sidebar-open');
      ui.app.classList.toggle('mobile-inspector-open');
    } else ui.app.classList.toggle('inspector-hidden');
    syncPanels();
  };
  q('#toggle-sidebar').onclick = () => {
    ui.app.classList.remove('mobile-inspector-open');
    ui.app.classList.toggle('mobile-sidebar-open');
    syncPanels();
  };
  q('#mobile-backdrop').onclick = closeMobilePanels;
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobilePanels(); });
  window.addEventListener('resize', () => {
    if (!isCompact()) closeMobilePanels();
    else syncPanels();
  });
  syncPanels();
  q('#reload-files').onclick = () => void loadFiles();
  let searchTimer = null;
  ui.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.searchText = ui.search.value.trim(); void loadFiles(); }, 180);
  });
  q('#clear-search').onclick = () => { ui.search.value = ''; state.searchText = ''; void loadFiles(); };
  q('#download-preview').onclick = () => {
    if (!state.preview) return toast('请先选择文件');
    const a = document.createElement('a');
    a.href = `/api/projects/${encodeURIComponent(state.projectId)}/download?path=${encodeURIComponent(state.preview.path)}`;
    a.download = state.preview.name;
    a.click();
  };
  q('#files-back').onclick = () => {
    if (state.currentDir === '.') return;
    const parts = state.currentDir.split(/[\\/]/).filter(Boolean);
    parts.pop(); void openDirectory(parts.join('/') || '.');
  };
  q('#close-preview').onclick = () => { previewEpoch++; state.preview = null; renderPreview(); };
  q('#attach-preview').onclick = () => state.preview ? attachProjectFile(state.preview.path) : toast('请先选择一个文件');
  q('#reveal-preview').onclick = async () => {
    if (!state.preview) return toast('请先选择一个文件');
    try {
      await api(`/api/projects/${state.projectId}/reveal`, { method: 'POST', data: { path: state.preview.path } });
    } catch (err) { toast(err.message); }
  };
  q('#attach-file').onclick = () => ui.uploadInput.click();
  ui.uploadInput.addEventListener('change', async () => {
    await uploadFiles([...ui.uploadInput.files]);
    ui.uploadInput.value = '';
  });
  const drop = q('#drop-target');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', e => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('dragover'); });
  drop.addEventListener('drop', async e => {
    e.preventDefault(); drop.classList.remove('dragover');
    if (e.dataTransfer.files?.length) await uploadFiles([...e.dataTransfer.files]);
    else {
      const rel = e.dataTransfer.getData('application/x-agentdock-file');
      if (rel) {
        const origin = e.dataTransfer.getData('application/x-agentdock-project');
        if (!acceptsInternalDrag(origin, state.projectId)) toast('文件来自其他项目，请在当前项目重新选择');
        else attachProjectFile(rel);
      }
    }
  });
}
async function main() {
  bindUI();
  try {
    const bootstrap = await api('/api/bootstrap');
    state.token = bootstrap.token;
    state.agents = bootstrap.agents;
    state.projects = bootstrap.projects;
    state.sessions = bootstrap.sessions;
    state.bootId = bootstrap.bootId || null;
    const sid = new URLSearchParams(location.search).get('session');
    const initial = startupSelection({
      projects: state.projects, sessions: state.sessions, agents: state.agents,
      requestedSessionId: sid, saved: readSelection()
    });
    state.projectId = initial.projectId;
    state.agentId = initial.agentId;
    if (initial.sessionId) {
      state.session = await api(`/api/sessions/${initial.sessionId}`);
    } else if (state.projectId && !state.sessions.length) {
      // Only create a Demo session on an entirely new workspace, never on reload
      // when another agent already has sessions.
      state.session = await api('/api/sessions', { method: 'POST', data: {
        projectId: state.projectId, agentId: 'demo'
      }});
      state.sessions.unshift(state.session);
      state.agentId = 'demo';
    }
    saveSelection();
    await Promise.all([loadFiles(), loadHistory()]);
    renderAll();
    const events = new EventSource('/api/events');
    events.onopen = () => showConnectionStatus(true);
    events.addEventListener('ready', event => {
      let bootId;
      try { bootId = JSON.parse(event.data).bootId; } catch { return; }
      if (state.bootId && bootId && state.bootId !== bootId) requestRefresh(true);
      state.bootId = bootId || state.bootId;
      showConnectionStatus(true);
    });
    events.addEventListener('change', event => {
      let payload = {};
      try { payload = JSON.parse(event.data); } catch { /* safe refresh */ }
      requestRefresh(payload.scope === 'catalog');
    });
    events.onerror = () => showConnectionStatus(false);
    setInterval(() => { if (!state.connected) requestRefresh(true); }, 3000);
  } catch (err) {
    toast(`Initialization failed: ${err.message}`);
    console.error(err);
  }
}
void main();
