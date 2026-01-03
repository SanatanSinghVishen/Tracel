// server/traffic_simulator.js
const axios = require('axios');
const http = require('http');
const https = require('https');
const log = require('./logger');

let lastAiWarnAt = 0;
function warnAiOncePerInterval(message, meta) {
    const now = Date.now();
    if (now - lastAiWarnAt < 10_000) return;
    lastAiWarnAt = now;
    log.warn(message, meta || undefined);
}

const TARGET_IP = "10.0.0.1";
// Simulate multiple internal services behind a load balancer / subnet.
const TARGET_SERVICE_IPS = [
    '10.0.0.1',
    '10.0.0.2',
    '10.0.0.3',
    '10.0.0.4',
    '10.0.0.5',
];

// Hostile “botnet” IPs (high-risk-looking prefixes like 45.* and 103.*)
// so the 3D globe can visualize diverse origins.
// Note: These are example-looking IPs for simulation only.
const BOTNET_IPS = [
    '45.67.89.12',
    '45.142.211.34',
    '45.155.204.77',
    '45.83.12.77',
    '45.9.148.201',
    '103.14.55.2',
    '103.74.118.91',
    '103.152.79.44',
    '103.195.103.240',
    '103.21.244.10',
];

// Safe/local sources for normal traffic (RFC1918).
const SAFE_IPS = [
    '192.168.0.10',
    '192.168.0.11',
    '192.168.0.12',
    '192.168.1.20',
    '192.168.1.21',
    '192.168.1.22',
    '192.168.2.30',
    '192.168.2.31',
];

const NORMAL_DST_PORTS = [80, 443, 8080];
const ATTACK_DST_PORTS = [
    23, // telnet
    53, // dns
    123, // ntp
    445, // smb
    3389, // rdp
    1900, // ssdp
    4444, // demo backdoor-ish port
];

function getAiPredictUrl() {
    const explicit = String(process.env.AI_PREDICT_URL || '').trim();
    if (explicit) return explicit;

    const base = String(process.env.AI_ENGINE_URL || '').trim();
    if (base) {
        if (/\/predict\/?$/i.test(base)) return base;
        try {
            return new URL('/predict', base).toString();
        } catch {
            // Fall through
        }
    }

    return 'http://127.0.0.1:5000/predict';
}

function isAiDisabled() {
    const raw = String(process.env.AI_DISABLED || process.env.DISABLE_AI || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

const aiHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const aiHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const aiClient = axios.create({
    timeout: 3000,
    httpAgent: aiHttpAgent,
    httpsAgent: aiHttpsAgent,
});

function getRandomTargetServiceIP() {
    return TARGET_SERVICE_IPS[Math.floor(Math.random() * TARGET_SERVICE_IPS.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

function clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function parseRatio01(raw, fallback = 0.6) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return clamp01(fallback);
    // Support either 0..1 (e.g. 0.6) or 0..100 (e.g. 60 meaning 60%).
    if (n > 1) return clamp01(n / 100);
    return clamp01(n);
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(items) {
    const total = items.reduce((sum, it) => sum + (it.weight || 0), 0);
    if (!Number.isFinite(total) || total <= 0) return items[0]?.value;
    let r = Math.random() * total;
    for (const it of items) {
        r -= it.weight || 0;
        if (r <= 0) return it.value;
    }
    return items[items.length - 1]?.value;
}

function randomLocalIp() {
    // Keep inside 192.168/16 but vary hosts for “multiple clients”.
    const c = randomInt(0, 3);
    const d = randomInt(2, 254);
    return `192.168.${c}.${d}`;
}

function makeHighEntropyPayload(len = 256) {
    // Base64-ish high-entropy string (cheap simulation; keeps JSON reasonable).
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let out = '';
    for (let i = 0; i < len; i += 1) out += alphabet[randomInt(0, alphabet.length - 1)];
    return out;
}

function makeLowEntropyPayload() {
    const templates = [
        '{"ok":true,"route":"/","status":200}',
        '{"action":"ping","ok":true}',
        '<html><body>Hello</body></html>',
        'id=123&ok=true&v=1',
    ];
    return pick(templates);
}

function generateNormalTraffic({ owner } = {}) {
    const protocol = weightedPick([
        { value: 'HTTP', weight: 0.55 },
        { value: 'TCP', weight: 0.35 },
        { value: 'UDP', weight: 0.07 },
        { value: 'ICMP', weight: 0.03 },
    ]);

    const method = (() => {
        if (protocol === 'ICMP') return 'PING';
        if (protocol === 'UDP') return weightedPick([{ value: 'GET', weight: 0.7 }, { value: 'POST', weight: 0.3 }]);
        return weightedPick([
            { value: 'GET', weight: 0.85 },
            { value: 'POST', weight: 0.10 },
            { value: 'PUT', weight: 0.04 },
            { value: 'DELETE', weight: 0.01 },
        ]);
    })();

    const entropy = clamp01(randomFloat(0.1, 0.5));
    const dst_port = pick(NORMAL_DST_PORTS);

    return {
        owner_user_id: owner || undefined,
        source_ip: Math.random() < 0.8 ? pick(SAFE_IPS) : randomLocalIp(),
        destination_ip: TARGET_IP,
        protocol,
        method,
        // Keep close to the “normal” training distribution (~100–1000 bytes).
        bytes: randomInt(150, 950),
        entropy,
        dst_port,
        high_entropy: entropy >= 0.75,
        payload: Math.random() < 0.15 ? makeLowEntropyPayload() : null,
        timestamp: new Date(),
    };
}

function generateAttackTraffic({ owner } = {}) {
    const protocol = weightedPick([
        { value: 'UDP', weight: 0.45 },
        { value: 'ICMP', weight: 0.25 },
        { value: 'TCP', weight: 0.20 },
        { value: 'HTTP', weight: 0.10 },
    ]);

    const method = (() => {
        if (protocol === 'ICMP') return 'PING';
        if (protocol === 'UDP') return 'FLOOD';
        return weightedPick([
            { value: 'POST', weight: 0.55 },
            { value: 'DELETE', weight: 0.25 },
            { value: 'CONNECT', weight: 0.15 },
            { value: 'GET', weight: 0.05 },
        ]);
    })();

    const bytes = weightedPick([
        { value: randomInt(80, 1200), weight: 0.55 },
        { value: randomInt(1000, 50000), weight: 0.45 },
    ]);

    const entropy = clamp01(randomFloat(0.8, 1.0));
    const dst_port = weightedPick([
        { value: pick(ATTACK_DST_PORTS), weight: 0.85 },
        { value: randomInt(1, 65535), weight: 0.15 },
    ]);

    return {
        owner_user_id: owner || undefined,
        source_ip: pick(BOTNET_IPS),
        destination_ip: getRandomTargetServiceIP(),
        protocol,
        method,
        bytes,
        entropy,
        dst_port,
        high_entropy: entropy >= 0.75,
        payload: makeHighEntropyPayload(randomInt(96, 512)),
        timestamp: new Date(),
    };
}

function getPacketData(isAttackMode, { owner } = {}) {
    if (!isAttackMode) return generateNormalTraffic({ owner });

    // Fog of War (mixed traffic): not every packet is malicious.
    // Target: 60% malicious / 40% normal (configurable).
    const ratioRaw = process.env.ATTACK_MALICIOUS_RATIO;
    const ratio = parseRatio01(ratioRaw, 0.6);
    const isMalicious = Math.random() < ratio;
    return isMalicious ? generateAttackTraffic({ owner }) : generateNormalTraffic({ owner });
}

function createTrafficStream({ owner, emitPacket, persistPacket } = {}) {
    let isAttackMode = false;
    let timer = null;
    let running = false;

    function setAttackMode(mode) {
        isAttackMode = !!mode;
        log.debug(`[SIMULATOR] Attack Mode for ${owner || 'unknown'} set to: ${isAttackMode}`);
    }

    function stop() {
        running = false;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    async function generatePacket() {
        if (!running) return;

        // Generate behavior-based packet data (no hardcoded anomaly overrides).
        const packetData = getPacketData(isAttackMode, { owner });

        // --- STEP 1: ASK AI FOR VERDICT ---
        if (!isAiDisabled()) {
            try {
                const aiId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const response = await aiClient.post(
                    getAiPredictUrl(),
                    {
                        id: aiId,
                        bytes: packetData.bytes,
                        method: packetData.method,
                        // Advanced features for updated AI model (Step 2).
                        protocol: packetData.protocol,
                        entropy: packetData.entropy,
                        dst_port: packetData.dst_port,
                    },
                    undefined
                );

                // Raw score only (lower => more anomalous). Node will threshold it dynamically.
                // Back-compat: some older AI versions returned { anomaly_score, is_anomaly }.
                const rawScore = response?.data?.score ?? response?.data?.anomaly_score ?? response?.data?.anomalyScore;
                const scoreNum = Number(rawScore);
                packetData.anomaly_score = Number.isFinite(scoreNum) ? scoreNum : null;
                packetData.ai_id = response?.data?.id || response?.data?.ai_id || aiId;
                packetData.is_anomaly = false;
            } catch (error) {
                packetData.is_anomaly = false;
                packetData.anomaly_score = null;

                const status = error?.response?.status;
                const detail = error?.response?.data;
                const code = error?.code;
                const msg = error?.message;
                warnAiOncePerInterval('[SIMULATOR] AI score unavailable (using null score)', {
                    url: getAiPredictUrl(),
                    code,
                    status,
                    message: msg,
                    detail,
                });
            }
        } else {
            packetData.is_anomaly = false;
            packetData.anomaly_score = null;
        }

        // --- STEP 2: EMIT & SAVE ---
        if (typeof emitPacket === 'function') {
            try {
                emitPacket(packetData);
            } catch (e) {
                log.warn('emitPacket failed', e);
            }
        }

        if (typeof persistPacket === 'function') {
            try {
                persistPacket(packetData);
            } catch (e) {
                log.warn('persistPacket failed', e);
            }
        }

        const delay = isAttackMode
            ? (Math.random() < 0.15 ? 10 : (Math.floor(Math.random() * 70) + 20))
            : randomInt(1000, 10000);

        timer = setTimeout(generatePacket, delay);
    }

    function start() {
        if (running) return;
        running = true;
        generatePacket();
    }

    return {
        start,
        stop,
        setAttackMode,
        get isAttackMode() {
            return isAttackMode;
        },
    };
}

module.exports = { createTrafficStream };