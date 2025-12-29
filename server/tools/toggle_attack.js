// Usage: node server/tools/toggle_attack.js <anonId> <true|false>
// Connects to the local Socket.IO server and emits toggle_attack for the given anonId.

const path = require('path');

const anonId = process.argv[2] || 'qa-sim';
const modeRaw = (process.argv[3] || 'true').toLowerCase();
const mode = modeRaw === 'true' || modeRaw === '1' || modeRaw === 'yes';

// Reuse the dashboard's socket.io-client dependency to avoid adding server deps.
const clientPath = path.resolve(__dirname, '..', '..', 'dashboard', 'node_modules', 'socket.io-client');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { io } = require(clientPath);

const url = process.env.SOCKET_URL || 'http://localhost:3001';

const socket = io(url, {
  auth: { anonId },
  transports: ['websocket', 'polling'],
});

const done = (code) => {
  try {
    socket.close();
  } catch {
    // ignore
  }
  process.exit(code);
};

socket.on('connect', () => {
  // Emit once and exit.
  socket.emit('toggle_attack', mode);
  setTimeout(() => done(0), 150);
});

socket.on('connect_error', (err) => {
  // eslint-disable-next-line no-console
  console.error('connect_error', err && err.message ? err.message : err);
  done(1);
});
