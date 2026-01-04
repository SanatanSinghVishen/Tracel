// server/threat_log.js
// Lightweight JSONL persistence for anomaly packets.
// Purpose: keep last-N-hours threat intel available even when MongoDB is not configured.

const fs = require('fs');
const path = require('path');

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function clampInt(raw, min, max, fallback) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

function resolveLogPath(explicitPath) {
  const raw = typeof explicitPath === 'string' ? explicitPath.trim() : '';
  if (raw) return raw;
  return path.join(__dirname, 'threat_events.jsonl');
}

function createThreatLog({
  filePath: explicitPath,
  retentionHours: retentionHoursRaw,
  log,
} = {}) {
  const filePath = resolveLogPath(explicitPath);
  const retentionHours = clampInt(retentionHoursRaw, 1, 168, 24);

  let buffer = '';
  let flushing = false;
  let flushTimer = null;

  async function flushNow() {
    if (flushing) return;
    if (!buffer) return;

    const payload = buffer;
    buffer = '';
    flushing = true;

    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.appendFile(filePath, payload, 'utf8');
    } catch (e) {
      // Re-queue so we don't drop data on transient filesystem issues.
      buffer = payload + buffer;
      if (log?.warn) log.warn('[threat_log] append failed', { error: String(e) });
    } finally {
      flushing = false;
      // If more was queued while we were writing, flush again.
      if (buffer) {
        setImmediate(() => {
          flushNow().catch(() => void 0);
        });
      }
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushNow().catch(() => void 0);
    }, 250);
  }

  function appendThreat(packet) {
    if (!packet || typeof packet !== 'object') return;
    if (!packet.is_anomaly) return;

    // Keep payload minimal but sufficient for threat intel computation.
    const record = {
      owner_user_id: packet.owner_user_id || packet.ownerUserId || 'anon:unknown',
      source_ip: packet.source_ip || null,
      source_country: packet.source_country || null,
      destination_ip: packet.destination_ip || null,
      protocol: packet.protocol || null,
      method: packet.method || null,
      bytes: typeof packet.bytes === 'number' ? packet.bytes : null,
      anomaly_score: typeof packet.anomaly_score === 'number' ? packet.anomaly_score : null,
      is_anomaly: true,
      timestamp: (packet.timestamp instanceof Date) ? packet.timestamp.toISOString() : (packet.timestamp || null),
      attack_vector: packet.attack_vector || null,
    };

    buffer += JSON.stringify(record) + '\n';
    scheduleFlush();
  }

  async function hydrateInto(memoryStore) {
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    let data = '';
    try {
      data = await fs.promises.readFile(filePath, 'utf8');
    } catch (e) {
      // Missing file is normal on first run.
      if (e?.code !== 'ENOENT' && log?.warn) log.warn('[threat_log] read failed', { error: String(e) });
      return { loaded: 0, kept: 0, filePath, retentionHours };
    }

    const lines = data.split(/\r?\n/);
    const kept = [];
    let loaded = 0;

    // Read in chronological order; memoryStore.put() unshifts so we end up newest-first.
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const t = safeDate(obj.timestamp);
      if (!t) continue;
      if (t < cutoff) continue;

      // Only hydrate threats.
      if (!obj.is_anomaly) continue;

      const owner = typeof obj.owner_user_id === 'string' && obj.owner_user_id.trim() ? obj.owner_user_id.trim() : 'anon:unknown';

      const packet = {
        ...obj,
        owner_user_id: owner,
        timestamp: t.toISOString(),
        is_anomaly: true,
      };

      try {
        memoryStore.put(packet);
      } catch {
        // best-effort
      }

      kept.push(JSON.stringify(packet) + '\n');
      loaded += 1;
    }

    // Compact the file so it doesn't grow unbounded.
    try {
      await fs.promises.writeFile(filePath, kept.join(''), 'utf8');
    } catch (e) {
      if (log?.warn) log.warn('[threat_log] compact write failed', { error: String(e) });
    }

    return { loaded, kept: loaded, filePath, retentionHours };
  }

  function startCompactionInterval() {
    // Periodically compact even if the process runs for a long time.
    const intervalMs = 60 * 60 * 1000;
    setInterval(() => {
      // Use a tiny in-memory store placeholder just to rewrite file.
      // We do NOT want to mutate the live memory store here.
      const tmp = { put: () => void 0 };
      hydrateInto(tmp).catch(() => void 0);
    }, intervalMs).unref?.();
  }

  return {
    filePath,
    retentionHours,
    appendThreat,
    hydrateInto,
    flushNow,
    startCompactionInterval,
  };
}

module.exports = { createThreatLog };
