// server/traffic_simulator.js
const axios = require('axios');
const log = require('./logger');

const TARGET_IP = "10.0.0.1";
// Simulate multiple internal services behind a load balancer / subnet.
const TARGET_SERVICE_IPS = [
    '10.0.0.1',
    '10.0.0.2',
    '10.0.0.3',
    '10.0.0.4',
    '10.0.0.5',
];

// Simulated DDoS botnet (public IPs from diverse ranges/regions).
// Note: These are example-looking IPs for simulation only.
const BOTNET_IPS = [
    '45.67.89.12',
    '45.142.211.34',
    '45.155.204.77',
    '46.17.98.201',
    '51.15.220.19',
    '62.210.130.88',
    '77.73.67.10',
    '80.66.88.121',
    '89.38.97.55',
    '91.92.109.240',
    '94.156.65.33',
    '95.179.164.50',
    '103.14.55.2',
    '103.74.118.91',
    '103.152.79.44',
    '104.248.12.9',
    '109.123.231.61',
    '128.199.212.40',
    '138.197.15.88',
    '139.59.78.173',
    '144.217.77.16',
    '159.65.134.27',
    '167.172.102.53',
    '176.58.123.199',
    '185.12.45.210',
    '185.199.109.153',
    '188.166.22.101',
    '193.29.13.88',
];

function getAiPredictUrl() {
    return process.env.AI_PREDICT_URL || 'http://127.0.0.1:5000/predict';
}

function getRandomIP() {
    return `192.168.1.${Math.floor(Math.random() * 255)}`; 
}

function getRandomBotnetIP() {
    return BOTNET_IPS[Math.floor(Math.random() * BOTNET_IPS.length)];
}

function getRandomTargetServiceIP() {
    return TARGET_SERVICE_IPS[Math.floor(Math.random() * TARGET_SERVICE_IPS.length)];
}

function getAttackMethod() {
    // Heavily skewed toward write operations in attack mode.
    const r = Math.random();
    if (r < 0.70) return 'POST';
    if (r < 0.90) return 'PUT';
    return 'GET';
}

function getSourceIP(isAttackMode) {
    if (isAttackMode) return getRandomBotnetIP();
    return getRandomIP();
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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

        const destination_ip = isAttackMode ? getRandomTargetServiceIP() : TARGET_IP;
        const method = isAttackMode ? getAttackMethod() : 'GET';

        const packetData = {
            owner_user_id: owner || undefined,
            source_ip: getSourceIP(isAttackMode),
            destination_ip,
            method,
            // Attack traffic uses larger payloads.
            bytes: isAttackMode ? (Math.floor(Math.random() * 8000) + 4000) : Math.floor(Math.random() * 500) + 200,
            timestamp: new Date()
        };

        // --- STEP 1: ASK AI FOR VERDICT ---
        try {
            const response = await axios.post(
                getAiPredictUrl(),
                {
                    bytes: packetData.bytes,
                    method: packetData.method
                },
                { timeout: 1500 }
            );

            packetData.is_anomaly = response.data.is_anomaly;
            packetData.anomaly_score = response.data.anomaly_score;
        } catch (error) {
            packetData.is_anomaly = false;
            packetData.anomaly_score = 0;
        }

        if (isAttackMode) {
            packetData.is_anomaly = true;
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