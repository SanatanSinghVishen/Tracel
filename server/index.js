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
const PROJECT_INFO = [
    'Tracel is a real-time AI network analyzer and security monitoring dashboard.',
    'Stack: React/Vite + Tailwind (dashboard), Node.js/Express + Socket.IO (server), Python AI engine (Isolation Forest scoring).',
    'Core entities: packets (timestamped network events), anomalies/threats (is_anomaly=true), AI score (anomaly_score, lower = more suspicious), dynamic threshold telemetry.',
    'Key UX: Monitor dashboard (KPIs + charts + 3D globe), Forensics (incident log, timeline, AI score threshold chart), Settings (preferences; admin-only destructive ops), Contact/About.',
    'Security model: all data is scoped per owner_user_id; admin has additional controls (e.g., reset Mongo DB) when configured.',
].join(' ');

const PLATFORM_KNOWLEDGE = [
    'Terminology:',
    '- "Threat"/"Attack" means a packet flagged as anomaly (is_anomaly=true).',
    '- "AI score" (anomaly_score) is lower when more suspicious; server flags THREAT when score < threshold.',
    '- "Session" is a server runtime session; session_started_at changes after server restart; some charts reset per session.',
    '',
    'Common actions users ask about:',
    '- "Attack simulation" is toggled from the Monitor page header (Defense/Attack switch). It injects simulated threat-like traffic for demos.',
    '- "Why is the chart empty" often means AI engine offline or no scored packets yet.',
    '- "Timeline ranges" can be last 24h (hourly), between dates (daily), month (daily), year (monthly), or since account creation (monthly).',
    '',
    'Data sources:',
    '- MongoDB when connected (persistent history).',
    '- Memory fallback when Mongo is unavailable (recent-only history).',
    '',
    'When answering:',
    '- Prefer concrete, step-by-step guidance inside the Tracel UI.',
    '- Use the live context section for current numbers and status.',
    '- If the user requests admin-only actions, verify whether they are admin in the live context.',
].join('\n');

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
const axiosRetryPkg = require('axios-retry');
const axiosRetry = axiosRetryPkg?.default || axiosRetryPkg;
const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');

const log = require('./logger');

const { MemoryStore } = require('./memory_store');

const { createThreatLog } = require('./threat_log');

const { createTrafficStream } = require('./traffic_simulator');

// Retry AI calls during Render cold starts.
try {
    axiosRetry(axios, {
        retries: 3,
        retryDelay: axiosRetry.exponentialDelay,
        retryCondition: (error) => {
            const status = error?.response?.status;
            return (
                axiosRetry.isNetworkOrIdempotentRequestError(error)
                || error?.code === 'ECONNABORTED'
                || (typeof status === 'number' && status >= 500)
            );
        },
    });
} catch {
    // best-effort
}

function isAiDisabled() {
    const raw = String(process.env.AI_DISABLED || process.env.DISABLE_AI || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

function isHostedEnvironment() {
    const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
    return nodeEnv === 'production' || !!String(process.env.RENDER_EXTERNAL_URL || '').trim();
}

function getServiceExternalOrigin() {
    const raw = String(process.env.RENDER_EXTERNAL_URL || '').trim();
    if (!raw) return null;
    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
}

let lastAiConfigWarnAt = 0;
function warnAiConfigOncePerInterval(message, meta) {
    const now = Date.now();
    if (now - lastAiConfigWarnAt < 10_000) return;
    lastAiConfigWarnAt = now;
    log.warn(message, meta || undefined);
}

function getAiPredictUrl() {
    // Prefer AI_SERVICE_URL as the canonical ai-engine base URL.
    const svc = String(process.env.AI_SERVICE_URL || '').trim();
    if (svc) {
        try {
            const candidate = new URL('/predict', svc).toString();
            const ext = getServiceExternalOrigin();
            if (ext) {
                try {
                    if (new URL(candidate).origin === ext) {
                        warnAiConfigOncePerInterval('[AI] Misconfigured AI_SERVICE_URL: points to this service; set it to your ai-engine service URL', {
                            AI_SERVICE_URL: svc,
                            RENDER_EXTERNAL_URL: String(process.env.RENDER_EXTERNAL_URL || '').trim() || undefined,
                        });
                        // Fall back to AI_PREDICT_URL / AI_ENGINE_URL.
                    }
                } catch {
                    // best-effort
                }
            }
            if (!ext || new URL(candidate).origin !== ext) return candidate;
        } catch {
            // Fall through.
        }
    }

    const explicit = String(process.env.AI_PREDICT_URL || '').trim();
    if (explicit) {
        const ext = getServiceExternalOrigin();
        if (ext) {
            try {
                if (new URL(explicit).origin === ext) {
                    warnAiConfigOncePerInterval('[AI] Misconfigured AI_PREDICT_URL: points to this service; set it to your ai-engine service URL', {
                        AI_PREDICT_URL: explicit,
                        RENDER_EXTERNAL_URL: String(process.env.RENDER_EXTERNAL_URL || '').trim() || undefined,
                    });
                    // Fall back to AI_ENGINE_URL.
                }
            } catch {
                // keep explicit value if it can't be parsed
            }
        }
        if (!ext) return explicit;
        try {
            if (new URL(explicit).origin !== ext) return explicit;
        } catch {
            return explicit;
        }
    }

    const base = String(process.env.AI_ENGINE_URL || '').trim();
    if (base) {
        // Support either providing the origin (https://svc) or a full /predict URL.
        const candidate = /\/predict\/?$/i.test(base) ? base : (() => {
            try {
                return new URL('/predict', base).toString();
            } catch {
                return null;
            }
        })();

        if (candidate) {
            const ext = getServiceExternalOrigin();
            if (ext) {
                try {
                    if (new URL(candidate).origin === ext) {
                        warnAiConfigOncePerInterval('[AI] Misconfigured AI_ENGINE_URL: points to this service; set it to your ai-engine service URL', {
                            AI_ENGINE_URL: base,
                            resolvedPredictUrl: candidate,
                            RENDER_EXTERNAL_URL: String(process.env.RENDER_EXTERNAL_URL || '').trim() || undefined,
                        });
                        return null;
                    }
                } catch {
                    // best-effort
                }
            }
            return candidate;
        }
        try {
            return new URL('/predict', base).toString();
        } catch {
            // Fall through to localhost default.
        }
    }

    // In hosted environments (Render), defaulting to localhost is almost always wrong.
    // Treat missing config as "AI not configured" so we can surface a clear status.
    if (isHostedEnvironment()) return null;
    return 'http://127.0.0.1:5000/predict';
}

function getAiHealthUrl({ load = false } = {}) {
    const raw = String(process.env.AI_HEALTH_URL || '').trim();
    if (raw) {
        // If the configured URL includes a warmup flag (load=1), avoid spamming it on frequent polls.
        if (!load) {
            try {
                const u = new URL(raw);
                u.searchParams.delete('load');
                return u.toString();
            } catch {
                // best-effort
            }
        }
        return raw;
    }

    const predict = getAiPredictUrl();
    if (!predict) return null;
    // Common pattern: /predict -> /health (optionally with load=1 during warmup).
    if (/\/predict\/?$/i.test(predict)) {
        return predict.replace(/\/predict\/?$/i, load ? '/health?load=1' : '/health');
    }
    // Fallback: just try /health off the same origin.
    try {
        const u = new URL(predict);
        u.pathname = '/health';
        if (load) u.searchParams.set('load', '1');
        else u.search = '';
        return u.toString();
    } catch {
        return isHostedEnvironment() ? null : load ? 'http://127.0.0.1:5000/health?load=1' : 'http://127.0.0.1:5000/health';
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

let aiHealthPenaltyUntilMs = 0;

let lastAiWarmupAttemptAtMs = 0;
let aiWarmupSucceededAtMs = 0;
const AI_WARMUP_COOLDOWN_MS = Math.max(60_000, parseInt(String(process.env.AI_WARMUP_COOLDOWN_MS || '300000'), 10) || 300_000);

function getRetryAfterMsFromHeaders(headers, fallbackMs) {
    try {
        const ra = headers?.['retry-after'] ?? headers?.['Retry-After'];
        const n = Number(ra);
        if (Number.isFinite(n) && n > 0) return Math.max(1000, n * 1000);
    } catch {
        // best-effort
    }
    return fallbackMs;
}

// --- System Initialization Phase (Render cold-start boot gating) ---
// Used by the dashboard to show a boot overlay while the separate ai-engine service wakes.
let isAIReady = false;

const defaultAiWakePollMs = isHostedEnvironment() ? 60_000 : 15_000;
const AI_WAKE_POLL_MS = Math.max(
    defaultAiWakePollMs,
    parseInt(String(process.env.AI_WAKE_POLL_MS || process.env.AI_HEALTH_POLL_MS || String(defaultAiWakePollMs)), 10) || defaultAiWakePollMs
);

async function checkAIHealth() {
    // Manual-equivalent wake check:
    // Keep polling the ai-engine root URL until it returns the expected JSON.
    const base = String(getAiServiceUrl() || '').trim();
    if (!base) {
        log.info('[INIT] Waiting for AI...');
        setTimeout(() => {
            checkAIHealth().catch(() => void 0);
        }, AI_WAKE_POLL_MS);
        return;
    }

    // Guard against accidentally pointing at this backend.
    const ext = getServiceExternalOrigin();
    if (ext) {
        try {
            if (new URL(base).origin === ext) {
                warnAiConfigOncePerInterval('[AI] Misconfigured AI service URL: points to this backend; set AI_SERVICE_URL or AI_ENGINE_URL to your ai-engine service URL', {
                    AI_SERVICE_URL: String(process.env.AI_SERVICE_URL || '').trim() || undefined,
                    AI_ENGINE_URL: String(process.env.AI_ENGINE_URL || '').trim() || undefined,
                    RENDER_EXTERNAL_URL: String(process.env.RENDER_EXTERNAL_URL || '').trim() || undefined,
                });
                log.info('[INIT] Waiting for AI...');
                setTimeout(() => {
                    checkAIHealth().catch(() => void 0);
                }, AI_WAKE_POLL_MS);
                return;
            }
        } catch {
            // best-effort
        }
    }

    let url;
    try {
        url = new URL('/', base).toString();
    } catch {
        url = `${String(base).replace(/\/+$/, '')}/`;
    }

    try {
        const res = await axios.get(url, {
            timeout: Math.max(3000, getAiRequestTimeoutMs('health')),
            validateStatus: () => true,
        });

        if (res?.status === 429) {
            const delayMs = Math.max(AI_WAKE_POLL_MS, getRetryAfterMsFromHeaders(res?.headers, 60_000));
            aiHealthPenaltyUntilMs = Math.max(aiHealthPenaltyUntilMs, Date.now() + delayMs);
            log.info('[INIT] AI rate-limited; waiting before retry...');
            setTimeout(() => {
                checkAIHealth().catch(() => void 0);
            }, delayMs);
            return;
        }

        const ready =
            res.status === 200
            && res?.data?.ok === true
            && String(res?.data?.service || '').toLowerCase() === 'ai-engine'
            && typeof res?.data?.endpoints === 'object'
            && !!res?.data?.endpoints?.health
            && !!res?.data?.endpoints?.predict;

        if (ready) {
            if (!isAIReady) log.info('[INIT] AI Engine Online');
            isAIReady = true;
            return;
        }
    } catch {
        // fall through to retry
    }

    log.info('[INIT] Waiting for AI...');
    setTimeout(() => {
        checkAIHealth().catch(() => void 0);
    }, AI_WAKE_POLL_MS);
}

function getAiRequestTimeoutMs(kind = 'health') {
    const isHosted = isHostedEnvironment();
    const envKey =
        kind === 'report'
            ? 'AI_REPORT_TIMEOUT_MS'
            : kind === 'predict'
              ? 'AI_PREDICT_TIMEOUT_MS'
              : 'AI_HEALTH_TIMEOUT_MS';

    const raw = String(process.env[envKey] || '').trim();
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    // Render cold-starts commonly exceed a couple seconds.
    if (isHosted) return kind === 'report' ? 20_000 : 15_000;
    return kind === 'report' ? 5000 : 1500;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

let lastAiStatusBroadcastOk = null;

async function pollAiHealthOnce({ load = false } = {}) {
    const nowIso = new Date().toISOString();
    aiStatus.lastCheckedAt = nowIso;

    // If the AI service is rate-limiting us, back off to avoid a tight 429 loop.
    if (Date.now() < aiHealthPenaltyUntilMs) {
        aiStatus.ok = false;
        aiStatus.modelLoaded = null;
        aiStatus.threshold = null;
        aiStatus.lastError = {
            message: 'AI health is rate-limited (backing off)',
            code: 'AI_HEALTH_RATE_LIMITED',
            status: 429,
            retryAt: new Date(aiHealthPenaltyUntilMs).toISOString(),
        };
        return;
    }

    if (isAiDisabled()) {
        aiStatus.ok = false;
        aiStatus.modelLoaded = null;
        aiStatus.threshold = null;
        aiStatus.lastError = { message: 'AI disabled by configuration', code: 'AI_DISABLED' };
        // Broadcast only when ok-state flips.
        if (lastAiStatusBroadcastOk === null || lastAiStatusBroadcastOk !== aiStatus.ok) {
            lastAiStatusBroadcastOk = aiStatus.ok;
            try {
                io.emit('ai_status', { ...aiStatus });
            } catch {
                // best-effort
            }
        }
        return;
    }

    const healthUrl = getAiHealthUrl({ load });
    if (!healthUrl) {
        aiStatus.ok = false;
        aiStatus.modelLoaded = null;
        aiStatus.threshold = null;
        aiStatus.lastError = { message: 'AI not configured', code: 'AI_NOT_CONFIGURED' };
        isAIReady = false;
        if (lastAiStatusBroadcastOk === null || lastAiStatusBroadcastOk !== aiStatus.ok) {
            lastAiStatusBroadcastOk = aiStatus.ok;
            try {
                io.emit('ai_status', { ...aiStatus });
            } catch {
                // best-effort
            }
        }
        return;
    }

    try {
        const res = await axios.get(healthUrl, {
            timeout: getAiRequestTimeoutMs('health'),
            validateStatus: () => true,
        });

        if (res?.status === 429) {
            const minMs = isHostedEnvironment() ? 60_000 : 5_000;
            const delayMs = Math.max(minMs, getRetryAfterMsFromHeaders(res?.headers, 60_000));
            aiHealthPenaltyUntilMs = Math.max(aiHealthPenaltyUntilMs, Date.now() + delayMs);
            aiStatus.ok = false;
            aiStatus.modelLoaded = null;
            aiStatus.threshold = null;
            aiStatus.lastError = {
                message: 'AI health returned 429',
                code: 'AI_HEALTH_RATE_LIMITED',
                status: 429,
                retryAt: new Date(aiHealthPenaltyUntilMs).toISOString(),
            };
            return;
        }

        // Support both:
        // - ai-engine detailed health (GET /health?load=1) -> { ok: true, modelLoaded: ... }
        // - ai-engine lightweight health (GET /health) -> { status: "running" }
        const ok =
            res?.status === 200
            && (
                res?.data?.ok === true
                || String(res?.data?.status || '').toLowerCase() === 'running'
            );

        const modelLoaded = typeof res?.data?.modelLoaded === 'boolean' ? res.data.modelLoaded : null;
        const thrRaw = res?.data?.threshold;
        const threshold = Number(thrRaw);

        aiStatus.ok = ok;
        aiStatus.modelLoaded = modelLoaded;
        aiStatus.threshold = Number.isFinite(threshold) ? threshold : null;
        aiStatus.lastError = ok
            ? null
            : {
                message: `AI health returned ${res?.status}`,
                code: 'AI_HEALTH_NOT_OK',
                status: res?.status,
              };

        if (ok) aiStatus.lastOkAt = nowIso;

        // Treat a successful health check as "ready" for the boot overlay.
        // This avoids the overlay being stuck if AI_SERVICE_URL is unset but AI_HEALTH_URL works.
        if (ok) isAIReady = true;

    } catch (e) {
        if (e?.response?.status === 429) {
            const minMs = isHostedEnvironment() ? 60_000 : 5_000;
            const delayMs = Math.max(minMs, getRetryAfterMsFromHeaders(e?.response?.headers, 60_000));
            aiHealthPenaltyUntilMs = Math.max(aiHealthPenaltyUntilMs, Date.now() + delayMs);
            aiStatus.ok = false;
            aiStatus.modelLoaded = null;
            aiStatus.threshold = null;
            aiStatus.lastError = {
                message: 'AI health returned 429',
                code: 'AI_HEALTH_RATE_LIMITED',
                status: 429,
                retryAt: new Date(aiHealthPenaltyUntilMs).toISOString(),
            };
            return;
        }
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

async function warmupAiBestEffort({ attempts = 3 } = {}) {
    // Avoid spamming warmup calls when multiple clients load at once.
    const now = Date.now();
    if (aiWarmupSucceededAtMs && (now - aiWarmupSucceededAtMs) < AI_WARMUP_COOLDOWN_MS) return;
    if (lastAiWarmupAttemptAtMs && (now - lastAiWarmupAttemptAtMs) < AI_WARMUP_COOLDOWN_MS) return;
    lastAiWarmupAttemptAtMs = now;

    // Fire a few spaced health checks so a sleeping Render service has time to boot.
    for (let i = 0; i < attempts; i += 1) {
        if (Date.now() < aiHealthPenaltyUntilMs) return;
        await pollAiHealthOnce({ load: true }).catch(() => void 0);
        if (aiStatus.ok) {
            aiWarmupSucceededAtMs = Date.now();
            return;
        }
        await sleep(1500);
    }
}

function getAiBaseUrl() {
    const explicitPredict = getAiPredictUrl();
    if (explicitPredict) return String(explicitPredict).replace(/\/predict\/?$/i, '');

    const base = String(process.env.AI_ENGINE_URL || '').trim();
    if (base) return String(base).replace(/\/predict\/?$/i, '');

    return isHostedEnvironment() ? null : 'http://127.0.0.1:5000';
}

function getAiServiceUrl() {
    // Preferred for the wake-up chain: base origin of the AI service.
    // Keep compatibility with existing AI_ENGINE_URL/AI_PREDICT_URL setup.
    const raw = String(process.env.AI_SERVICE_URL || '').trim();
    if (raw) {
        try {
            // Normalize to origin (strip any path).
            const origin = new URL(raw).origin;
            const ext = getServiceExternalOrigin();
            if (ext) {
                try {
                    if (new URL(ext).origin === origin) {
                        warnAiConfigOncePerInterval('[AI] Misconfigured AI_SERVICE_URL: points to this backend; falling back to AI_ENGINE_URL/AI_PREDICT_URL', {
                            AI_SERVICE_URL: raw,
                            AI_ENGINE_URL: String(process.env.AI_ENGINE_URL || '').trim() || undefined,
                            AI_PREDICT_URL: String(process.env.AI_PREDICT_URL || '').trim() || undefined,
                            RENDER_EXTERNAL_URL: String(process.env.RENDER_EXTERNAL_URL || '').trim() || undefined,
                        });
                        return getAiBaseUrl();
                    }
                } catch {
                    // best-effort
                }
            }
            return origin;
        } catch {
            // If it can't be parsed, still guard against obviously pointing at ourselves.
            const ext = getServiceExternalOrigin();
            if (ext && String(ext).trim() === raw) {
                warnAiConfigOncePerInterval('[AI] Misconfigured AI_SERVICE_URL: points to this backend; falling back to AI_ENGINE_URL/AI_PREDICT_URL', {
                    AI_SERVICE_URL: raw,
                    AI_ENGINE_URL: String(process.env.AI_ENGINE_URL || '').trim() || undefined,
                    AI_PREDICT_URL: String(process.env.AI_PREDICT_URL || '').trim() || undefined,
                    RENDER_EXTERNAL_URL: String(process.env.RENDER_EXTERNAL_URL || '').trim() || undefined,
                });
                return getAiBaseUrl();
            }
            return raw;
        }
    }
    return getAiBaseUrl();
}

async function wakeUpAIService() {
    // Best-effort wake-up ping: match the manual wake check by hitting '/'.
    try {
        if (isAiDisabled()) return;
        const base = getAiServiceUrl();
        if (!base) return;
        const u = new URL('/', base);
        await axios.get(u.toString(), { timeout: getAiRequestTimeoutMs('health') });
    } catch {
        // best-effort only
    }
}

function startAiKeepAlive() {
    // Keep the AI service warm while users are active on the site.
    if (isAiDisabled()) return;
    const base = getAiServiceUrl();
    if (!base) return;
    setInterval(() => {
        wakeUpAIService().catch(() => void 0);
    }, 10 * 60 * 1000);
}

// Default polling cadence:
// - Hosted envs: keep it slow to avoid 429s (and because cold-starts take time anyway).
// - Local dev: faster feedback.
const defaultAiPollMs = isHostedEnvironment() ? 60_000 : 15_000;
setInterval(() => {
    // Frequent polling should be "light" (no model warmup flag) to avoid 429s.
    pollAiHealthOnce({ load: false }).catch(() => void 0);
}, (() => {
    const raw = parseInt(process.env.AI_HEALTH_POLL_MS || String(defaultAiPollMs), 10) || defaultAiPollMs;
    // Allow slower than 60s in hosted envs.
    const maxMs = isHostedEnvironment() ? 300_000 : 60_000;
    return Math.max(15_000, Math.min(raw, maxMs));
})());
pollAiHealthOnce({ load: true }).catch(() => void 0);

const memoryStore = new MemoryStore({
    maxPerOwner: Math.max(100, Math.min(parseInt(process.env.MEMORY_MAX_PACKETS || '5000', 10), 50_000))
});

// Disk-backed anomaly history for last-N-hours.
// Only used when MongoDB persistence is not configured (or when explicitly enabled).
// If MongoDB is always available, keeping this disabled avoids extra file I/O.
const threatLogEnabled = (() => {
    const raw = String(process.env.THREAT_LOG_ENABLED || '').trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes') return true;
    // Auto-enable only when Mongo isn't configured.
    const mongoConfigured = !!String(process.env.MONGO_URL || '').trim();
    return !mongoConfigured;
})();

const threatLog = threatLogEnabled
    ? createThreatLog({
        filePath: process.env.THREAT_LOG_PATH,
        retentionHours: process.env.THREAT_LOG_RETENTION_HOURS,
        log,
    })
    : null;

if (threatLog) {
    threatLog.hydrateInto(memoryStore).catch(() => void 0);
    threatLog.startCompactionInterval();
}

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
            baselineLoaded: false,
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
        getAiReady: () => !!isAIReady,
        emitPacket: (packetData) => {
            const isAttackMode = !!entry.stream?.isAttackMode;
            const rawScore = packetData?.anomaly_score;
            const aiScored = rawScore !== null && rawScore !== undefined && rawScore !== '' && Number.isFinite(Number(rawScore));
            const score = aiScored ? Number(rawScore) : null;
            packetData.ai_scored = aiScored;
            packetData.anomaly_score = score;

            // Learning phase:
            // - Primary: learn on normal traffic only.
            // - Bootstrap: if the user enables Attack mode immediately (no warmup yet),
            //   allow the baseline to learn from packets that are clearly safe per the
            //   AI engine's calibrated threshold.
            if (!isAttackMode) {
                if (aiScored) entry.thresholdMgr.learn(score);
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
            let dynamicIsAnomaly = aiScored ? entry.thresholdMgr.isAnomaly(score) : false;
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
            // Load baseline from Mongo once at session start.
            if (!entry.counters.baselineLoaded) {
                entry.counters.baselineLoaded = true;
                (async () => {
                    try {
                        if (isMongoConnected()) {
                            const totalPackets = await Packet.countDocuments({ owner_user_id: ownerUserId });
                            const totalThreats = await Packet.countDocuments({ owner_user_id: ownerUserId, is_anomaly: true });
                            entry.counters.packets = totalPackets;
                            entry.counters.threats = totalThreats;
                        }
                    } catch (e) {
                        log.warn('Failed to load baseline counters from Mongo', e);
                    }
                })();
            }

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
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tracel-anon-id'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
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

// Basic health/info routes for hosting providers (e.g., Render) and browsers.
app.get('/', (req, res) => {
    return res.status(200).json({
        ok: true,
        service: 'tracel-server',
        message: 'Server is running. API routes are under /api/*',
        routes: {
            status: '/api/status',
            session: '/api/session',
            aiStatus: '/api/ai/status',
        },
    });
});

// Common mistaken path; keep it friendly.
app.get('/get', (req, res) => {
    return res.redirect(302, '/api/status');
});

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

    // Persist threat events to disk only when disk logging is enabled.
    if (threatLog) {
        try {
            threatLog.appendThreat(packetData);
        } catch {
            // Best-effort only.
        }
    }

    // Persist to Mongo only if configured and connected. Avoid buffering.
    if (!mongoUrl) return;
    if (mongoose.connection.readyState !== 1) return;
    Packet.create(packetData).catch((err) => log.warn('Mongo persistPacket failed', err));
}

function isMongoConnected() {
    return !!mongoUrl && mongoose.connection.readyState === 1;
}

function waitForMongoConnected(timeoutMs = 25_000) {
    if (!mongoUrl) return Promise.resolve(false);
    if (mongoose.connection.readyState === 1) return Promise.resolve(true);

    return new Promise((resolve) => {
        let done = false;

        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                mongoose.connection.removeListener('connected', onConnected);
            } catch {
                // best-effort
            }
            resolve(!!ok);
        };

        const onConnected = () => finish(true);
        const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));

        mongoose.connection.on('connected', onConnected);
    });
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
            'Mexico',
            'Brazil',
            'Argentina',
            'United Kingdom',
            'France',
            'Germany',
            'Spain',
            'Italy',
            'Netherlands',
            'Sweden',
            'Poland',
            'Turkey',
            'Russia',
            'India',
            'China',
            'Japan',
            'South Korea',
            'Singapore',
            'Australia',
            'New Zealand',
            'South Africa',
            'Nigeria',
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

function clampInt(val, min, max, fallback) {
    const n = parseInt(String(val ?? ''), 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(n, max));
}

function parseIsoDate(val) {
    if (!val || typeof val !== 'string') return null;
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function chooseTimelineBucket({ bucket, from, to }) {
    const requested = typeof bucket === 'string' ? bucket.trim().toLowerCase() : '';
    if (requested === 'hour' || requested === 'day' || requested === 'month') return requested;

    const ms = Math.max(0, to.getTime() - from.getTime());
    const hours = ms / (60 * 60 * 1000);
    const days = ms / (24 * 60 * 60 * 1000);

    if (hours <= 48) return 'hour';
    if (days <= 120) return 'day';
    return 'month';
}

function bucketKeyUtc(date, bucket) {
    const d = new Date(date);
    if (bucket === 'hour') {
        d.setUTCMinutes(0, 0, 0);
        return d.toISOString().slice(0, 13) + ':00:00.000Z';
    }
    if (bucket === 'day') {
        d.setUTCHours(0, 0, 0, 0);
        return d.toISOString().slice(0, 10) + 'T00:00:00.000Z';
    }
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 7) + '-01T00:00:00.000Z';
}

function quantileLinear(sortedValues, q) {
    const values = Array.isArray(sortedValues) ? sortedValues : [];
    if (!values.length) return null;
    const qq = Math.max(0, Math.min(1, Number(q)));
    if (!Number.isFinite(qq)) return null;
    if (values.length === 1) return values[0];

    const pos = (values.length - 1) * qq;
    const base = Math.floor(pos);
    const rest = pos - base;
    const left = values[base];
    const right = values[Math.min(base + 1, values.length - 1)];
    return left + rest * (right - left);
}

async function computeThreatIntelFromMongo({ ownerUserId, since, to, limit }) {
    const effectiveLimit = Math.max(1000, Math.min(parseInt(String(limit || 10000), 10), 50_000));
    const from = since instanceof Date ? since : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const until = to instanceof Date ? to : new Date();

    const baseMatch = {
        owner_user_id: ownerUserId,
        is_anomaly: true,
        timestamp: { $gte: from, $lt: until },
    };

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

    // Vector derivation: respects explicit values (attack_vector) and otherwise
    // matches the heuristic used across the app.
    const vectorExpr = {
        $let: {
            vars: {
                explicit: { $toLower: { $trim: { input: { $ifNull: ['$attack_vector', ''] } } } },
                m: { $toUpper: { $ifNull: ['$method', ''] } },
                b: { $convert: { input: '$bytes', to: 'int', onError: 0, onNull: 0 } },
            },
            in: {
                $switch: {
                    branches: [
                        { case: { $regexMatch: { input: '$$explicit', regex: '^vol' } }, then: 'Volumetric' },
                        { case: { $regexMatch: { input: '$$explicit', regex: '^prot' } }, then: 'Protocol' },
                        { case: { $regexMatch: { input: '$$explicit', regex: '^app' } }, then: 'Application' },
                    ],
                    default: {
                        $cond: [
                            { $gte: ['$$b', 4000] },
                            'Volumetric',
                            {
                                $cond: [
                                    { $in: ['$$m', ['POST', 'PUT', 'PATCH', 'DELETE']] },
                                    'Application',
                                    'Protocol',
                                ],
                            },
                        ],
                    },
                },
            },
        },
    };

    const countryExpr = {
        $let: {
            vars: {
                explicit: { $trim: { input: { $ifNull: ['$source_country', ''] } } },
                ipStr: { $ifNull: ['$source_ip', ''] },
            },
            in: {
                $cond: [
                    { $gt: [{ $strLenCP: '$$explicit' }, 0] },
                    '$$explicit',
                    {
                        $let: {
                            vars: {
                                firstOctetStr: { $arrayElemAt: [{ $split: ['$$ipStr', '.'] }, 0] },
                            },
                            in: {
                                $let: {
                                    vars: {
                                        firstInt: {
                                            $convert: {
                                                input: '$$firstOctetStr',
                                                to: 'int',
                                                onError: 0,
                                                onNull: 0,
                                            },
                                        },
                                    },
                                    in: {
                                        $arrayElemAt: [
                                            countries,
                                            { $mod: [{ $abs: '$$firstInt' }, countries.length] },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                ],
            },
        },
    };

    const totalThreats = await Packet.countDocuments(baseMatch);

    const [topHostileIps, attackVectorDistribution, geoTopCountries] = await Promise.all([
        Packet.aggregate([
            { $match: baseMatch },
            {
                $group: {
                    _id: { $ifNull: ['$source_ip', ''] },
                    count: { $sum: 1 },
                    lastSeen: { $max: '$timestamp' },
                },
            },
            { $match: { _id: { $ne: '' } } },
            { $sort: { count: -1, lastSeen: -1 } },
            { $limit: 8 },
            {
                $project: {
                    _id: 0,
                    ip: '$_id',
                    count: 1,
                    lastSeen: {
                        $cond: [
                            { $ifNull: ['$lastSeen', false] },
                            { $dateToString: { date: '$lastSeen', format: '%Y-%m-%dT%H:%M:%S.%LZ', timezone: 'UTC' } },
                            null,
                        ],
                    },
                },
            },
        ]),
        (async () => {
            const rows = await Packet.aggregate([
                { $match: baseMatch },
                { $addFields: { vector: vectorExpr } },
                { $group: { _id: '$vector', value: { $sum: 1 } } },
            ]);

            const map = new Map((rows || []).map((r) => [String(r._id || ''), Number(r.value || 0)]));
            return [
                { name: 'Volumetric', value: map.get('Volumetric') || 0 },
                { name: 'Protocol', value: map.get('Protocol') || 0 },
                { name: 'Application', value: map.get('Application') || 0 },
            ];
        })(),
        (async () => {
            const rows = await Packet.aggregate([
                { $match: baseMatch },
                { $addFields: { country: countryExpr } },
                { $group: { _id: '$country', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 },
            ]);

            return (rows || []).map((r) => {
                const count = Number(r.count || 0);
                const pct = totalThreats > 0 ? Math.round((count / totalThreats) * 100) : 0;
                return { name: String(r._id || ''), count, pct };
            });
        })(),
    ]);

    // Confidence distribution: quantile-based over anomaly_score for the same window.
    // Lower score = more suspicious.
    const scoreDocs = await Packet.find(baseMatch)
        .sort({ timestamp: -1 })
        .limit(effectiveLimit)
        .select({ anomaly_score: 1 })
        .lean();

    const scores = [];
    for (const d of scoreDocs || []) {
        const s = Number(d?.anomaly_score);
        if (Number.isFinite(s)) scores.push(s);
    }

    let obvious = 0;
    let subtle = 0;
    let other = Number(totalThreats || 0);
    let thresholds = { obviousLe: null, subtleLe: null };

    if (scores.length) {
        const sorted = scores.slice().sort((a, b) => a - b);
        const qObvious = quantileLinear(sorted, 0.20);
        const qSubtle = quantileLinear(sorted, 0.60);
        thresholds = { obviousLe: qObvious, subtleLe: qSubtle };

        for (const s of scores) {
            if (qObvious !== null && s <= qObvious) obvious += 1;
            else if (qSubtle !== null && s <= qSubtle) subtle += 1;
        }
        other = Math.max(0, Number(totalThreats || 0) - obvious - subtle);
    }

    const aiConfidenceDistribution = [
        { bucket: 'Obvious', count: obvious },
        { bucket: 'Subtle', count: subtle },
        { bucket: 'Other', count: other },
    ];

    return {
        ok: true,
        degraded: false,
        source: 'mongo',
        generatedAt: new Date().toISOString(),
        window: {
            since: from.toISOString(),
            to: until.toISOString(),
            sinceHours: Math.max(1, Math.min(parseInt(String((until.getTime() - from.getTime()) / (60 * 60 * 1000)), 10) || 24, 168)),
        },
        totalThreats: Number(totalThreats || 0),
        topHostileIps: Array.isArray(topHostileIps) ? topHostileIps : [],
        attackVectorDistribution,
        geoTopCountries,
        aiConfidenceDefinition: {
            method: 'quantiles',
            obvious: 'lowest ~20% anomaly scores (most suspicious)',
            subtle: 'next ~40% anomaly scores',
            other: 'remaining scores',
            note: 'Buckets are relative to the selected time window.',
        },
        aiConfidenceDistribution,
        aiConfidenceThresholds: thresholds,
    };
}

async function getThreatIntelReportFromHeaders(headers, { sinceHours = 24, limit = 10000 } = {}) {
    try {
        const reportBase = getAiBaseUrl();
        if (!reportBase) throw new Error('AI not configured');

        const auth = await getAuthContextFromHeaders(headers);

        const u = new URL('/report/threat-intel', reportBase);
        u.searchParams.set('sinceHours', String(sinceHours));
        u.searchParams.set('limit', String(limit));
        u.searchParams.set('ownerUserId', auth.ownerUserId);

        const response = await axios.get(u.toString(), { timeout: getAiRequestTimeoutMs('report') });
        if (response?.data?.ok === false) {
            throw Object.assign(new Error(response?.data?.error || 'AI report failed'), { response });
        }

        return response.data;
    } catch {
        // Fallback: if Mongo is available, compute directly from Mongo so the
        // report is stable across server restarts and doesn't depend on AI uptime.
        const auth = await getAuthContextFromHeaders(headers);
        const hrs = Math.max(1, Math.min(parseInt(String(sinceHours || 24), 10), 168));
        const cutoff = new Date(Date.now() - hrs * 60 * 60 * 1000);
        const effectiveLimit = Math.max(1000, Math.min(parseInt(String(limit || 10000), 10), 50_000));

        if (isMongoConnected()) {
            try {
                const mongoFilter = {
                    owner_user_id: auth.ownerUserId,
                    is_anomaly: true,
                    timestamp: { $gte: cutoff },
                };
                const packets = await Packet.find(mongoFilter)
                    .sort({ timestamp: -1 })
                    .limit(effectiveLimit)
                    .select('-__v')
                    .lean();

                const report = computeThreatIntelFromPackets(packets);
                report.degraded = true;
                report.source = 'mongo';
                report.aiConfidenceDefinition =
                    'Heuristic confidence computed server-side from MongoDB (AI report service unavailable).';
                return report;
            } catch {
                // Fall back further to memory.
            }
        }

        // Memory fallback: compute from recent in-memory packets.
        const filter = {
            limit: effectiveLimit,
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
    // Warm up AI on initial dashboard load. This helps with cold-starting the
    // separate ai-engine service (e.g., if it was idle) without blocking the UI.
    try {
        warmupAiBestEffort({ attempts: 4 }).catch(() => void 0);
    } catch {
        // best-effort
    }

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

        const aiConfigured = !!(
            String(process.env.AI_SERVICE_URL || '').trim()
            || String(process.env.AI_ENGINE_URL || '').trim()
            || String(process.env.AI_PREDICT_URL || '').trim()
            || String(process.env.AI_HEALTH_URL || '').trim()
        );

        return res.json({
            ok: true,
            ai_ready: !!isAIReady,
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
            ai: {
                disabled: isAiDisabled(),
                configured: aiConfigured,
                status: { ...aiStatus },
            },
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
    }
});

// --- Admin API ---
// POST /api/admin/reset-mongo
// DANGER: Deletes all packet history for ALL users.
app.post('/api/admin/reset-mongo', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        // Admin operations require verified JWTs. Without JWKS configured, we cannot
        // safely validate Clerk-issued tokens.
        if (!jwksClient) {
            return res.status(403).json({ error: 'Admin auth not configured: set CLERK_JWKS_URL to enable verified tokens' });
        }

        const auth = await getAuthContextFromHeaders(req.headers);
        if (!auth.isAdmin) return res.status(403).json({ error: 'Admin only' });

        // If JWT verification is configured, require verified tokens for destructive admin ops.
        if (!auth.verified) {
            return res.status(403).json({ error: 'Admin token must be verified' });
        }

        const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : '';
        if (confirm !== 'RESET') {
            return res.status(400).json({ error: 'Confirmation required: set { confirm: "RESET" }' });
        }

        if (!isMongoConnected()) {
            return res.status(400).json({ error: 'MongoDB is not connected (MONGO_URL missing or connection down)' });
        }

        const result = await Packet.deleteMany({});

        // Reset in-memory runtime state so UI sessions start clean.
        try {
            for (const entry of streamsByOwner.values()) {
                try { entry.stream?.stop?.(); } catch { /* best-effort */ }
                if (entry.stopTimer) {
                    try { clearTimeout(entry.stopTimer); } catch { /* best-effort */ }
                }
            }
        } finally {
            streamsByOwner.clear();
            ownerEmailByOwner.clear();
            attackModeByOwner.clear();
            try { memoryStore.clearAll(); } catch { /* best-effort */ }
        }

        log.warn(`ADMIN reset-mongo executed by ${auth.ownerUserId} (${auth.ownerEmail || 'no-email'}) deleted=${result?.deletedCount ?? 0}`);

        return res.json({ ok: true, deletedPackets: result?.deletedCount ?? 0 });
    } catch (e) {
        log.error('Admin reset-mongo failed', e);
        return res.status(500).json({ error: String(e) });
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

        const clientContext = (req.body && typeof req.body === 'object' && req.body.clientContext && typeof req.body.clientContext === 'object')
            ? req.body.clientContext
            : null;

        const historyRaw = (req.body && typeof req.body === 'object' && Array.isArray(req.body.history))
            ? req.body.history
            : [];

        const history = historyRaw
            .filter((m) => m && typeof m === 'object')
            .map((m) => {
                const role = m.role === 'assistant' ? 'assistant' : 'user';
                const content = typeof m.content === 'string' ? m.content : '';
                return { role, content: content.slice(0, 2000) };
            })
            .filter((m) => m.content.trim())
            .slice(-12);

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
        const isAdmin = !!auth?.isAdmin;

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
        const threats24h = typeof intel?.totalThreats === 'number' ? intel.totalThreats : null;

        const persistenceMode = isMongoConnected() ? 'mongo' : 'memory';

        const aiLive = {
            reachable: !!aiStatus?.ok,
            checkedAt: aiStatus?.lastCheckedAt || null,
            lastOkAt: aiStatus?.lastOkAt || null,
            modelLoaded: aiStatus?.modelLoaded ?? null,
        };

        function formatLiveBriefingText() {
            const lines = [];
            lines.push("Live status:");
            lines.push(`- Mode: ${currentMode}`);
            lines.push(`- Persistence: ${persistenceMode === 'mongo' ? 'MongoDB' : 'Memory'}`);
            lines.push(`- Total packets (session): ${totalTrafficLabel}`);

            if (typeof threats24h === 'number') {
                lines.push(`- Threats (last 24h): ${Number(threats24h).toLocaleString('en-IN')}`);
            } else {
                lines.push(`- Threats (last 24h): unavailable`);
            }

            lines.push(`- Top attacker IP (24h): ${maskIp(topIP) || '—'}`);
            lines.push(`- Top country (24h): ${topCountry || '—'}`);
            lines.push(`- Last attack seen (24h): ${lastAttackLabel !== '—' ? lastAttackLabel : 'unavailable'}`);
            lines.push(`- AI engine: ${aiLive.reachable ? 'reachable' : 'unreachable'}${aiLive.modelLoaded === true ? ' (model loaded)' : (aiLive.modelLoaded === false ? ' (model not loaded)' : '')}`);
            return lines.join('\n');
        }

        function formatAttackSimulationHelp() {
            return [
                'To simulate an attack:',
                '- Go to Monitor (the main dashboard page).',
                '- In the header, switch from Defense → Attack (this is the attack simulation toggle).',
                '- You should start seeing threat-like packets stream in within a few seconds.',
                '',
                'If you do not see anything:',
                '- Check the connection indicator (must be Online).',
                '- Ensure the server is running and Socket.IO is connected.',
            ].join('\n');
        }

        function maskIp(ip) {
            const s = String(ip || '').trim();
            const parts = s.split('.');
            if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
                return `${parts[0]}.${parts[1]}.x.x`;
            }
            return s ? 'masked' : '—';
        }

        function formatClientContextSafe(ctx) {
            if (!ctx || typeof ctx !== 'object') return '—';

            const pathname = typeof ctx.pathname === 'string' ? ctx.pathname.slice(0, 120) : null;
            const timezone = typeof ctx.timezone === 'string' ? ctx.timezone.slice(0, 80) : null;
            const ui = (ctx.ui && typeof ctx.ui === 'object') ? ctx.ui : null;

            const connected = ui && ui.connection && typeof ui.connection === 'object'
                ? (ui.connection.connected === true ? 'true' : (ui.connection.connected === false ? 'false' : '—'))
                : '—';

            const view = ui && typeof ui.trafficView === 'string' ? ui.trafficView.slice(0, 30) : null;

            const stats = ui && ui.stats && typeof ui.stats === 'object' ? ui.stats : null;
            const packets = typeof stats?.packets === 'number' ? stats.packets : null;
            const threats = typeof stats?.threats === 'number' ? stats.threats : null;
            const uptime = typeof stats?.uptime === 'number' ? stats.uptime : null;

            const pkt = ui && ui.currentPacket && typeof ui.currentPacket === 'object' ? ui.currentPacket : null;
            const pktAnom = typeof pkt?.is_anomaly === 'boolean' ? (pkt.is_anomaly ? 'THREAT' : 'SAFE') : null;
            const pktMethod = typeof pkt?.method === 'string' ? pkt.method.slice(0, 12) : null;
            const pktBytes = typeof pkt?.bytes === 'number' ? pkt.bytes : null;
            const pktScore = typeof pkt?.anomaly_score === 'number' ? pkt.anomaly_score : null;

            const lines = [];
            if (pathname) lines.push(`- Page: ${pathname}`);
            if (timezone) lines.push(`- Timezone: ${timezone}`);
            lines.push(`- Connected: ${connected}`);
            if (view) lines.push(`- View: ${view}`);
            if (packets != null) lines.push(`- UI packets (session): ${Number(packets).toLocaleString('en-IN')}`);
            if (threats != null) lines.push(`- UI threats (session): ${Number(threats).toLocaleString('en-IN')}`);
            if (uptime != null) lines.push(`- UI uptime (sec): ${Number(uptime).toLocaleString('en-IN')}`);
            if (pktAnom || pktMethod || pktBytes != null || pktScore != null) {
                lines.push(`- Current packet: ${[pktAnom, pktMethod, pktBytes != null ? `${pktBytes}B` : null, pktScore != null ? `score=${pktScore}` : null].filter(Boolean).join(' | ')}`);
            }
            return lines.length ? lines.join('\n') : '—';
        }

        // Find last attack timestamp (for display)
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

        // Deterministic answers for common "live status" / "latest threat" / "simulate attack" intents.
        // This prevents the LLM from hallucinating numbers or UI locations.
        const asksForLiveStatus = /\b(live status|status|briefing|latest threat|latest attack|last attack|recent threats|top attacker|threats? in the last|24\s*h|24-?hour|last\s*24\s*hours?|24\s*hour\s*summary|24h\s*summary)\b/i.test(userMessage);
        const asksToSimulateAttack = /\b(simulate|simulation)\b.*\b(attack|threat)\b|\b(start|enable|turn on)\b.*\b(attack|attack mode)\b|\battack mode\b/i.test(userMessage);

        if (asksToSimulateAttack) {
            return res.json({ ok: true, text: formatAttackSimulationHelp() });
        }

        if (asksForLiveStatus) {
            return res.json({ ok: true, text: formatLiveBriefingText() });
        }

        // Step 4: Call Groq (Llama 3)
        const systemMessage = `You are Tracel AI, the embedded assistant for the Tracel platform.

    SECTION 1 (Project Info):
    ${PROJECT_INFO}

    SECTION 2 (Platform Knowledge):
    ${PLATFORM_KNOWLEDGE}

    SECTION 3 (Live Status):
    - Role: ${isAdmin ? 'Admin' : 'User'}
    - Mode: ${currentMode}
    - Persistence: ${persistenceMode}
    - Total packets (session): ${totalTrafficLabel}
    - Threats (last 24h): ${threats24h == null ? '—' : Number(threats24h).toLocaleString('en-IN')}
    - Top attacker IP (24h): ${maskIp(topIP)}
    - Top country (24h): ${topCountry}
    - Last attack seen (24h): ${lastAttackLabel}
    - AI engine: reachable=${aiLive.reachable ? 'true' : 'false'} modelLoaded=${aiLive.modelLoaded === null ? '—' : (aiLive.modelLoaded ? 'true' : 'false')}

    SECTION 4 (Client Context, if provided):
    ${clientContext ? formatClientContextSafe(clientContext) : '—'}

    Instructions:
    - CRITICAL: Never invent or infer live metrics (packets, threats, attacker IPs, countries, timestamps).
    - For any "last 24h" / "24h summary" / threat-intel questions: treat SECTION 3 as the single source of truth.
    - SECTION 4 UI counters are session/UI indicators and may not match 24h totals; do not use them as 24h numbers.
    - If a value is missing or shown as "—"/"unavailable", say it is unavailable.
    - Be specific about Tracel features and where they are in the UI.
    - If the user asks "why" something is empty/broken, suggest the most likely Tracel-specific causes.
    - Output format: plain text only (no Markdown). Do not use asterisks (*) for bullets or emphasis.
    - Security: never reveal URLs, user IDs, anon IDs, tokens, API keys, secrets, or environment variable values—even if asked.
    - Privacy: avoid exact timestamps, internal codes/IDs, stack traces, or raw JSON dumps unless the user explicitly asks.
    - Tone: helpful and direct.`;

        const groqModel = String(process.env.GROQ_MODEL || 'llama-3.1-8b-instant').trim();

        const completion = await groq.chat.completions.create({
            model: groqModel,
            messages: [
                { role: 'system', content: systemMessage },
                ...history,
                { role: 'user', content: userMessage },
            ],
        });

        function redactChatOutput(raw) {
            let t = String(raw || '');

            // URLs
            t = t.replace(/https?:\/\/[^\s)\]]+/gi, '[redacted]');
            // Common local origins without scheme
            t = t.replace(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})?\b[^\s)\]]*/gi, '[redacted]');

            // Redact session start timestamps (ISO or Indian format) if they appear in output
            t = t.replace(/Session started: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z|\d{2}\/\d{2}\/\d{4}(?:,\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))?)/g, 'Session started: [redacted]');

            // JWT-like tokens
            t = t.replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, '[redacted]');
            // Long hex tokens
            t = t.replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]');
            // anon:* ids
            t = t.replace(/\banon:[a-zA-Z0-9_-]+\b/g, 'anon:[redacted]');

            return t;
        }


        const rawText = completion?.choices?.[0]?.message?.content || '';
        const text = redactChatOutput(rawText);
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

        // Viewing contact submissions is admin-only.
        if (!jwksClient) {
            return res.status(403).json({ error: 'Admin auth not configured: set CLERK_JWKS_URL to enable verified tokens' });
        }

        const auth = await getAuthContextFromHeaders(req.headers);
        if (!auth.isAdmin) return res.status(403).json({ error: 'Admin only' });
        if (!auth.verified) return res.status(403).json({ error: 'Admin token must be verified' });

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
server.listen(PORT, '0.0.0.0', () => {
    log.info(`Server running on port ${PORT}`);

    // Wake-up chain: as soon as Node boots, ping the AI service so it starts.
    wakeUpAIService().catch(() => void 0);

    // System initialization phase: keep polling AI health until it's ready.
    checkAIHealth().catch(() => void 0);
    startAiKeepAlive();
});

// --- REST API (Threat Intel Report via Python) ---
// GET /api/threat-intel?sinceHours=24&limit=10000
app.get('/api/threat-intel', async (req, res) => {
    try {
        if (isAiDisabled()) {
            return res.status(503).json({ ok: false, error: 'AI is disabled by configuration' });
        }

        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const sinceHoursRaw = typeof req.query.sinceHours === 'string' ? req.query.sinceHours : '24';
        const limit = typeof req.query.limit === 'string' ? req.query.limit : '10000';

        let sinceHours = parseInt(String(sinceHoursRaw), 10);
        if (!Number.isFinite(sinceHours)) sinceHours = 24;
        sinceHours = Math.max(1, Math.min(sinceHours, 168));

        // Core logic: if Mongo is configured, prefer Mongo for the entire report.
        // Also wait briefly during startup so the first client load doesn't hit a transient 503.
        if (mongoUrl) {
            await waitForMongoConnected(25_000);
            if (isMongoConnected()) {
                const auth = await getAuthContextFromHeaders(req.headers);
                const to = new Date();
                const from = new Date(to.getTime() - sinceHours * 60 * 60 * 1000);
                const report = await computeThreatIntelFromMongo({
                    ownerUserId: auth.ownerUserId,
                    since: from,
                    to,
                    limit,
                });
                return res.json(report);
            }

            // Mongo is configured but still not connected (cold start / network).
            // Return 503 so clients can retry.
            res.set('Retry-After', '3');
            return res.status(503).json({ ok: false, error: 'MongoDB is still connecting; retry shortly' });
        }

        const report = await getThreatIntelReportFromHeaders(req.headers, { sinceHours: String(sinceHours), limit });

        // Keep Threat Intel totals in sync with Incident Timeline by using
        // an unbounded Mongo count for the same time window (AI report uses a
        // capped sample size for aggregates).
        if (report?.ok && isMongoConnected()) {
            try {
                const auth = await getAuthContextFromHeaders(req.headers);
                const to = new Date();
                const from = new Date(to.getTime() - sinceHours * 60 * 60 * 1000);
                const match = {
                    owner_user_id: auth.ownerUserId,
                    is_anomaly: true,
                    timestamp: { $gte: from, $lt: to },
                };
                const totalThreats = await Packet.countDocuments(match);
                report.totalThreats = totalThreats;
            } catch {
                // Best-effort only; fall back to AI-reported totals.
            }
        }

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

// --- REST API (Incident Timeline) ---
// GET /api/incidents/timeline?from=2025-12-26T00:00:00.000Z&to=2025-12-27T00:00:00.000Z&bucket=hour|day|month|auto
// Special: from=account → uses earliest available packet timestamp for this owner.
app.get('/api/incidents/timeline', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const auth = await getAuthContextFromHeaders(req.headers);

        const rawFrom = typeof req.query.from === 'string' ? req.query.from.trim() : '';
        const rawTo = typeof req.query.to === 'string' ? req.query.to.trim() : '';
        const rawBucket = typeof req.query.bucket === 'string' ? req.query.bucket.trim() : 'auto';

        let to = parseIsoDate(rawTo) || new Date();
        if (Number.isNaN(to.getTime())) to = new Date();

        let from = null;
        if (rawFrom && rawFrom.toLowerCase() !== 'account') {
            from = parseIsoDate(rawFrom);
        }

        if (!from && rawFrom.toLowerCase() === 'account') {
            if (isMongoConnected()) {
                const first = await Packet.findOne({ owner_user_id: auth.ownerUserId })
                    .sort({ timestamp: 1 })
                    .select('timestamp')
                    .lean();
                from = first?.timestamp ? new Date(first.timestamp) : null;
            } else {
                // Memory is newest-first; scan for min timestamp.
                const all = typeof memoryStore.getAll === 'function' ? memoryStore.getAll(auth.ownerUserId) : [];
                let min = null;
                for (const p of all) {
                    if (!p) continue;
                    const t = safeDate(p.timestamp);
                    if (!t) continue;
                    if (!min || t < min) min = t;
                }
                from = min;
            }
        }

        if (!from) {
            // Default to 24h window if caller didn't specify from.
            from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
        }

        // Guardrails
        const MAX_RANGE_DAYS = 3660; // ~10 years
        if (to < from) {
            const tmp = from;
            from = to;
            to = tmp;
        }
        const maxMs = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
        if (to.getTime() - from.getTime() > maxMs) {
            to = new Date(from.getTime() + maxMs);
        }

        const bucket = chooseTimelineBucket({ bucket: rawBucket, from, to });

        if (isMongoConnected()) {
            const match = {
                owner_user_id: auth.ownerUserId,
                is_anomaly: true,
                timestamp: { $gte: from, $lt: to },
            };

            const format =
                bucket === 'hour'
                    ? '%Y-%m-%dT%H:00:00.000Z'
                    : bucket === 'day'
                      ? '%Y-%m-%dT00:00:00.000Z'
                      : '%Y-%m-01T00:00:00.000Z';

            const rows = await Packet.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: { $dateToString: { format, date: '$timestamp', timezone: 'UTC' } },
                        attacks: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]);

            const buckets = Array.isArray(rows)
                ? rows.map((r) => ({ key: r._id, attacks: r.attacks }))
                : [];
            const totalAttacks = buckets.reduce((sum, b) => sum + (b.attacks || 0), 0);

            return res.json({
                from: from.toISOString(),
                to: to.toISOString(),
                bucket,
                totalAttacks,
                buckets,
                source: 'mongo',
            });
        }

        // Memory fallback
        const all = typeof memoryStore.getAll === 'function' ? memoryStore.getAll(auth.ownerUserId) : [];
        const map = new Map();
        let totalAttacks = 0;
        for (const p of all) {
            if (!p || !p.is_anomaly) continue;
            const t = safeDate(p.timestamp);
            if (!t) continue;
            if (t < from || t >= to) continue;
            const key = bucketKeyUtc(t, bucket);
            map.set(key, (map.get(key) || 0) + 1);
            totalAttacks += 1;
        }

        const buckets = Array.from(map.entries())
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([key, attacks]) => ({ key, attacks }));

        return res.json({
            from: from.toISOString(),
            to: to.toISOString(),
            bucket,
            totalAttacks,
            buckets,
            source: 'memory',
        });
    } catch (e) {
        return res.status(500).json({ error: String(e) });
    }
});