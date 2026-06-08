const socketThrottle = require('../middleware/socketThrottle');

describe('socketThrottle middleware', () => {
    beforeEach(() => {
        // Since the module is stateful (ipConnections map), we should probably test the behavior
        // over the window limit or mock the map, but it's an internal map. 
        // We can just use different IPs for each test to avoid cross-contamination.
    });

    it('allows connections under the limit', () => {
        const socket = {
            handshake: {
                address: '192.168.1.100',
                headers: {}
            }
        };

        for (let i = 0; i < 10; i++) {
            const next = jest.fn();
            socketThrottle(socket, next);
            expect(next).toHaveBeenCalledWith();
        }
    });

    it('rejects connections over the limit with RATE_LIMITED', () => {
        const socket = {
            handshake: {
                address: '192.168.1.101',
                headers: {}
            }
        };

        // Connect 10 times (assuming MAX_CONNECTIONS is 10)
        for (let i = 0; i < 10; i++) {
            const next = jest.fn();
            socketThrottle(socket, next);
            expect(next).toHaveBeenCalledWith();
        }

        // 11th connection should fail
        const nextFailed = jest.fn();
        socketThrottle(socket, nextFailed);
        expect(nextFailed).toHaveBeenCalledWith(expect.any(Error));
        expect(nextFailed.mock.calls[0][0].message).toBe('RATE_LIMITED');
    });

    it('extracts IP from x-forwarded-for if available', () => {
        const socket = {
            handshake: {
                address: '127.0.0.1', // Proxy IP
                headers: {
                    'x-forwarded-for': '203.0.113.50, 198.51.100.1'
                }
            }
        };

        const next = jest.fn();
        socketThrottle(socket, next);
        expect(next).toHaveBeenCalledWith();
        
        // This is tricky to observe internally without modifying state, 
        // but we can trigger RATE_LIMITED to verify the IP was registered as '203.0.113.50'
        // Let's connect 9 more times with the proxy header
        for (let i = 0; i < 9; i++) {
            const n = jest.fn();
            socketThrottle(socket, n);
            expect(n).toHaveBeenCalledWith();
        }
        
        // The 11th time it should reject
        const nextFailed = jest.fn();
        socketThrottle(socket, nextFailed);
        expect(nextFailed).toHaveBeenCalledWith(expect.any(Error));
        expect(nextFailed.mock.calls[0][0].message).toBe('RATE_LIMITED');
        
        // Now if another request comes directly from the proxy address without x-forwarded-for, it should be allowed
        const socketDirect = {
            handshake: {
                address: '127.0.0.1',
                headers: {}
            }
        };
        const nextDirect = jest.fn();
        socketThrottle(socketDirect, nextDirect);
        expect(nextDirect).toHaveBeenCalledWith();
    });
});
