const mongoose = require('mongoose');
const log = require('../logger');

let poolSize = parseInt(process.env.MONGO_POOL_SIZE || '10', 10);
if (isNaN(poolSize) || poolSize <= 0) poolSize = 10;

const connectDb = async () => {
    const mongoUrl = process.env.MONGO_URL;
    if (!mongoUrl) {
        log.info('MONGO_URL not set - running without persistence (using memory store)');
        return;
    }

    const options = {
        maxPoolSize: poolSize,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        heartbeatFrequencyMS: 10000,
        retryWrites: true,
        retryReads: true
    };

    mongoose.connection.on('connected', () => {
        log.info('[DB] MongoDB connected successfully');
    });

    mongoose.connection.on('disconnected', () => {
        log.warn('[DB] MongoDB disconnected. Falling back to memory store.');
    });

    mongoose.connection.on('reconnected', () => {
        log.info('[DB] MongoDB reconnected');
    });

    mongoose.connection.on('error', (err) => {
        log.error('[DB] MongoDB connection error', {
            message: err.message,
            code: err.code,
            name: err.name
        });
    });

    try {
        await mongoose.connect(mongoUrl, options);
    } catch (err) {
        log.error('[DB] Initial MongoDB connection failed', { error: err.message });
    }
};

const getDbStatus = () => {
    try {
        const stateMap = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting',
            99: 'uninitialized',
        };
        const stateCode = mongoose.connection.readyState;
        const state = stateMap[stateCode] || 'unknown';
        const connected = stateCode === 1;

        let host = 'none';
        if (mongoose.connection.host) {
            host = mongoose.connection.host;
        }

        return {
            connected,
            state,
            poolSize: process.env.MONGO_URL ? poolSize : 0,
            host
        };
    } catch (e) {
        // Safe fallback if mongoose is completely broken
        return {
            connected: false,
            state: 'error',
            poolSize: 0,
            host: 'unknown'
        };
    }
};

module.exports = {
    connectDb,
    getDbStatus
};
