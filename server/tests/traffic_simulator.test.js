const { createTrafficStream } = require('../traffic_simulator');

jest.mock('../logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock('ioredis', () => {
    return function() {
        return {
            status: 'ready',
            lpush: jest.fn().mockResolvedValue(1),
            brpop: jest.fn().mockReturnValue(new Promise(() => {})),
            on: jest.fn()
        };
    };
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
    describe('AI Result Timeout & DLQ', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
            const { stopPeriodicSweep } = require('../traffic_simulator');
            stopPeriodicSweep();
        });

        it('times out and applies safe defaults after AI_RESULT_TIMEOUT_MS', async () => {
            const { getPendingClosuresCount, createTrafficStream } = require('../traffic_simulator');
            
            let emittedPacket = null;
            const stream = createTrafficStream({
                emitPacket: (p) => { emittedPacket = p; },
                persistPacket: jest.fn(),
            });

            // Start generating a packet
            stream.start();
            
            // Fast forward slightly to trigger the first setTimeout
            jest.advanceTimersByTime(100);
            
            // Wait for generatePacket to enqueue
            await new Promise(process.nextTick);
            await new Promise(process.nextTick);
            await new Promise(process.nextTick);
            stream.stop();

            // At this point, packet is in inFlightPackets
            expect(getPendingClosuresCount()).toBeGreaterThan(0);

            // Fast forward time past timeout (10000ms default)
            jest.advanceTimersByTime(11000);

            // Safe defaults should be emitted
            expect(emittedPacket).toBeDefined();
            expect(emittedPacket.is_anomaly).toBe(false);
            expect(emittedPacket.ai_not_analyzed).toBe(true);

            // Map should be cleaned up
            expect(getPendingClosuresCount()).toBe(0);
        });
    });
});
