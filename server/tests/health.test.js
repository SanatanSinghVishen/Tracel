const request = require('supertest');
const express = require('express');

// Mock external dependencies
jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => {
        return {
            status: 'ready',
            connect: jest.fn().mockResolvedValue(),
            ping: jest.fn().mockResolvedValue('PONG'),
            brpop: jest.fn().mockReturnValue(new Promise(() => {})), // Never resolves
            lpush: jest.fn().mockResolvedValue(1),
            on: jest.fn()
        };
    });
});

jest.mock('../config/database', () => ({
    getDbStatus: jest.fn()
}));

process.env.REDIS_URL = 'redis://localhost:6379';

const http = require('http');
const healthRoute = require('../routes/health');
const { getDbStatus } = require('../config/database');

const app = express();
app.use('/health', healthRoute);

describe('GET /health', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(http, 'get').mockImplementation((url, options, callback) => {
            if (callback) {
                callback({ statusCode: 200 });
            }
            return {
                on: jest.fn(),
                destroy: jest.fn()
            };
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should return 200 ok when all dependencies are healthy', async () => {
        getDbStatus.mockReturnValue({ connected: true, poolSize: 10 });

        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.service).toBe('node-backend');
        expect(res.body.checks.redis.status).toBe('ok');
    });

    it('should return 200 degraded when MongoDB is disconnected', async () => {
        getDbStatus.mockReturnValue({ connected: false, poolSize: 10 });

        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
        expect(res.body.checks.mongodb.status).toBe('degraded');
    });

    it('should return 200 degraded when running in memory', async () => {
        getDbStatus.mockReturnValue({ connected: false, poolSize: 0 });

        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
        expect(res.body.checks.mongodb.status).toBe('degraded');
    });
});
