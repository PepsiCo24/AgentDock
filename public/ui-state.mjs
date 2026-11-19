/** Pure UI state decisions, deliberately independent of the DOM. */
export function startupSelection({ projects = [], sessions = [], agents = [], requestedSessionId = null, saved = {} } = {}) {
  const projectIds = new Set(projects.map(p => p.id));
  const agentIds = new Set(agents.map(a => a.id));
  const preferredProject = projectIds.has(saved.projectId) ? saved.projectId : projects[0]?.id || null;
  const preferredAgent = agentIds.has(saved.agentId) ? saved.agentId : 'demo';
  const eligible = s => projectIds.has(s.projectId) && agentIds.has(s.agentId);
  const match = id => id ? sessions.find(s => s.id === id && eligible(s)) : null;
  const explicit = match(requestedSessionId);
  const restored = match(saved.sessionId);
  const samePair = sessions.find(s => eligible(s) && s.projectId === preferredProject && s.agentId === preferredAgent);
  const hasPreference = Boolean(saved.projectId || saved.agentId || saved.sessionId);
  const chosen = explicit || restored || samePair || (!hasPreference ? sessions.find(eligible) : null);
  return {
    projectId: chosen?.projectId || preferredProject,
    agentId: chosen?.agentId || preferredAgent,
    sessionId: chosen?.id || null
  };
}

/** Stable across streaming drafts: preserve message DOM until IDs or run state change. */
export function conversationRenderKey(session) {
  if (!session || typeof session.id !== 'string') return null;
  const ids = Array.isArray(session.messages) ? session.messages.map(message => message.id || '').join('|') : '';
  return `${session.id}:${session.status === 'running' ? 'running' : 'idle'}:${ids}`;
}

/** A relative file path dragged from another project must never be attached here. */
export function acceptsInternalDrag(sourceProjectId, activeProjectId) {
  return typeof sourceProjectId === 'string' && sourceProjectId.length > 0 && sourceProjectId === activeProjectId;
}

export function uploadSlots(attachedCount, requestedCount, limit = 12) {
  if (!Number.isInteger(attachedCount) || !Number.isInteger(requestedCount) || attachedCount < 0 || requestedCount < 0) return 0;
  return Math.min(requestedCount, Math.max(0, limit - attachedCount));
}

/** Stable row identity avoids recreating focused elements on SSE changes. */
export function sameIdOrder(existingIds, nextIds) {
  return Array.isArray(existingIds) && Array.isArray(nextIds) &&
    existingIds.length === nextIds.length &&
    existingIds.every((id, index) => id === nextIds[index]);
}

export function isCurrentFileView(request, current) {
  return request.projectId === current.projectId && request.directory === current.directory && request.query === current.query;
}

/** An async upload result belongs to the exact view that requested it. */
export function isCurrentUploadContext(start, current) {
  return Boolean(start?.projectId && start?.sessionId &&
    start.projectId === current?.projectId &&
    start.sessionId === current?.sessionId &&
    start.viewEpoch === current?.viewEpoch);
}

/** Stable workspace identity lets the Git change reviewer survive SSE updates. */
export function activityWorkspaceKey(session) {
  if (!session?.id) return null;
  const workspaces = (session.workspaces || []).slice(-3).reverse();
  return JSON.stringify([session.id, ...workspaces.map(workspace => [workspace.id, workspace.path])]);
}

/** Event data changes only when a new visible activity entry arrives. */
export function activityEventKey(session) {
  if (!session?.id) return null;
  return JSON.stringify([session.id, ...(session.activity || []).slice(-20).map(event =>
    [event.at, event.kind, event.label])]);
}
