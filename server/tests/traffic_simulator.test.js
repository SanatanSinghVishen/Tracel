const { createTrafficStream } = require('../traffic_simulator');

jest.mock('../logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock('ioredis', () => {
    const Redis = require('ioredis-mock');
    return Redis;
});

describe('traffic_simulator', () => {
    it('creates a traffic stream', () => {
        const stream = createTrafficStream({
            emitPacket: jest.fn(),
            persistPacket: jest.fn(),
        });

        expect(stream).toBeDefined();
        expect(typeof stream.start).toBe('function');
        expect(typeof stream.stop).toBe('function');
        expect(stream.isAttackMode).toBe(false);
        
        stream.setAttackMode(true);
        expect(stream.isAttackMode).toBe(true);
    });
});
