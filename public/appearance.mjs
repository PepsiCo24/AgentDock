/** Pure, dependency-free presentation rules shared by the workbench and tests. */
export const APPEARANCES = Object.freeze(['system', 'light', 'dark']);

export function normalizeAppearance(value) {
  return APPEARANCES.includes(value) ? value : 'system';
}

export function resolveAppearance(value, systemDark = false) {
  const selected = normalizeAppearance(value);
  return selected === 'system' ? (systemDark ? 'dark' : 'light') : selected;
}

export function filterSessions(sessions, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return sessions;
  return sessions.filter(session => {
    const title = String(session.title || '').toLocaleLowerCase();
    return title.includes(needle);
  });
}
