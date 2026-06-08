const log = require('../logger');

describe('logger', () => {
    it('should export standard log methods', () => {
        expect(typeof log.info).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
        expect(typeof log.debug).toBe('function');
        expect(typeof log.child).toBe('function');
    });

    it('should handle child loggers', () => {
        const child = log.child({ packetId: '123' });
        expect(typeof child.info).toBe('function');
        // We can't easily spy on pino's stdout, but we can make sure it doesn't throw.
        child.info('Test log from child');
    });

    it('should handle standard logs without throwing', () => {
        log.info('Test message');
        log.warn('Warning', { details: 'test' });
        log.error({ err: new Error('test') }, 'Error message');
    });
});
