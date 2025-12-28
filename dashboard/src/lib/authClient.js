export function getOrCreateAnonId(storageKey = 'tracel_anon_id') {
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing && typeof existing === 'string') return existing;

    const id = `a_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    window.localStorage.setItem(storageKey, id);
    return id;
  } catch {
    // localStorage may be blocked; sessionStorage generally survives refresh.
    try {
      const existing = window.sessionStorage.getItem(storageKey);
      if (existing && typeof existing === 'string') return existing;

      const id = `a_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      window.sessionStorage.setItem(storageKey, id);
      return id;
    } catch {
      return `a_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    }
  }
}

export async function buildAuthHeaders(getToken, anonId) {
  try {
    const token = typeof getToken === 'function' ? await getToken() : null;
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
  } catch {
    // ignore
  }

  if (anonId) {
    return { 'x-tracel-anon-id': anonId };
  }

  return {};
}
