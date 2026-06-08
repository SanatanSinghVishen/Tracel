const log = require('../logger');

class CorsForbiddenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CorsForbiddenError';
        this.status = 403;
    }
}

const getAllowedOrigins = () => {
    const rawUrl = process.env.FRONTEND_URL || '';
    const origins = rawUrl.split(',').map(url => url.trim()).filter(Boolean);
    
    // In development, also allow local dev server
    if (process.env.NODE_ENV === 'development') {
        if (!origins.includes('http://localhost:5173')) {
            origins.push('http://localhost:5173');
        }
    }
    return origins;
};

const buildCorsOptions = () => {
    return {
        origin: (origin, callback) => {
            const allowedOrigins = getAllowedOrigins();

            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) {
                return callback(null, true);
            }

            if (process.env.NODE_ENV === 'development') {
                log.warn(`[CORS] Allowing cross-origin request in development from: ${origin}`);
                return callback(null, true);
            }

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            log.error(`[CORS] Rejected cross-origin request from: ${origin}`);
            return callback(new CorsForbiddenError(`Origin ${origin} not allowed by CORS`));
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true
    };
};

const corsOptions = buildCorsOptions();

// Export the config so it can be passed to Express cors() and Socket.IO
module.exports = {
    corsOptions,
    CorsForbiddenError,
    getAllowedOrigins
};
