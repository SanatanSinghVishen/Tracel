const WINDOW_MS = parseInt(process.env.SOCKET_WINDOW_MS || '60000', 10);
const MAX_CONNECTIONS = parseInt(process.env.SOCKET_MAX_CONNECTIONS_PER_WINDOW || '10', 10);

const ipConnections = new Map();

// Auto-clean expired windows to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of ipConnections.entries()) {
        if (now > data.resetTime) {
            ipConnections.delete(ip);
        }
    }
}, Math.max(WINDOW_MS, 60000)).unref();

function socketThrottle(socket, next) {
    // Attempt to get IP from headers (behind proxy) or direct address
    let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || 'unknown';
    
    // x-forwarded-for can be a comma-separated list; take the first one
    if (ip.includes(',')) {
        ip = ip.split(',')[0].trim();
    }

    const now = Date.now();
    let data = ipConnections.get(ip);

    if (!data || now > data.resetTime) {
        // First connection or window expired, reset counter
        data = { count: 1, resetTime: now + WINDOW_MS };
        ipConnections.set(ip, data);
        return next();
    }

    if (data.count >= MAX_CONNECTIONS) {
        // Limit exceeded, reject the socket
        return next(new Error('RATE_LIMITED'));
    }

    // Increment count and allow connection
    data.count++;
    return next();
}

module.exports = socketThrottle;
