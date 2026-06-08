const { jwksClient } = require('./authMiddleware');

const requireAdmin = (req, res, next) => {
    // Admin operations require verified JWTs. Without JWKS configured, we cannot safely validate Clerk-issued tokens.
    if (!jwksClient) {
        return res.status(403).json({ error: 'Admin auth not configured: set CLERK_JWKS_URL to enable verified tokens' });
    }

    if (!req.auth || !req.auth.verified) {
        return res.status(403).json({ error: 'Admin token must be verified' });
    }

    if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }

    next();
};

module.exports = requireAdmin;
