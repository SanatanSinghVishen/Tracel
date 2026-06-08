const { getAuthContextFromHeaders } = require('../middleware/authMiddleware');

jest.mock('jsonwebtoken', () => ({
    decode: jest.fn((token) => {
        if (token === 'valid_token') {
            return {
                email: 'admin@example.com',
                public_metadata: { role: 'admin' },
                sub: 'user_123'
            };
        }
        if (token === 'valid_token_no_role') {
            return {
                email: 'user@example.com',
                sub: 'user_456'
            };
        }
        return null;
    })
}));

describe('authMiddleware', () => {
    it('extracts auth context from valid token', async () => {
        const headers = {
            authorization: 'Bearer valid_token'
        };
        const context = await getAuthContextFromHeaders(headers);
        expect(context).toEqual({
            isAdmin: true,
            ownerEmail: 'admin@example.com',
            ownerUserId: 'user_123',
            role: 'admin',
            verified: false
        });
    });

    it('extracts auth context without role', async () => {
        const headers = {
            authorization: 'Bearer valid_token_no_role'
        };
        const context = await getAuthContextFromHeaders(headers);
        expect(context).toEqual({
            isAdmin: false,
            ownerEmail: 'user@example.com',
            ownerUserId: 'user_456',
            role: 'analyst',
            verified: false
        });
    });

    it('handles missing auth header gracefully', async () => {
        const headers = {};
        const context = await getAuthContextFromHeaders(headers);
        expect(context.isAdmin).toBe(false);
        expect(context.ownerEmail).toBe('');
        expect(context.role).toBe('analyst');
        expect(context.ownerUserId).toMatch(/^anon:\d+$/);
    });
});
