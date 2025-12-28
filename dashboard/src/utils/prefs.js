export const PREF_KEY_DEFAULT_TRAFFIC_VIEW = 'tracel.pref.defaultTrafficView';

export function readDefaultTrafficView(storage = localStorage) {
  const v = (storage.getItem(PREF_KEY_DEFAULT_TRAFFIC_VIEW) || '').trim();
  return v === 'globe' ? 'globe' : 'bandwidth';
}

export function writeDefaultTrafficView(value, storage = localStorage) {
  const normalized = value === 'globe' ? 'globe' : 'bandwidth';
  storage.setItem(PREF_KEY_DEFAULT_TRAFFIC_VIEW, normalized);
  return normalized;
}
