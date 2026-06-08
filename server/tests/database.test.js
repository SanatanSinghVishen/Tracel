const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { connectDb, getDbStatus } = require('../config/database');

describe('Database config', () => {
    let mongoServer;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        process.env.MONGO_URL = mongoServer.getUri();
    });

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
        delete process.env.MONGO_URL;
    });

    it('connects to mongodb successfully', async () => {
        await connectDb();
        expect(mongoose.connection.readyState).toBe(1);
    });

    it('getDbStatus returns correct shape', () => {
        const status = getDbStatus();
        expect(status.connected).toBe(true);
        expect(status.state).toBe('connected');
        expect(status.poolSize).toBe(10);
        expect(typeof status.host).toBe('string');
    });

    it('handles disconnection gracefully', async () => {
        await mongoose.disconnect();
        const status = getDbStatus();
        expect(status.connected).toBe(false);
        expect(status.state).toBe('disconnected');
    });
});
