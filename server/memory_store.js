// server/memory_store.js
// Lightweight in-memory storage for recent packets, scoped by owner.
// Used as a resilience fallback when Mongo persistence is disabled/unavailable.

const DEFAULT_MAX_PACKETS_PER_OWNER = 5000;

function clampInt(val, min, max, fallback) {
  const n = parseInt(String(val ?? ''), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

function safeDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

class MemoryStore {
  constructor({ maxPerOwner = DEFAULT_MAX_PACKETS_PER_OWNER } = {}) {
    this.maxPerOwner = maxPerOwner;
    this.byOwner = new Map();
  }

  _list(owner) {
    const key = owner || 'anon:unknown';
    let list = this.byOwner.get(key);
    if (!list) {
      list = [];
      this.byOwner.set(key, list);
    }
    return list;
  }

  put(packet) {
    if (!packet || typeof packet !== 'object') return;
    const owner = packet.owner_user_id || packet.ownerUserId || 'anon:unknown';
    const list = this._list(owner);

    list.unshift(packet);
    if (list.length > this.maxPerOwner) list.length = this.maxPerOwner;
  }

  query(owner, query = {}) {
    const list = this._list(owner);

    const limit = clampInt(query.limit, 1, 1000, 200);
    const anomaly = query.anomaly === '1' || query.anomaly === 'true' || query.anomaly === true;

    const ip = typeof query.ip === 'string' ? query.ip.trim() : '';
    const sourceIp = typeof query.source_ip === 'string' ? query.source_ip.trim() : '';
    const ipFilter = sourceIp || ip;

    const since = typeof query.since === 'string' ? safeDate(query.since.trim()) : null;

    const out = [];
    for (const p of list) {
      if (!p) continue;
      if (anomaly && !p.is_anomaly) continue;
      if (ipFilter && p.source_ip !== ipFilter) continue;
      if (since) {
        const t = safeDate(p.timestamp);
        if (!t) continue;
        if (t < since) continue;
      }
      out.push(p);
      if (out.length >= limit) break;
    }

    return out;
  }

  count(owner) {
    return this._list(owner).length;
  }
}

module.exports = { MemoryStore };
