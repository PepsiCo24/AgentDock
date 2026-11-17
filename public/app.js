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
  runHistory: q('#run-history'), historyCount: q('#history-count'), historyMore: q('#history-more')
};
const state = {
  token: '', agents: [], projects: [], sessions: [], session: null, agentId: 'demo', projectId: null,
  currentDir: '.', files: [], attachments: [], preview: null, connected: false, reloading: false, searchText: '',
  runHistory: [], historyTotal: 0
};
let refreshTimer = null;
let toastTimer = null;

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
    const avatar = node('span', 'agent-avatar', a.short);
    avatar.style.background = `${a.color}22`;
    avatar.style.color = a.color;
    btn.append(avatar, node('span', 'agent-label', a.name === 'Antigravity' ? 'Anti' : a.name === 'Claude Code' ? 'Claude' : a.name));
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
  ui.avatar.textContent = a?.short || '—';
  ui.avatar.style.background = a ? `${a.color}22` : '#394353';
  ui.avatar.style.borderColor = a ? `${a.color}66` : '#596575';
  ui.avatar.style.color = a?.color || '#fff';
  ui.title.textContent = a?.name || 'AgentDock';
  ui.subtitle.textContent = a?.installed ? statusText(state.session) : '未检测到对应的本地 CLI · 可查看已有会话';
  const running = state.session?.status === 'running';
  const waiting = state.session?.status === 'awaiting_approval';
  ui.stop.hidden = !(running || waiting);
  ui.queue.textContent = running || waiting ? `排队 ${state.session?.queueLength || 0}` : '';
  ui.approvalPanel.hidden = !waiting;
  ui.approvalSummary.textContent = waiting ? state.session.pendingApproval?.summary || '' : '';
  ui.worktree.disabled = ui.mode.value !== 'edit';
  if (ui.worktree.disabled) ui.worktree.checked = false;
  ui.composer.disabled = !state.session;
  ui.send.disabled = !state.session;
  ui.composer.placeholder = !state.session ? '点击「新建会话」开始' : '给 Agent 发送任务，支持拖入文件...';
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
  clear(ui.conversation);
  const body = node('div', 'conversation-inner');
  if (!state.session || (!state.session.messages.length && !state.session.draft)) {
    const welcome = node('div', 'welcome');
    welcome.append(node('div', 'welcome-icon', '✦'), node('h2', '', '让每个 Agent 各司其职'),
      node('p', '', '在一个工作台中切换 AI 编程助手、管理多个项目和独立会话。拖入文件，查看运行状态，把任务排队执行。'));
    const pills = node('div', 'feature-pills');
    for (const label of ['⌁ 多 Agent 切换', '◷ 并行会话', '▤ 文件拖拽与预览', '↳ 队列与任务停止']) pills.append(node('span', '', label));
    welcome.append(pills);
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
  const workspaces = [...(state.session?.workspaces || [])].reverse().slice(0, 3);
  for (const workspace of workspaces) {
    const info = node('div', 'workspace-summary');
    info.append(node('strong', '', 'Git 隔离工作区'), node('code', 'workspace-path', workspace.path));
    const actions = node('div', 'workspace-actions');
    const changesButton = node('button', 'small-outline', '查看更改');
    changesButton.onclick = async () => {
      try {
        const sessionId = state.session.id;
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
      try { await api(`/api/sessions/${state.session.id}/workspaces/${workspace.id}/reveal`, { method: 'POST', data: {} }); }
      catch (err) { toast(err.message); }
    };
    actions.append(changesButton, openButton);
    info.append(actions);
    ui.activityList.append(info);
  }
  for (const event of [...(state.session?.activity || [])].reverse().slice(0, 12)) {
    const item = node('div', 'activity-item');
    item.append(node('span', 'activity-time', new Date(event.at).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit', second:'2-digit'})), node('span', '', event.label));
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
  for (const record of state.runHistory) {
    const item = node('div', 'history-entry');
    const head = node('div', 'history-head');
    const when = record.createdAt ? new Date(record.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    head.append(node('span', 'history-time', when), node('span', `history-status status-${record.status}`, runStatusText(record.status)));
    item.append(head, node('p', 'history-prompt', record.promptPreview || '历史任务'));
    const details = node('div', 'history-detail', `${record.mode === 'edit' ? '可写' : '受限'} · ${record.workspaceMode === 'worktree' ? 'Git 隔离' : '原项目'}${record.durationMs == null ? '' : ` · ${(record.durationMs / 1000).toFixed(1)}s`}`);
    item.append(details);
    if (record.retryable) {
      const button = node('button', 'small-outline history-retry', '重新执行');
      button.title = '显式重新提交原指令；可能重复执行已有副作用';
      button.onclick = async () => {
        if (!state.session) return;
        const id = state.session.id;
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
  const sid = state.session?.id;
  if (!sid) { state.runHistory = []; state.historyTotal = 0; renderHistory(); return; }
  const offset = append ? state.runHistory.length : 0;
  try {
    const data = await api(`/api/sessions/${sid}/runs?offset=${offset}&limit=20`);
    if (state.session?.id !== sid) return;
    state.runHistory = append ? [...state.runHistory, ...data.items] : data.items;
    state.historyTotal = data.total;
    renderHistory();
  } catch (err) { toast(err.message); }
}
function renderAll() {
  renderAgents(); renderProjects(); renderSessions(); renderHeader(); renderConversation(); renderAttachments(); renderFiles(); renderPreview(); renderActivity(); renderHistory();
}
async function refresh({ bootstrap = false } = {}) {
  if (state.reloading) return;
  state.reloading = true;
  try {
    const data = bootstrap ? await api('/api/bootstrap') : null;
    if (data) {
      state.token = data.token; state.agents = data.agents; state.projects = data.projects; state.sessions = data.sessions;
      state.projectId = state.projectId || data.projects[0]?.id || null;
    } else state.sessions = await api('/api/sessions');
    if (state.session) {
      const previous = state.session;
      const current = state.sessions.find(s => s.id === state.session.id);
      state.session = current ? await api(`/api/sessions/${current.id}`) : null;
      if (!state.session || previous.status !== state.session.status ||
          previous.queueLength !== state.session.queueLength ||
          previous.lastRun?.finishedAt !== state.session.lastRun?.finishedAt) await loadHistory();
    }
    renderAgents(); renderSessions(); renderHeader(); renderConversation(); renderActivity();
  } catch (err) { toast(err.message); }
  finally { state.reloading = false; }
}
function requestRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(); }, 130);
}
async function selectSession(id) {
  try {
    state.session = await api(`/api/sessions/${id}`);
    state.runHistory = []; state.historyTotal = 0;
    state.agentId = state.session.agentId;
    state.projectId = state.session.projectId;
    state.attachments = [];
    state.currentDir = '.'; state.preview = null; state.searchText = ''; ui.search.value = '';
    await loadFiles();
    await loadHistory();
    renderAll();
    ui.conversation.scrollTop = ui.conversation.scrollHeight;
  } catch (err) { toast(err.message); }
}
async function switchAgent(agentId) {
  state.agentId = agentId;
  const target = sessionsForCurrent()[0];
  if (target) await selectSession(target.id);
  else { state.session = null; state.attachments = []; state.runHistory = []; state.historyTotal = 0; renderAll(); }
}
async function switchProject(projectId) {
  state.projectId = projectId;
  state.attachments = []; state.currentDir = '.'; state.preview = null; state.searchText = ''; ui.search.value = '';
  await loadFiles();
  const s = sessionsForCurrent()[0];
  if (s) await selectSession(s.id);
  else { state.session = null; state.runHistory = []; state.historyTotal = 0; renderAll(); }
}
async function newSession() {
  if (!state.projectId) return toast('请先添加本地项目');
  if (!agent()?.installed) return toast('本机没有检测到该 Agent 的 CLI。请先安装并完成登录。');
  try {
    const s = await api('/api/sessions', { method: 'POST', data: { projectId: state.projectId, agentId: state.agentId } });
    await refresh();
    await selectSession(s.id);
    ui.composer.focus();
  } catch (err) { toast(err.message); }
}
async function loadFiles() {
  if (!state.projectId) { state.files = []; renderFiles(); return; }
  try {
    state.files = state.searchText
      ? await api(`/api/projects/${encodeURIComponent(state.projectId)}/search?q=${encodeURIComponent(state.searchText)}`)
      : await api(`/api/projects/${encodeURIComponent(state.projectId)}/files?path=${encodeURIComponent(state.currentDir)}`);
    renderFiles();
  } catch (err) { state.files = []; renderFiles(); toast(err.message); }
}
async function openDirectory(relative) {
  state.currentDir = relative || '.';
  await loadFiles();
}
async function showPreview(relative) {
  if (!state.projectId) return;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(state.projectId)}/preview?path=${encodeURIComponent(relative)}`);
    state.preview = { ...result, path: relative };
    renderPreview();
  } catch (err) { toast(err.message); }
}
function attachProjectFile(rel) {
  if (!rel || state.attachments.some(f => f.path === rel)) return;
  if (state.attachments.length >= 12) return toast('单次消息最多添加 12 个文件');
  state.attachments.push({ path: rel, name: rel.split('/').at(-1) });
  renderAttachments();
  ui.composer.focus();
}
async function uploadFiles(files) {
  if (!state.projectId) return toast('请先添加项目');
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) { toast(`${file.name} 超过 10MB，未上传`); continue; }
    try {
      const data = await api(`/api/projects/${encodeURIComponent(state.projectId)}/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', data: file, binary: true });
      if (state.attachments.length >= 12) { toast('已达到 12 个附件的上限'); break; }
      state.attachments.push(data);
      renderAttachments();
    } catch (err) { toast(`上传失败：${err.message}`); }
  }
}
async function sendMessage() {
  if (!state.session) return;
  const text = ui.composer.value.trim();
  if (!text) return toast('请先输入任务内容');
  ui.send.disabled = true;
  try {
    const data = await api(`/api/sessions/${state.session.id}/messages`, {
      method: 'POST', data: { text, attachments: state.attachments.map(f => f.path), mode: ui.mode.value, workspaceMode: ui.worktree.checked ? 'worktree' : 'project' }
    });
    ui.composer.value = '';
    state.attachments = [];
    renderAttachments();
    await refresh();
    if (data.queued) toast('指令已加入当前会话执行队列');
    ui.conversation.scrollTop = ui.conversation.scrollHeight;
  } catch (err) { toast(err.message); }
  finally { ui.send.disabled = !state.session; }
}
function bindUI() {
  ui.historyMore.onclick = () => void loadHistory(true);
  q('#new-session').onclick = () => void newSession();
  q('#diagnose-agents').onclick = async () => {
    try {
      const checks = await api('/api/agents/diagnostics');
      const details = checks.map(x => `${x.id}: ${x.installed ? x.version || '版本未知' : '未安装'}`).join(' | ');
      toast(details + '（不会检查登录状态）');
    } catch (err) { toast(err.message); }
  };
  ui.projectSelect.onchange = () => void switchProject(ui.projectSelect.value);
  q('#add-project').onclick = () => ui.dialog.showModal();
  q('#cancel-project').onclick = () => ui.dialog.close();
  q('#project-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const p = await api('/api/projects', { method: 'POST', data: values });
      ui.dialog.close(); form.reset();
      await refresh({ bootstrap: true });
      await switchProject(p.id);
      toast('本地项目已添加');
    } catch (err) { toast(err.message); }
  });
  ui.mode.onchange = () => { ui.worktree.disabled = ui.mode.value !== 'edit'; if (ui.worktree.disabled) ui.worktree.checked = false; };
  q('#send-message').onclick = () => void sendMessage();
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
  q('#open-window').onclick = () => {
    if (!state.session) return toast('请先选择会话');
    window.open(`/?session=${encodeURIComponent(state.session.id)}`, '_blank', 'noopener');
  };
  q('#stop-task').onclick = async () => {
    if (!state.session) return;
    try { await api(`/api/sessions/${state.session.id}/stop`, { method: 'POST', data: {} }); requestRefresh(); }
    catch (err) { toast(err.message); }
  };
  q('#toggle-inspector').onclick = () => ui.app.classList.toggle('inspector-hidden');
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
  q('#close-preview').onclick = () => { state.preview = null; renderPreview(); };
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
      if (rel) attachProjectFile(rel);
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
    state.projectId = state.projects[0]?.id || null;
    state.agentId = 'demo';
    const sid = new URLSearchParams(location.search).get('session');
    const target = sid ? state.sessions.find(s => s.id === sid) : sessionsForCurrent()[0];
    if (target) { state.session = await api(`/api/sessions/${target.id}`); state.projectId = target.projectId; state.agentId = target.agentId; }
    else if (state.projectId) {
      state.session = await api('/api/sessions', { method: 'POST', data: { projectId: state.projectId, agentId: 'demo' } });
      state.sessions.unshift(state.session);
    }
    await loadFiles();
    await loadHistory();
    renderAll();
    const events = new EventSource('/api/events');
    events.onopen = () => { state.connected = true; };
    events.addEventListener('change', () => requestRefresh());
    events.onerror = () => { state.connected = false; };
    setInterval(() => { if (!state.connected) requestRefresh(); }, 3000);
  } catch (err) {
    toast(`初始化失败：${err.message}`);
    console.error(err);
  }
}
void main();
