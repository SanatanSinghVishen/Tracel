// Usage:
//   node server/tools/validate_attack_mode.js <anonId>
//
// What it does:
// - Toggles attack mode ON for anonId, samples for a few seconds, fetches packets since toggle,
//   prints anomaly rate + protocol/port stats.
// - Toggles attack mode OFF, samples again, prints comparison.
//
// Requirements:
// - Node server running (default http://localhost:3001)
// - Python AI running (default http://127.0.0.1:5000)

const path = require('path');

const anonId = process.argv[2] || 'qa-sim';
const baseUrl = process.env.SOCKET_URL || 'http://localhost:3001';
const aiUrl = process.env.AI_URL || 'http://127.0.0.1:5000';
const sampleSecondsOn = Number(process.env.SAMPLE_SECONDS_ON || 6);
const sampleSecondsOff = Number(process.env.SAMPLE_SECONDS_OFF || 20);
const settleMs = Number(process.env.SETTLE_MS || 500);

const minPacketsOn = Number(process.env.MIN_PACKETS_ON || 40);
const minPacketsOff = Number(process.env.MIN_PACKETS_OFF || 20);
const maxWaitSecondsOn = Number(process.env.MAX_WAIT_SECONDS_ON || 20);
const maxWaitSecondsOff = Number(process.env.MAX_WAIT_SECONDS_OFF || 60);

// Reuse the dashboard's socket.io-client dependency to avoid adding server deps.
const clientPath = path.resolve(__dirname, '..', '..', 'dashboard', 'node_modules', 'socket.io-client');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { io } = require(clientPath);

// axios is ESM; in some Node setups require('axios') returns a namespace with .default.
// eslint-disable-next-line import/no-extraneous-dependencies
const axios = require('axios').default || require('axios');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function toggleAttack(mode) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      auth: { anonId },
      transports: ['websocket', 'polling'],
    });

    const done = (err) => {
      try {
        socket.close();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve();
    };

    socket.on('connect', () => {
      socket.emit('toggle_attack', !!mode);
      setTimeout(() => done(null), 150);
    });

    socket.on('connect_error', (err) => {
      done(err);
    });
  });
}

function groupCount(items, key) {
  const map = new Map();
  for (const it of items) {
    const k = it?.[key];
    const kk = k === undefined || k === null ? 'null' : String(k);
    map.set(kk, (map.get(kk) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));
}

function summarize(packets) {
  const total = packets.length;
  const anomalies = packets.filter((p) => !!p?.is_anomaly).length;
  const ratePct = total ? Math.round((anomalies * 10000) / total) / 100 : 0;

  const bytes = packets.map((p) => Number(p?.bytes || 0));
  const entropy = packets.map((p) => Number(p?.entropy ?? NaN)).filter((n) => Number.isFinite(n));

  const bytesMin = bytes.length ? Math.min(...bytes) : null;
  const bytesMax = bytes.length ? Math.max(...bytes) : null;

  const entropyAvg = entropy.length
    ? Math.round((entropy.reduce((a, b) => a + b, 0) / entropy.length) * 1000) / 1000
    : null;

  return {
    total,
    anomalies,
    ratePct,
    bytesMin,
    bytesMax,
    entropyAvg,
    topProtocols: groupCount(packets, 'protocol'),
    topPorts: groupCount(packets, 'dst_port'),
  };
}

async function fetchPacketsSince(sinceIso) {
  const url = new URL('/api/packets', baseUrl);
  url.searchParams.set('limit', '250');
  url.searchParams.set('since', sinceIso);

  let json;
  try {
    const res = await axios.get(url.toString(), {
      headers: {
        'x-tracel-anon-id': anonId,
      },
      timeout: 5000,
      validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GET ${url} failed: ${res.status} ${JSON.stringify(res.data)}`);
    }
    json = res.data;
  } catch (err) {
    throw new Error(`GET ${url} failed: ${err?.message || String(err)}`);
  }
  return Array.isArray(json?.packets) ? json.packets : [];
}

async function ensureAiHealthy() {
  const url = new URL('/health', aiUrl);
  url.searchParams.set('load', '1');

  const res = await axios.get(url.toString(), {
    timeout: 3000,
    validateStatus: () => true,
  });

  // eslint-disable-next-line no-console
  console.log(`AI health: status=${res.status} body=${JSON.stringify(res.data)}`);

  if (res.status < 200 || res.status >= 300 || !res.data?.ok || !res.data?.modelLoaded) {
    throw new Error(
      `AI not ready at ${aiUrl}: status=${res.status} body=${JSON.stringify(res.data)}`
    );
  }
}

async function waitForPacketsSince(sinceIso, { minPackets, maxWaitSeconds } = {}) {
  const deadline = Date.now() + (Number(maxWaitSeconds || 30) * 1000);
  let packets = [];
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    packets = await fetchPacketsSince(sinceIso);
    if (packets.length >= Number(minPackets || 0)) return packets;
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  return packets;
}

async function runPhase(label, mode, sampleSeconds) {
  await toggleAttack(mode);
  // Allow the simulator to apply the mode toggle before we start counting.
  await sleep(settleMs);
  const since = new Date().toISOString();
  await sleep(sampleSeconds * 1000);
  const packets = await waitForPacketsSince(since, {
    minPackets: mode ? minPacketsOn : minPacketsOff,
    maxWaitSeconds: mode ? maxWaitSecondsOn : maxWaitSecondsOff,
  });
  return {
    label,
    mode: mode ? 'attack(on)' : 'attack(off)',
    since,
    sampleSeconds,
    minPackets: mode ? minPacketsOn : minPacketsOff,
    ...summarize(packets),
  };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`Validating Attack Mode for anonId=${anonId} baseUrl=${baseUrl} aiUrl=${aiUrl}`);

  await ensureAiHealthy();

  const on = await runPhase('phase1', true, sampleSecondsOn);
  const off = await runPhase('phase2', false, sampleSecondsOff);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ on, off }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
