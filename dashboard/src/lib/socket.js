import { io } from 'socket.io-client';

const DEFAULT_SERVER_URL = 'http://localhost:3000';

let socketSingleton = null;
let socketUrl = null;

export function getServerUrl() {
  const raw = (import.meta.env.VITE_SERVER_URL || '').trim();
  if (!raw) return DEFAULT_SERVER_URL;

  // Allow shorthand forms during local dev.
  // Examples:
  //  - localhost:3000  -> http://localhost:3000
  //  - 127.0.0.1:3000  -> http://127.0.0.1:3000
  //  - :3000           -> http://localhost:3000
  //  - http://...      -> unchanged
  let urlStr = '';
  if (raw.startsWith(':')) urlStr = `http://localhost${raw}`;
  else if (/^https?:\/\//i.test(raw)) urlStr = raw;
  else urlStr = `http://${raw}`;

  // Critical for cookie-based sessions:
  // localhost:5173 -> 127.0.0.1:3000 is cross-site, so SameSite=Lax cookies won't be sent.
  // Normalize loopback hostnames to the *page hostname* so sessions persist.
  try {
    const u = new URL(urlStr);
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
    const pageHost = typeof window !== 'undefined' ? window.location?.hostname : '';

    if (loopbackHosts.has(u.hostname) && loopbackHosts.has(pageHost)) {
      u.hostname = pageHost === '0.0.0.0' ? 'localhost' : pageHost;
    }

    // Keep as origin (no trailing slash) for consistent fetch/socket use.
    return u.origin;
  } catch {
    return urlStr;
  }
}

export function getSocket() {
  const url = getServerUrl();

  // If VITE_SERVER_URL changes between HMR reloads, recreate.
  if (!socketSingleton || socketUrl !== url) {
    socketUrl = url;
    socketSingleton = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
      withCredentials: true,
    });
  }

  return socketSingleton;
}

export function setSocketAuth({ token, anonId } = {}) {
  const socket = getSocket();
  socket.auth = {
    token: token || undefined,
    anonId: anonId || undefined,
  };
  return socket;
}
