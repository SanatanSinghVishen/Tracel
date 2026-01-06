export const PREF_KEY_DEFAULT_TRAFFIC_VIEW = 'tracel.pref.defaultTrafficView';

export const PREF_KEY_ACCENT_THEME = 'tracel.pref.accentTheme';

export function readDefaultTrafficView(storage = localStorage) {
  const v = (storage.getItem(PREF_KEY_DEFAULT_TRAFFIC_VIEW) || '').trim();
  return v === 'globe' ? 'globe' : 'bandwidth';
}

export function writeDefaultTrafficView(value, storage = localStorage) {
  const normalized = value === 'globe' ? 'globe' : 'bandwidth';
  storage.setItem(PREF_KEY_DEFAULT_TRAFFIC_VIEW, normalized);
  return normalized;
}

export function readAccentTheme(storage = localStorage) {
  const v = (storage.getItem(PREF_KEY_ACCENT_THEME) || '').trim().toLowerCase();
  return v === 'blue' || v === 'purple' || v === 'emerald' ? v : 'emerald';
}

export function writeAccentTheme(value, storage = localStorage) {
  const normalized = String(value || '').trim().toLowerCase();
  const next = normalized === 'blue' || normalized === 'purple' || normalized === 'emerald' ? normalized : 'emerald';
  storage.setItem(PREF_KEY_ACCENT_THEME, next);
  return next;
}
