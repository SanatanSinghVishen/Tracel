// server/memory_store.js
// Lightweight in-memory storage for recent packets, scoped by owner.
// Used as a resilience fallback when Mongo persistence is disabled/unavailable.

const DEFAULT_MAX_PACKETS_PER_OWNER = parseInt(process.env.MEMORY_STORE_MAX_SIZE || '1000', 10);
const DEFAULT_TTL_MINUTES = parseInt(process.env.MEMORY_STORE_TTL_MINUTES || '30', 10);

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
  /**
   * Initialize the memory store.
   * @param {Object} options Options object.
   * @param {number} [options.maxPerOwner] Max items to keep per owner per list.
   * @param {number} [options.ttlMinutes] Time to live in minutes before eviction on read.
   */
  constructor({ maxPerOwner = DEFAULT_MAX_PACKETS_PER_OWNER, ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
    this.maxPerOwner = maxPerOwner;
    this.ttlMinutes = ttlMinutes;
    this.packetsByOwner = new Map();
    this.threatsByOwner = new Map();
  }

  /**
   * Clear all stored packets and threats.
   */
  clearAll() {
    this.packetsByOwner.clear();
    this.threatsByOwner.clear();
  }

  _getList(map, owner) {
    const key = owner || 'anon:unknown';
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    return list;
  }

  _evictExpired(list) {
    if (this.ttlMinutes <= 0) return list;
    const now = Date.now();
    const ttlMs = this.ttlMinutes * 60 * 1000;
    // Iterate from the end (oldest items) and remove expired
    let dropCount = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const t = safeDate(p.timestamp);
      if (t && now - t.getTime() > ttlMs) {
        dropCount++;
      } else {
        break; // since list is newest-first, if this isn't expired, newer ones aren't either
      }
    }
    if (dropCount > 0) {
      list.splice(list.length - dropCount, dropCount);
    }
    return list;
  }

  /**
   * Get all packets for an owner.
   * @param {string} owner The owner user ID.
   * @returns {Array} Array of packets (newest first).
   */
  getAll(owner) {
    const list = this._getList(this.packetsByOwner, owner);
    this._evictExpired(list);
    return list.slice();
  }

  /**
   * Insert a new packet/threat.
   * @param {Object} packet The packet data.
   */
  put(packet) {
    if (!packet || typeof packet !== 'object') return;
    const owner = packet.owner_user_id || packet.ownerUserId || 'anon:unknown';
    
    // Always put in packets
    const packetsList = this._getList(this.packetsByOwner, owner);
    packetsList.unshift(packet);
    if (packetsList.length > this.maxPerOwner) packetsList.length = this.maxPerOwner;

    // Put in threats if anomaly
    if (packet.is_anomaly) {
      const threatsList = this._getList(this.threatsByOwner, owner);
      threatsList.unshift(packet);
      if (threatsList.length > this.maxPerOwner) threatsList.length = this.maxPerOwner;
    }
  }

  /**
   * Query packets or threats.
   * @param {string} owner The owner user ID.
   * @param {Object} query Query filters.
   * @returns {Array} Filtered list.
   */
  query(owner, query = {}) {
    const anomaly = query.anomaly === '1' || query.anomaly === 'true' || query.anomaly === true;
    const map = anomaly ? this.threatsByOwner : this.packetsByOwner;
    const list = this._getList(map, owner);
    this._evictExpired(list);

    const limit = clampInt(query.limit, 1, this.maxPerOwner, 200);

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

  /**
   * Count the number of packets for an owner.
   * @param {string} owner The owner user ID.
   * @returns {number} Packet count.
   */
  count(owner) {
    const list = this._getList(this.packetsByOwner, owner);
    this._evictExpired(list);
    return list.length;
  }

  /**
   * Get store statistics.
   * @returns {Object} Store stats.
   */
  getStats() {
    let totalSize = 0;
    let oldest = null;
    let newest = null;

    for (const list of this.packetsByOwner.values()) {
      this._evictExpired(list);
      totalSize += list.length;
      
      if (list.length > 0) {
        const n = safeDate(list[0].timestamp);
        const o = safeDate(list[list.length - 1].timestamp);
        
        if (n && (!newest || n > newest)) newest = n;
        if (o && (!oldest || o < oldest)) oldest = o;
      }
    }

    return {
      size: totalSize,
      maxSize: this.maxPerOwner,
      oldestEntry: oldest ? oldest.toISOString() : null,
      newestEntry: newest ? newest.toISOString() : null,
    };
  }
}

module.exports = { MemoryStore };
