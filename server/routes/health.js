const express = require('express');
const router = express.Router();
const Redis = require('ioredis');
const { getDbStatus } = require('../config/database');
const http = require('http');

let redisClient = null;
if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        showFriendlyErrorStack: true
    });
    // We connect manually on demand or just use ping directly if already connected.
}

const checkRedis = async () => {
    if (!redisClient) return { status: 'degraded', latency_ms: null, reason: 'REDIS_URL not set (optional)' };
    const start = Date.now();
    try {
        if (redisClient.status === 'wait') {
            await redisClient.connect().catch(() => {});
        }
        await redisClient.ping();
        return { status: 'ok', latency_ms: Date.now() - start };
    } catch (e) {
        return { status: 'error', latency_ms: null, reason: e.message };
    }
};

const checkAiEngine = () => {
    return new Promise((resolve) => {
        let aiUrl = process.env.AI_SERVICE_URL;
        if (!aiUrl && process.env.AI_PREDICT_URL) {
            try {
                const u = new URL(process.env.AI_PREDICT_URL);
                aiUrl = u.origin;
            } catch (e) {
                aiUrl = 'http://127.0.0.1:5000';
            }
        }
        aiUrl = aiUrl || 'http://127.0.0.1:5000';
        const start = Date.now();
        const req = http.get(`${aiUrl}/health`, { timeout: 2000 }, (res) => {
            if (res.statusCode === 200) {
                resolve({ status: 'ok', latency_ms: Date.now() - start });
            } else {
                resolve({ status: 'degraded', latency_ms: null, reason: `Status ${res.statusCode}` });
            }
        });

        req.on('error', (e) => {
            resolve({ status: 'degraded', latency_ms: null, reason: e.message });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 'degraded', latency_ms: null, reason: 'Timeout' });
        });
    });
};

router.get('/', async (req, res) => {
    // 1. Check Redis
    const redisHealth = await checkRedis();
    
    // 2. Check MongoDB
    const dbStatus = getDbStatus();
    let mongoHealth = { status: 'ok', latency_ms: null };
    if (!dbStatus.connected && dbStatus.poolSize > 0) {
        mongoHealth = { status: 'degraded', latency_ms: null, reason: 'Disconnected fallback' };
    } else if (dbStatus.poolSize === 0) {
        mongoHealth = { status: 'degraded', latency_ms: null, reason: 'Running in memory' };
    }

    // 3. Check AI Engine
    const aiHealth = await checkAiEngine();

    const uptime = process.uptime();
    const version = process.env.npm_package_version || '1.0.0';

    const checks = {
        redis: redisHealth,
        mongodb: mongoHealth,
        ai_engine: aiHealth
    };

    let overallStatus = 'ok';
    if (redisHealth.status === 'error') {
        overallStatus = 'error'; // Redis is required for worker
    } else if (mongoHealth.status === 'degraded' || aiHealth.status === 'degraded') {
        overallStatus = 'degraded'; // Degraded if optional deps are down
    }

    const payload = {
        status: overallStatus,
        service: 'node-backend',
        version: version,
        uptime_s: Math.floor(uptime),
        checks: checks
    };

    if (overallStatus === 'error') {
        res.status(503).json(payload);
    } else {
        res.status(200).json(payload);
    }
});

module.exports = router;
