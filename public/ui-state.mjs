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

export function uploadSlots(attachedCount, requestedCount, limit = 12) {
  if (!Number.isInteger(attachedCount) || !Number.isInteger(requestedCount) || attachedCount < 0 || requestedCount < 0) return 0;
  return Math.min(requestedCount, Math.max(0, limit - attachedCount));
}

export function isCurrentFileView(request, current) {
  return request.projectId === current.projectId && request.directory === current.directory && request.query === current.query;
}
