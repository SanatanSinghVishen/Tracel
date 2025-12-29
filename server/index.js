// server/index.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
// server/index.js (Additions)

require('dotenv').config(); // Load the .env file

// Step 1: Define Static Knowledge
const PROJECT_INFO = "Tracel is a Real-Time AI Network Analyzer. Frontend: React + Tailwind. Backend: Node.js + Socket.io. AI Engine: Python + Isolation Forest. Features: 3D Globe, Attack Simulation, RBAC, and MongoDB Forensics.";

// Groq client initialization (used by /api/chat)
// Note: groq-sdk may ship as ESM; use dynamic import() for Node 25 compatibility.
let groqClient = null;
let groqClientInitAttempted = false;

async function getGroqClient() {
    if (groqClient) return groqClient;
    if (groqClientInitAttempted) return null;
    groqClientInitAttempted = true;

    const apiKey = String(process.env.GROQ_API_KEY || '').trim();
    if (!apiKey) return null;

    const mod = await import('groq-sdk');
    const Groq = mod?.default || mod?.Groq || mod;
    if (!Groq) return null;

    groqClient = new Groq({ apiKey });
    return groqClient;
}

const mongoose = require('mongoose');
const Packet = require('./models/Packet');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');

const log = require('./logger');

const { MemoryStore } = require('./memory_store');

const { createTrafficStream } = require('./traffic_simulator');

function getAiPredictUrl() {
    return String(process.env.AI_PREDICT_URL || 'http://127.0.0.1:5000/predict').trim();
}

function getAiHealthUrl() {
    const raw = String(process.env.AI_HEALTH_URL || '').trim();
    if (raw) return raw;

    const predict = getAiPredictUrl();
    // Common pattern: /predict -> /health?load=1
    if (/\/predict\/?$/i.test(predict)) {
        return predict.replace(/\/predict\/?$/i, '/health?load=1');
    }
    // Fallback: just try /health?load=1 off the same origin.
    try {
        const u = new URL(predict);
        u.pathname = '/health';
        u.search = 'load=1';
        return u.toString();
    } catch {
        return 'http://127.0.0.1:5000/health?load=1';
    }
}

const aiStatus = {
    ok: false,
    modelLoaded: null,
    threshold: null,
    lastCheckedAt: null,
    lastOkAt: null,
    lastError: null,
};

let lastAiStatusBroadcastOk = null;

async function pollAiHealthOnce() {
    const nowIso = new Date().toISOString();
    aiStatus.lastCheckedAt = nowIso;
    try {
        const res = await axios.get(getAiHealthUrl(), { timeout: 1500 });
        const ok = !!res?.data?.ok;
        const modelLoaded = typeof res?.data?.modelLoaded === 'boolean' ? res.data.modelLoaded : null;
        const thrRaw = res?.data?.threshold;
        const threshold = Number(thrRaw);

        aiStatus.ok = ok;
        aiStatus.modelLoaded = modelLoaded;
        aiStatus.threshold = Number.isFinite(threshold) ? threshold : null;
        aiStatus.lastError = null;
        if (ok) aiStatus.lastOkAt = nowIso;
    } catch (e) {
        aiStatus.ok = false;
        aiStatus.modelLoaded = null;
        aiStatus.threshold = null;
        aiStatus.lastError = {
            message: e?.message,
            code: e?.code,
            status: e?.response?.status,
        };
    }

    // Broadcast only when ok-state flips.
    if (lastAiStatusBroadcastOk === null || lastAiStatusBroadcastOk !== aiStatus.ok) {
        lastAiStatusBroadcastOk = aiStatus.ok;
        try {
            io.emit('ai_status', { ...aiStatus });
        } catch {
            // best-effort
        }
    }
}

setInterval(() => {
    pollAiHealthOnce().catch(() => void 0);
}, Math.max(2000, Math.min(parseInt(process.env.AI_HEALTH_POLL_MS || '5000', 10) || 5000, 60_000)));
pollAiHealthOnce().catch(() => void 0);

const memoryStore = new MemoryStore({
    maxPerOwner: Math.max(100, Math.min(parseInt(process.env.MEMORY_MAX_PACKETS || '5000', 10), 50_000))
});

// Persist per-user/session simulation preferences in-memory.
// This keeps behavior stable across refreshes/page changes.
const attackModeByOwner = new Map();

// Keep a per-owner traffic stream alive briefly after the last client disconnects.
// This prevents “refresh resets everything” by avoiding stream teardown during navigation.
const STREAM_IDLE_TTL_MS = Math.max(5_000, Math.min(parseInt(process.env.STREAM_IDLE_TTL_MS || '60000', 10), 10 * 60_000));
const OWNER_ROOM_PREFIX = 'owner:';
const streamsByOwner = new Map();
const ownerEmailByOwner = new Map();

class DynamicThresholdManager {
    constructor({ baselineSize = 1000, warmup = 20, k = 2, minStdDev = 1e-6 } = {}) {
        this.baselineSize = baselineSize;
        this.warmup = warmup;
        this.k = k;
        this.minStdDev = minStdDev;

        this._scores = [];
        this._sum = 0;
        this._sumSq = 0;

        this.mean = null;
        this.stdDev = null;
        this.threshold = null;
    }

    _recompute() {
        const n = this._scores.length;
        if (n <= 0) {
            this.mean = null;
            this.stdDev = null;
            this.threshold = null;
            return;
        }

        const mean = this._sum / n;
        const variance = Math.max(0, (this._sumSq / n) - (mean * mean));
        const stdDev = Math.max(Math.sqrt(variance), this.minStdDev);

        this.mean = mean;
        this.stdDev = stdDev;
        this.threshold = mean - (this.k * stdDev);
    }

    learn(score) {
        const s = Number(score);
        if (!Number.isFinite(s)) return;

        this._scores.push(s);
        this._sum += s;
        this._sumSq += s * s;

        while (this._scores.length > this.baselineSize) {
            const old = this._scores.shift();
            this._sum -= old;
            this._sumSq -= old * old;
        }

        this._recompute();
    }

    get baselineN() {
        return this._scores.length;
    }

    get warmedUp() {
        return this.baselineN >= this.warmup && this.threshold !== null && Number.isFinite(this.threshold);
    }

    isAnomaly(score) {
        const s = Number(score);
        if (!Number.isFinite(s)) return false;
        if (!this.warmedUp) return false;
        return s < this.threshold;
    }

    snapshot() {
        return {
            baselineN: this.baselineN,
            warmedUp: this.warmedUp,
            mean: this.mean,
            stdDev: this.stdDev,
            threshold: this.threshold,
            k: this.k,
        };
    }
}

function getOwnerRoom(ownerUserId) {
    return `${OWNER_ROOM_PREFIX}${ownerUserId}`;
}

function startOrGetOwnerStream(ownerUserId) {
    const existing = streamsByOwner.get(ownerUserId);
    if (existing?.stream) {
        if (existing.stopTimer) {
            clearTimeout(existing.stopTimer);
            existing.stopTimer = null;
        }
        return existing;
    }

    const room = getOwnerRoom(ownerUserId);

    const entry = {
        ownerUserId,
        room,
        sockets: new Set(),
        stopTimer: null,
        stream: null,
        counters: {
            packets: 0,
            threats: 0,
            startedAt: new Date(),
        },
        thresholdMgr: new DynamicThresholdManager({
            baselineSize: (() => {
                const raw = String(process.env.DYNAMIC_THRESHOLD_BASELINE_SIZE || '1000').trim();
                const parsed = parseInt(raw, 10);
                if (!Number.isFinite(parsed)) return 1000;
                return Math.max(50, Math.min(parsed, 50_000));
            })(),
            warmup: (() => {
                const raw = String(process.env.DYNAMIC_THRESHOLD_WARMUP || '20').trim();
                const parsed = parseInt(raw, 10);
                if (!Number.isFinite(parsed)) return 20;
                return Math.max(5, Math.min(parsed, 5000));
            })(),
            k: (() => {
                const raw = String(process.env.DYNAMIC_THRESHOLD_K || '2').trim();
                const parsed = parseFloat(raw);
                if (!Number.isFinite(parsed)) return 2;
                return Math.max(0.5, Math.min(parsed, 5));
            })(),
            minStdDev: 1e-6,
        }),
    };

    entry.stream = createTrafficStream({
        owner: ownerUserId,
        emitPacket: (packetData) => {
            const isAttackMode = !!entry.stream?.isAttackMode;
            const score = packetData?.anomaly_score;
            const aiScored = Number.isFinite(Number(score));
            packetData.ai_scored = aiScored;

            // Learning phase:
            // - Primary: learn on normal traffic only.
            // - Bootstrap: if the user enables Attack mode immediately (no warmup yet),
            //   allow the baseline to learn from packets that are clearly safe per the
            //   AI engine's calibrated threshold.
            if (!isAttackMode) {
                entry.thresholdMgr.learn(score);
            } else if (aiScored && !entry.thresholdMgr.warmedUp && Number.isFinite(Number(aiStatus.threshold))) {
                const s = Number(score);
                const safeFloor = Number(aiStatus.threshold);
                if (Number.isFinite(s) && s >= safeFloor) {
                    entry.thresholdMgr.learn(s);
                }
            }

            // Detection phase: always active.
            // Primary: dynamic threshold once warmed up.
            // Fallback (pre-warmup): use AI engine's calibrated threshold if available.
            let dynamicIsAnomaly = entry.thresholdMgr.isAnomaly(score);
            const t = entry.thresholdMgr.snapshot();

            if (!dynamicIsAnomaly && aiScored && !t.warmedUp && Number.isFinite(Number(aiStatus.threshold))) {
                dynamicIsAnomaly = Number(score) < Number(aiStatus.threshold);
            }

            // Overwrite any simulator-provided label (AI now returns score only).
            packetData.is_anomaly = !!dynamicIsAnomaly;
            packetData.anomaly_threshold = t.threshold ?? aiStatus.threshold;
            packetData.anomaly_mean = t.mean;
            packetData.anomaly_stddev = t.stdDev;
            packetData.anomaly_baseline_n = t.baselineN;
            packetData.anomaly_warmed_up = t.warmedUp;

            // Maintain a per-owner session total so UI remains consistent across refresh.
            entry.counters.packets += 1;
            if (packetData.is_anomaly) entry.counters.threats += 1;

            const packetWithSession = {
                ...packetData,
                session_total_packets: entry.counters.packets,
                session_total_threats: entry.counters.threats,
                session_started_at: entry.counters.startedAt.toISOString(),
            };

            // Deliver to the owner room.
            io.to(room).emit('packet', packetWithSession);
        },
        persistPacket: (packetData) => {
            const ownerEmail = ownerEmailByOwner.get(ownerUserId);
            persistPacket({
                ...packetData,
                owner_user_id: ownerUserId,
                owner_email: ownerEmail || undefined,
            });
        },
    });

    // Restore remembered mode.
    const remembered = attackModeByOwner.get(ownerUserId);
    if (typeof remembered === 'boolean') {
        entry.stream.setAttackMode(remembered);
    }

    entry.stream.start();
    streamsByOwner.set(ownerUserId, entry);
    return entry;
}

function scheduleStopIfIdle(ownerUserId) {
    const entry = streamsByOwner.get(ownerUserId);
    if (!entry) return;
    if (entry.stopTimer) return;
    if (entry.sockets.size > 0) return;

    entry.stopTimer = setTimeout(() => {
        const cur = streamsByOwner.get(ownerUserId);
        if (!cur) return;
        if (cur.sockets.size > 0) {
            cur.stopTimer = null;
            return;
        }
        try {
            cur.stream?.stop?.();
        } finally {
            streamsByOwner.delete(ownerUserId);
        }
    }, STREAM_IDLE_TTL_MS);
}

const DASHBOARD_ORIGINS = (process.env.DASHBOARD_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (DASHBOARD_ORIGINS.includes(origin)) return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const corsOptions = {
    origin: (origin, cb) => {
        if (isAllowedOrigin(origin)) return cb(null, true);
        return cb(null, false);
    },
    credentials: true,
};

function parseCookies(cookieHeader) {
    const out = {};
    if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) return out;
    const parts = cookieHeader.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (!k) continue;
        out[k] = decodeURIComponent(v);
    }
    return out;
}

function createSessionId() {
    return `s_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function formatSessionCookie(sid) {
    // 7 days
    const maxAge = 7 * 24 * 60 * 60;
    return `tracel_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function getSessionIdFromHeaders(headers) {
    const cookieHeader = headers?.cookie;
    const cookies = parseCookies(cookieHeader);
    const sid = cookies.tracel_sid;
    return typeof sid === 'string' && sid.trim() ? sid.trim() : '';
}

function ensureSessionCookie(req, res, next) {
    const sid = getSessionIdFromHeaders(req.headers);
    if (sid) return next();

    const fresh = createSessionId();
    res.append('Set-Cookie', formatSessionCookie(fresh));
    return next();
}

const app = express();
app.use(express.json());
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(ensureSessionCookie);

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: (origin, cb) => {
            if (isAllowedOrigin(origin)) return cb(null, true);
            return cb(null, false);
        },
        credentials: true,
        methods: ["GET", "POST"]
    }
});

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_USER_ID = (process.env.ADMIN_USER_ID || '').trim();
const CLERK_JWKS_URL = (process.env.CLERK_JWKS_URL || '').trim();

const jwksClient = CLERK_JWKS_URL
    ? jwksRsa({
        jwksUri: CLERK_JWKS_URL,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
    })
    : null;

function getBearerTokenFromHeaders(headers) {
    const auth = headers?.authorization;
    if (typeof auth !== 'string') return '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : '';
}

function getAnonIdFromHeaders(headers) {
    const anon = headers?.['x-tracel-anon-id'];
    return typeof anon === 'string' ? anon.trim() : '';
}

function safeDecodeJwtPayload(token) {
    try {
        const payload = jwt.decode(token);
        return payload && typeof payload === 'object' ? payload : null;
    } catch {
        return null;
    }
}

function verifyJwtIfConfigured(token) {
    if (!jwksClient) return Promise.resolve(null);
    return new Promise((resolve) => {
        jwt.verify(
            token,
            (header, cb) => {
                jwksClient.getSigningKey(header.kid, (err, key) => {
                    if (err) return cb(err);
                    const signingKey = key.getPublicKey();
                    return cb(null, signingKey);
                });
            },
            {
                algorithms: ['RS256'],
            },
            (err, decoded) => {
                if (err) return resolve(null);
                return resolve(decoded && typeof decoded === 'object' ? decoded : null);
            }
        );
    });
}

function extractEmailFromClaims(claims) {
    if (!claims || typeof claims !== 'object') return '';
    const candidates = [
        claims.email,
        claims.email_address,
        claims.primary_email,
        claims?.user?.email,
    ];
    const email = candidates.find((v) => typeof v === 'string' && v.includes('@'));
    return (email || '').trim().toLowerCase();
}

async function getAuthContextFromHeaders(headers) {
    const token = getBearerTokenFromHeaders(headers);
    const anonId = getAnonIdFromHeaders(headers);
    const sid = getSessionIdFromHeaders(headers);

    if (!token) {
        return {
            ownerUserId: sid ? `sess:${sid}` : (anonId ? `anon:${anonId}` : `sess:${createSessionId()}`),
            ownerEmail: '',
            isAdmin: false,
            verified: false,
        };
    }

    const verifiedClaims = await verifyJwtIfConfigured(token);
    const claims = verifiedClaims || safeDecodeJwtPayload(token);

    const userId = typeof claims?.sub === 'string' && claims.sub.trim() ? claims.sub.trim() : '';
    const email = extractEmailFromClaims(claims);

    const isAdmin = (
        (ADMIN_USER_ID && userId && userId === ADMIN_USER_ID)
        || (ADMIN_EMAIL && email && email === ADMIN_EMAIL)
    );

    return {
        ownerUserId: userId || (sid ? `sess:${sid}` : (anonId ? `anon:${anonId}` : `sess:${createSessionId()}`)),
        ownerEmail: email,
        isAdmin,
        verified: !!verifiedClaims,
    };
}

// CONNECT TO MONGODB (optional)
mongoose.set('bufferCommands', false);

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
    log.info('MONGO_URL not set — running without persistence');
} else {
    mongoose.connect(mongoUrl)
        .then(() => log.info('MongoDB connected'))
        .catch((err) => log.error('MongoDB connection error', err));
}

function persistPacket(packetData) {
    // Always keep a recent in-memory history so the dashboard can function
    // even when Mongo is not configured or temporarily unavailable.
    try {
        memoryStore.put(packetData);
    } catch {
        // Best-effort only.
    }

    // Persist to Mongo only if configured and connected. Avoid buffering.
    if (!mongoUrl) return;
    if (mongoose.connection.readyState !== 1) return;
    Packet.create(packetData).catch((err) => log.warn('Mongo persistPacket failed', err));
}

function isMongoConnected() {
    return !!mongoUrl && mongoose.connection.readyState === 1;
}

function safeDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function buildPacketFilterFromQuery(query, { ownerUserId, isAdmin }) {
    const limit = Math.max(1, Math.min(parseInt(query.limit || '200', 10), 1000));

    // Scope all queries to the current owner.
    // (Admin “mine/all users” feature removed.)
    const effectiveOwner = ownerUserId;

    const filter = {
        limit,
        owner_user_id: effectiveOwner,
        is_anomaly: query.anomaly === '1' || query.anomaly === 'true' ? true : null,
        source_ip: null,
        since: null,
    };

    const sourceIp = typeof query.source_ip === 'string' ? query.source_ip.trim() : '';
    const legacyIp = typeof query.ip === 'string' ? query.ip.trim() : '';
    const ip = sourceIp || legacyIp;
    if (ip) filter.source_ip = ip;

    if (typeof query.since === 'string' && query.since.trim()) {
        filter.since = safeDate(query.since.trim());
    }

    return filter;
}

function memoryQueryPackets(filter) {
    const limit = filter.limit;
    const query = {
        limit,
        anomaly: filter.is_anomaly ? '1' : undefined,
        source_ip: filter.source_ip || undefined,
        ip: filter.source_ip || undefined,
        since: filter.since ? filter.since.toISOString() : undefined,
    };

    return memoryStore.query(filter.owner_user_id, query);
}

function computeThreatIntelFromPackets(packets) {
    // Must stay in sync with dashboard/src/utils/geoData.js ordering.
    function ipToCountryName(ip) {
        const countries = [
            'United States',
            'Canada',
            'Brazil',
            'United Kingdom',
            'Germany',
            'Russia',
            'China',
            'Japan',
            'Australia',
            'South Africa',
        ];

        const s = typeof ip === 'string' ? ip.trim() : '';
        const firstPart = s.split('.')[0];
        const first = Number.parseInt(firstPart, 10);

        if (!Number.isFinite(first) || first < 0) return countries[0];
        return countries[Math.abs(first) % countries.length];
    }

    const anomalies = (Array.isArray(packets) ? packets : []).filter((p) => p && p.is_anomaly);
    const totalThreats = anomalies.length;

    const byIp = new Map();
    for (const p of anomalies) {
        const ip = typeof p.source_ip === 'string' ? p.source_ip : '';
        if (!ip) continue;
        const prev = byIp.get(ip) || { ip, count: 0, lastSeen: null };
        prev.count += 1;
        const t = safeDate(p.timestamp);
        if (t && (!prev.lastSeen || t > prev.lastSeen)) prev.lastSeen = t;
        byIp.set(ip, prev);
    }

    const topHostileIps = Array.from(byIp.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((r) => ({
            ip: r.ip,
            count: r.count,
            lastSeen: r.lastSeen ? r.lastSeen.toISOString() : null,
        }));

    const vectors = {
        Volumetric: 0,
        Protocol: 0,
        Application: 0,
    };

    const confidence = {
        Obvious: 0,
        Subtle: 0,
        Other: 0,
    };

    for (const p of anomalies) {
        const bytes = typeof p.bytes === 'number' ? p.bytes : 0;
        const method = typeof p.method === 'string' ? p.method.toUpperCase() : '';
        const score = typeof p.anomaly_score === 'number' ? p.anomaly_score : 0;

        if (bytes >= 4000) vectors.Volumetric += 1;
        else if (method && method !== 'GET') vectors.Application += 1;
        else vectors.Protocol += 1;

        if (score >= 0.75) confidence.Obvious += 1;
        else if (score >= 0.35) confidence.Subtle += 1;
        else confidence.Other += 1;
    }

    const attackVectorDistribution = Object.entries(vectors).map(([name, value]) => ({ name, value }));
    const aiConfidenceDistribution = Object.entries(confidence).map(([bucket, count]) => ({ bucket, count }));

    const byCountry = new Map();
    for (const p of anomalies) {
        const explicit = typeof p.source_country === 'string' ? p.source_country.trim() : '';
        const country = explicit || ipToCountryName(p.source_ip);
        byCountry.set(country, (byCountry.get(country) || 0) + 1);
    }

    const geoTopCountries = Array.from(byCountry.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({
            name,
            count,
            pct: totalThreats ? Math.round((count / totalThreats) * 100) : 0,
        }));

    return {
        ok: true,
        degraded: true,
        source: 'memory',
        generatedAt: new Date().toISOString(),
        totalThreats,
        topHostileIps,
        attackVectorDistribution,
        geoTopCountries,
        aiConfidenceDistribution,
        aiConfidenceDefinition:
            'Heuristic confidence based on recent in-memory packets (score buckets: Obvious ≥ 0.75, Subtle ≥ 0.35, Other otherwise).',
        aiConfidenceThresholds: { obviousGte: 0.75, subtleGte: 0.35 },
    };
}

async function getThreatIntelReportFromHeaders(headers, { sinceHours = 24, limit = 10000 } = {}) {
    try {
        const base = process.env.AI_ENGINE_URL || process.env.AI_PREDICT_URL || 'http://127.0.0.1:5000';
        const reportBase = String(base).replace(/\/predict\/?$/, '');

        const auth = await getAuthContextFromHeaders(headers);

        const u = new URL('/report/threat-intel', reportBase);
        u.searchParams.set('sinceHours', String(sinceHours));
        u.searchParams.set('limit', String(limit));
        u.searchParams.set('ownerUserId', auth.ownerUserId);

        const response = await axios.get(u.toString(), { timeout: 2500 });
        if (response?.data?.ok === false) {
            throw Object.assign(new Error(response?.data?.error || 'AI report failed'), { response });
        }

        return response.data;
    } catch {
        // Fallback: compute from in-memory packets to keep results consistent and available.
        const auth = await getAuthContextFromHeaders(headers);
        const hrs = Math.max(1, Math.min(parseInt(String(sinceHours || 24), 10), 168));
        const cutoff = new Date(Date.now() - hrs * 60 * 60 * 1000);

        const filter = {
            limit: Math.max(1000, Math.min(parseInt(String(limit || 10000), 10), 50_000)),
            owner_user_id: auth.ownerUserId,
            is_anomaly: true,
            source_ip: null,
            since: cutoff,
        };

        const packets = memoryQueryPackets(filter);
        return computeThreatIntelFromPackets(packets);
    }
}

// --- REST API (Session bootstrap) ---
// GET /api/session
// Used by the dashboard to ensure the browser has a cookie before opening Socket.IO.
app.get('/api/session', (req, res) => {
    const sid = getSessionIdFromHeaders(req.headers);
    return res.json({ ok: true, session: sid ? `sess:${sid}` : null });
});

// --- REST API (Status / Debug) ---
// GET /api/status
// Returns auth + persistence status for troubleshooting sessions and real-time data.
app.get('/api/status', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const sid = getSessionIdFromHeaders(req.headers);
        const auth = await getAuthContextFromHeaders(req.headers);
        return res.json({
            ok: true,
            session: sid ? `sess:${sid}` : null,
            auth: {
                ownerUserId: auth.ownerUserId,
                isAdmin: auth.isAdmin,
                verified: auth.verified,
                ownerEmail: auth.ownerEmail || null,
            },
            persistence: {
                mongoUrlConfigured: !!mongoUrl,
                mongoConnected: mongoose.connection.readyState === 1,
            },
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

// --- REST API (Chat) ---
// POST /api/chat
// Body: { message: string } (also accepts { userMessage: string })
app.post('/api/chat', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const userMessageRaw =
            (typeof req.body?.message === 'string' ? req.body.message : '')
            || (typeof req.body?.userMessage === 'string' ? req.body.userMessage : '');

        const userMessage = String(userMessageRaw || '').trim();
        if (!userMessage) {
            return res.status(400).json({ ok: false, error: 'Missing message' });
        }

        const groq = await getGroqClient();
        if (!groq) {
            return res.status(503).json({
                ok: false,
                error: 'Chat model not configured. Set GROQ_API_KEY.',
            });
        }

        // Step 3: Calculate Live Context (The "Briefing")
        // Keep this consistent with Forensics (/api/threat-intel).
        const auth = await getAuthContextFromHeaders(req.headers);
        const ownerUserId = auth?.ownerUserId || 'anon:unknown';

        // Ensure session counters exist (same behavior as /api/packets) so totals are consistent.
        if (ownerUserId) {
            const entry = startOrGetOwnerStream(ownerUserId);
            if (entry?.sockets?.size === 0) scheduleStopIfIdle(ownerUserId);
        }

        const entry = streamsByOwner.get(ownerUserId);
        const totalTraffic = typeof entry?.counters?.packets === 'number'
            ? entry.counters.packets
            : memoryStore.count(ownerUserId);

        const currentMode = attackModeByOwner.get(ownerUserId) ? 'Attack Mode' : 'Normal Mode';

        const intel = await getThreatIntelReportFromHeaders(req.headers, { sinceHours: 24, limit: 10000 });
        const topIP = Array.isArray(intel?.topHostileIps) && intel.topHostileIps[0]?.ip ? intel.topHostileIps[0].ip : '—';
        const topCountry = Array.isArray(intel?.geoTopCountries) && intel.geoTopCountries[0]?.name ? intel.geoTopCountries[0].name : '—';

        function fmtIndianDateTime(ts) {
            if (!ts) return '—';
            const d = new Date(ts);
            if (Number.isNaN(d.getTime())) return '—';
            // Indian format + IST timezone
            return d.toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
            });
        }

        // “Last attack” is the most recent anomaly seen in the intel window.
        let lastAttackAt = null;
        const hostile = Array.isArray(intel?.topHostileIps) ? intel.topHostileIps : [];
        for (const r of hostile) {
            const t = r?.lastSeen;
            if (!t) continue;
            const d = new Date(t);
            if (Number.isNaN(d.getTime())) continue;
            if (!lastAttackAt || d > lastAttackAt) lastAttackAt = d;
        }
        const lastAttackLabel = fmtIndianDateTime(lastAttackAt);

        const totalTrafficLabel = (() => {
            const n = Number(totalTraffic);
            if (!Number.isFinite(n)) return String(totalTraffic);
            return n.toLocaleString('en-IN');
        })();

        // Step 4: Call Groq (Llama 3)
        const systemMessage = `You are Tracel AI.
SECTION 1 (Project Info): ${PROJECT_INFO}
SECTION 2 (Live Status):
- Mode: ${currentMode}
- Top Attacker IP: ${topIP}
- Top Country: ${topCountry}
- Total Packets: ${totalTrafficLabel}
- Last Attack Seen: ${lastAttackLabel}

Instructions: Use Section 1 for general questions. Use Section 2 for status updates. Keep it brief and professional.`;

        const groqModel = String(process.env.GROQ_MODEL || 'llama-3.1-8b-instant').trim();

        const completion = await groq.chat.completions.create({
            model: groqModel,
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage },
            ],
        });

        const text = completion?.choices?.[0]?.message?.content || '';
        return res.json({ ok: true, text });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

// --- REST API (Contact) ---
const CONTACT_LOG_PATH = path.join(__dirname, 'contact_submissions.jsonl');
const contactRateLimit = new Map();

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function isValidEmail(email) {
    // Lightweight validation; avoids rejecting valid but uncommon addresses.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// POST /api/contact
app.post('/api/contact', async (req, res) => {
    try {
        const ip = getClientIp(req);
        const now = Date.now();
        const last = contactRateLimit.get(ip) || 0;

        // Basic abuse control: 1 submission per 10 seconds per IP.
        if (now - last < 10_000) {
            return res.status(429).json({
                error: 'Too many requests. Please wait a few seconds and try again.',
            });
        }
        contactRateLimit.set(ip, now);

        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        const org = typeof req.body?.org === 'string' ? req.body.org.trim() : '';
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

        if (!name || !email || !message) {
            return res.status(400).json({ error: 'Missing required fields: name, email, message.' });
        }
        if (name.length > 120) return res.status(400).json({ error: 'Name is too long.' });
        if (email.length > 200) return res.status(400).json({ error: 'Email is too long.' });
        if (org.length > 200) return res.status(400).json({ error: 'Company is too long.' });
        if (message.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
        if (!isValidEmail(email)) return res.status(400).json({ error: 'Please provide a valid email address.' });

        const submission = {
            id: `${now}-${Math.random().toString(16).slice(2)}`,
            receivedAt: new Date(now).toISOString(),
            name,
            email,
            org,
            message,
            meta: {
                ip,
                userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '',
                referer: typeof req.headers.referer === 'string' ? req.headers.referer : '',
            },
        };

        await fs.promises.appendFile(CONTACT_LOG_PATH, `${JSON.stringify(submission)}\n`, 'utf8');
        return res.json({ ok: true, id: submission.id, receivedAt: submission.receivedAt });
    } catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});

// GET /api/contact?limit=50
// Returns newest-first from the JSONL log file.
app.get('/api/contact', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(parseInt(req.query.limit || '50', 10), 200));

        // If the log file does not exist yet, return empty list.
        const exists = fs.existsSync(CONTACT_LOG_PATH);
        if (!exists) {
            return res.json({ count: 0, submissions: [] });
        }

        const raw = await fs.promises.readFile(CONTACT_LOG_PATH, 'utf8');
        const lines = raw.split(/\r?\n/).filter(Boolean);

        const slice = lines.slice(Math.max(0, lines.length - limit));
        const parsed = [];
        for (let i = slice.length - 1; i >= 0; i -= 1) {
            try {
                parsed.push(JSON.parse(slice[i]));
            } catch {
                // Skip malformed line.
            }
        }

        return res.json({ count: parsed.length, submissions: parsed });
    } catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});

// --- REST API (Forensics) ---
// GET /api/packets?limit=200&anomaly=1&ip=1.2.3.4&since=2025-12-26T00:00:00.000Z
app.get('/api/packets', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const auth = await getAuthContextFromHeaders(req.headers);

        const filter = buildPacketFilterFromQuery(req.query, auth);

        // Ensure session counters exist for the scoped owner (even during refresh when the
        // socket may not be connected yet). Avoid starting streams for admin “all users”.
        if (filter.owner_user_id) {
            const entry = startOrGetOwnerStream(filter.owner_user_id);
            if (entry?.sockets?.size === 0) scheduleStopIfIdle(filter.owner_user_id);
        }

        const session = (() => {
            const entry = streamsByOwner.get(filter.owner_user_id);
            if (!entry?.counters) return null;
            return {
                packets: entry.counters.packets,
                threats: entry.counters.threats,
                startedAt: entry.counters.startedAt ? entry.counters.startedAt.toISOString() : null,
            };
        })();

        if (isMongoConnected()) {
            const mongoFilter = {};
            mongoFilter.owner_user_id = auth.ownerUserId;
            if (filter.is_anomaly) mongoFilter.is_anomaly = true;
            if (filter.source_ip) mongoFilter.source_ip = filter.source_ip;
            if (filter.since) mongoFilter.timestamp = { ...(mongoFilter.timestamp || {}), $gte: filter.since };

            const packets = await Packet.find(mongoFilter)
                .sort({ timestamp: -1 })
                .limit(filter.limit)
                .select('-__v')
                .lean();

            return res.json({
                count: packets.length,
                packets,
                source: 'mongo',
                session,
            });
        }

        const packets = memoryQueryPackets(filter);
        return res.json({
            count: packets.length,
            packets,
            source: 'memory',
            session,
        });
    } catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});

io.use(async (socket, next) => {
    try {
        const token = typeof socket.handshake?.auth?.token === 'string' ? socket.handshake.auth.token : '';
        const anonId = typeof socket.handshake?.auth?.anonId === 'string' ? socket.handshake.auth.anonId : '';
        const cookie = typeof socket.handshake?.headers?.cookie === 'string' ? socket.handshake.headers.cookie : '';

        const headers = {
            authorization: token ? `Bearer ${token}` : '',
            'x-tracel-anon-id': anonId,
            cookie,
        };

        socket.data.auth = await getAuthContextFromHeaders(headers);
        return next();
    } catch (e) {
        socket.data.auth = { ownerUserId: `sess:${createSessionId()}`, ownerEmail: '', isAdmin: false, verified: false };
        return next();
    }
});

// Listener: Handle User Connections & Commands
io.on('connection', (socket) => {
    const auth = socket.data?.auth || { ownerUserId: 'anon:unknown', ownerEmail: '', isAdmin: false };
    log.debug(`User connected: ${socket.id} owner=${auth.ownerUserId} admin=${auth.isAdmin}`);

    if (auth.ownerEmail) {
        ownerEmailByOwner.set(auth.ownerUserId, auth.ownerEmail);
    }

    const ownerRoom = getOwnerRoom(auth.ownerUserId);
    socket.join(ownerRoom);

    // Let the client know if the AI engine is currently reachable.
    socket.emit('ai_status', { ...aiStatus });

    // Ensure a per-owner stream exists and attach this socket.
    const entry = startOrGetOwnerStream(auth.ownerUserId);
    entry.sockets.add(socket.id);
    socket.data.ownerUserId = auth.ownerUserId;

    socket.on('toggle_attack', (shouldAttack) => {
        log.debug(`[COMMAND] toggle_attack owner=${auth.ownerUserId}: ${shouldAttack}`);
        attackModeByOwner.set(auth.ownerUserId, !!shouldAttack);
        const entry = streamsByOwner.get(auth.ownerUserId);
        if (entry?.stream) entry.stream.setAttackMode(shouldAttack);
    });

    socket.on('disconnect', () => {
        try {
            const ownerUserId = socket.data?.ownerUserId || auth.ownerUserId;
            const entry = streamsByOwner.get(ownerUserId);
            if (entry) {
                entry.sockets.delete(socket.id);
                scheduleStopIfIdle(ownerUserId);
            }
        } finally {
            log.debug(`User disconnected: ${socket.id} owner=${auth.ownerUserId}`);
        }
    });
});

const PORT = (() => {
    const raw = process.env.PORT || process.env.SERVER_PORT || '3000';
    const parsed = parseInt(String(raw), 10);
    return Number.isFinite(parsed) ? parsed : 3000;
})();
server.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
});

// --- REST API (Threat Intel Report via Python) ---
// GET /api/threat-intel?sinceHours=24&limit=10000
app.get('/api/threat-intel', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const sinceHours = typeof req.query.sinceHours === 'string' ? req.query.sinceHours : '24';
        const limit = typeof req.query.limit === 'string' ? req.query.limit : '10000';

        const report = await getThreatIntelReportFromHeaders(req.headers, { sinceHours, limit });
        return res.json(report);
    } catch (e) {
        return res.status(503).json({ ok: false, error: 'AI report service unavailable', details: String(e) });
    }
});

// Also issue the session cookie during Socket.IO handshakes.
// This makes guest identity stable even if the app connects socket-first.
function ensureSocketHandshakeCookie(headers, req) {
    try {
        const sid = getSessionIdFromHeaders(req?.headers);
        if (sid) return;

        const fresh = createSessionId();
        const existing = headers['set-cookie'];
        const next = formatSessionCookie(fresh);
        if (Array.isArray(existing)) headers['set-cookie'] = [...existing, next];
        else if (typeof existing === 'string' && existing.trim()) headers['set-cookie'] = [existing, next];
        else headers['set-cookie'] = [next];
    } catch {
        // Best-effort only.
    }
}

io.engine.on('initial_headers', (headers, req) => {
    ensureSocketHandshakeCookie(headers, req);
});

io.engine.on('headers', (headers, req) => {
    ensureSocketHandshakeCookie(headers, req);
});

// AI engine status (reachability + model loaded)
app.get('/api/ai/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, ai: aiStatus, urls: { predict: getAiPredictUrl(), health: getAiHealthUrl() } });
});