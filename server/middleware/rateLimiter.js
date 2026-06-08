const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const maxHttp = parseInt(process.env.RATE_LIMIT_MAX_HTTP || '200', 10);
const maxAdmin = parseInt(process.env.RATE_LIMIT_MAX_ADMIN || '20', 10);

const keyGenerator = (req, res) => {
    // Attempt to extract authenticated user id from clerk/jwks
    const userId = req.user?.sub || req.user?.id || req.auth?.userId || '';
    const ip = ipKeyGenerator(req, res) || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    return userId ? `${ip}_${userId}` : ip;
};

const handler = (req, res, next, options) => {
    res.status(429).json({
        status: 429,
        title: "Too Many Requests",
        detail: options.message || "You have exceeded your request limit."
    });
};

const globalLimiter = rateLimit({
    windowMs,
    max: maxHttp,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator,
    handler,
    message: "Global rate limit exceeded. Please wait before trying again."
});

const strictLimiter = rateLimit({
    windowMs,
    max: maxAdmin,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler,
    message: "Strict rate limit exceeded for sensitive route. Please wait before trying again."
});

module.exports = { globalLimiter, strictLimiter };
