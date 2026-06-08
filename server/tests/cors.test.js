const express = require('express');
const cors = require('cors');
const request = require('supertest');
const { corsOptions, CorsForbiddenError } = require('../config/cors');

describe('CORS config', () => {
    let app;

    beforeEach(() => {
        process.env.FRONTEND_URL = 'https://tracel.vercel.app';
        process.env.NODE_ENV = 'production';
        
        app = express();
        app.use(cors(corsOptions));
        
        // Custom error handler for CORS as in index.js
        app.use((err, req, res, next) => {
            if (err instanceof CorsForbiddenError) {
                return res.status(403).json({ error: 'Origin not allowed by CORS' });
            }
            next(err);
        });

        app.get('/test', (req, res) => res.json({ ok: true }));
    });

    afterEach(() => {
        delete process.env.FRONTEND_URL;
        delete process.env.NODE_ENV;
    });

    it('allows requests from FRONTEND_URL', async () => {
        const res = await request(app)
            .get('/test')
            .set('Origin', 'https://tracel.vercel.app');
        
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe('https://tracel.vercel.app');
    });

    it('rejects requests from disallowed origins with 403', async () => {
        const res = await request(app)
            .get('/test')
            .set('Origin', 'https://evil.com');
        
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Origin not allowed by CORS');
    });

    it('handles OPTIONS preflight correctly', async () => {
        const res = await request(app)
            .options('/test')
            .set('Origin', 'https://tracel.vercel.app')
            .set('Access-Control-Request-Method', 'POST');
        
        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('https://tracel.vercel.app');
        expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    it('allows all origins in development mode', async () => {
        process.env.NODE_ENV = 'development';
        const res = await request(app)
            .get('/test')
            .set('Origin', 'http://localhost:5173');
        
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });
});
