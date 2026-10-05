export function preferencesKey(base, user) {
  return `solvia_preferences:${encodeURIComponent((base || '').replace(/\/+$/, ''))}:${encodeURIComponent(String(user.id ?? user.login ?? ''))}`;
}
export function readPreferences(base, user) {
  try { return JSON.parse(localStorage.getItem(preferencesKey(base, user)) || '{}') || {}; }
  catch { return {}; }
}
export function applyPreferences(prefs = {}) {
  document.documentElement.dataset.reducedMotion = prefs.reducedMotion ? 'true' : 'false';
  document.documentElement.dataset.compact = prefs.compact ? 'true' : 'false';
}
