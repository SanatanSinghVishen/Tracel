const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');

const CLERK_JWKS_URL = (process.env.CLERK_JWKS_URL || '').trim();

const jwksClient = CLERK_JWKS_URL
    ? jwksRsa({
        jwksUri: CLERK_JWKS_URL,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
    })
    : null;

function getBearerTokenFromHeaders(headers) {
    const auth = headers?.authorization;
    if (typeof auth !== 'string') return '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : '';
}

function getAnonIdFromHeaders(headers) {
    const anon = headers?.['x-tracel-anon-id'];
    return typeof anon === 'string' ? anon.trim() : '';
}

function getSessionIdFromHeaders(headers) {
    const sid = headers?.['x-tracel-session-id'];
    return typeof sid === 'string' ? sid.trim() : '';
}

function safeDecodeJwtPayload(token) {
    try {
        const payload = jwt.decode(token);
        return payload && typeof payload === 'object' ? payload : null;
    } catch {
        return null;
    }
}

function verifyJwtIfConfigured(token) {
    if (!jwksClient) return Promise.resolve(null);
    return new Promise((resolve) => {
        jwt.verify(
            token,
            (header, cb) => {
                jwksClient.getSigningKey(header.kid, (err, key) => {
                    if (err) return cb(err);
                    const signingKey = key.getPublicKey();
                    return cb(null, signingKey);
                });
            },
            {
                algorithms: ['RS256'],
            },
            (err, decoded) => {
                if (err) return resolve(null);
                return resolve(decoded && typeof decoded === 'object' ? decoded : null);
            }
        );
    });
}

function extractEmailFromClaims(claims) {
    if (!claims || typeof claims !== 'object') return '';

    const directCandidates = [
        claims.email,
        claims.email_address,
        claims.primary_email,
        claims.primary_email_address,
        claims?.user?.email,
        claims?.user?.email_address,
        claims?.user?.primary_email,
        claims?.user?.primary_email_address,
        claims?.public_metadata?.email,
        claims?.publicMetadata?.email,
        claims?.unsafe_metadata?.email,
        claims?.unsafeMetadata?.email,
    ];

    const fromDirect = directCandidates.find((v) => typeof v === 'string' && v.includes('@'));
    if (fromDirect) return String(fromDirect).trim().toLowerCase();

    const listCandidates = [
        claims.email_addresses,
        claims?.user?.email_addresses,
        claims?.user?.emailAddresses,
    ];

    for (const list of listCandidates) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            if (typeof entry === 'string' && entry.includes('@')) return entry.trim().toLowerCase();
            if (entry && typeof entry === 'object') {
                const v = entry.email_address || entry.emailAddress || entry.email;
                if (typeof v === 'string' && v.includes('@')) return v.trim().toLowerCase();
            }
        }
    }

    return '';
}

function extractRoleFromClaims(claims) {
    if (!claims || typeof claims !== 'object') return 'analyst';
    
    // Check Clerk org_role or custom publicMetadata.role
    const role = claims.org_role || claims.publicMetadata?.role || claims.public_metadata?.role;
    if (typeof role === 'string') {
        const lowerRole = role.toLowerCase();
        // Sometimes org_role is prefixed with "org:" e.g. "org:admin"
        if (lowerRole.includes('admin')) {
            return 'admin';
        }
    }
    return 'analyst';
}

async function getAuthContextFromHeaders(headers) {
    const token = getBearerTokenFromHeaders(headers);
    const anonId = getAnonIdFromHeaders(headers);
    const sid = getSessionIdFromHeaders(headers);
    const fallbackId = `anon:${Date.now()}`;

    if (!token) {
        return {
            ownerUserId: sid ? `sess:${sid}` : (anonId ? `anon:${anonId}` : fallbackId),
            ownerEmail: '',
            role: 'analyst',
            isAdmin: false,
            verified: false,
        };
    }

    const verifiedClaims = await verifyJwtIfConfigured(token);
    const claims = verifiedClaims || safeDecodeJwtPayload(token);

    const userId = typeof claims?.sub === 'string' && claims.sub.trim() ? claims.sub.trim() : '';
    const email = extractEmailFromClaims(claims);
    const role = extractRoleFromClaims(claims);
    const isAdmin = role === 'admin';

    return {
        ownerUserId: userId || (sid ? `sess:${sid}` : (anonId ? `anon:${anonId}` : fallbackId)),
        ownerEmail: email,
        role,
        isAdmin,
        verified: !!verifiedClaims,
    };
}

const authMiddleware = async (req, res, next) => {
    try {
        const auth = await getAuthContextFromHeaders(req.headers);
        req.auth = auth;
        req.userRole = auth.role;
        next();
    } catch (e) {
        req.auth = {
            ownerUserId: `anon:${Date.now()}`,
            ownerEmail: '',
            role: 'analyst',
            isAdmin: false,
            verified: false
        };
        req.userRole = 'analyst';
        next();
    }
};

module.exports = {
    authMiddleware,
    getAuthContextFromHeaders,
    jwksClient
};
