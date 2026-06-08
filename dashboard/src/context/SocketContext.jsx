import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { getServerUrl, getSocket, setSocketAuth } from '../lib/socket.js';
import { getOrCreateAnonId } from '../lib/authClient.js';
import { SocketContext } from './socketContext.js';

export function SocketProvider({ children }) {
  const { isLoaded, userId, getToken } = useAuth();
  const socket = useMemo(() => getSocket(), []);
  const anonId = useMemo(() => getOrCreateAnonId(), []);
  const lastAuthRef = useRef({ tokenPresent: false, userId: null, anonId: null });
  const [connection, setConnection] = useState({
    connected: socket.connected,
    serverUrl: getServerUrl(),
    nextReconnect: null,
    reconnectAttempt: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function applyAuthAndConnect() {
      try {
        // Ensure the server-issued session cookie exists before opening Socket.IO.
        // This keeps guest identity stable even when localStorage is blocked.
        try {
          const base = getServerUrl().replace(/\/$/, '');
          await fetch(`${base}/api/session`, { credentials: 'include' });
        } catch {
          // Ignore; Socket.IO can still connect, but identity may be per-connection.
        }

        const token = isLoaded ? await getToken() : null;
        if (cancelled) return;

        const nextAuth = {
          tokenPresent: !!token,
          userId: userId || null,
          anonId: anonId || null,
        };

        const last = lastAuthRef.current;
        const shouldReconnect =
          socket.connected &&
          (last.tokenPresent !== nextAuth.tokenPresent || last.userId !== nextAuth.userId || last.anonId !== nextAuth.anonId);

        lastAuthRef.current = nextAuth;

        setSocketAuth({ token, anonId });
        if (shouldReconnect) socket.disconnect();
        if (!socket.connected) socket.connect();
      } catch {
        setSocketAuth({ token: null, anonId });
        if (!socket.connected) socket.connect();
      }
    }

    applyAuthAndConnect();

    return () => {
      cancelled = true;
    };
  }, [socket, anonId, isLoaded, userId, getToken]);

  useEffect(() => {
    let backoffTimer;
    let backoffDelay = 1000;

    function onConnect() {
      setConnection((s) => ({ ...s, connected: true, nextReconnect: null, reconnectAttempt: 0 }));
      backoffDelay = 1000; // Reset backoff on successful connect
    }

    function onDisconnect() {
      setConnection((s) => ({ ...s, connected: false }));
    }

    function onConnectError(err) {
      if (err.message === 'RATE_LIMITED') {
        console.warn(`Socket connection rate limited. Retrying in ${backoffDelay}ms`);
        clearTimeout(backoffTimer);
        const nextTime = Date.now() + backoffDelay;
        setConnection((s) => ({ ...s, connected: false, nextReconnect: nextTime, reconnectAttempt: s.reconnectAttempt + 1 }));
        
        backoffTimer = setTimeout(() => {
          socket.connect();
          backoffDelay = Math.min(backoffDelay * 2, 60000); // Exponential backoff up to 60s
        }, backoffDelay);
      } else {
        // Normal socket.io reconnect delay tracking
        const nextTime = Date.now() + backoffDelay;
        setConnection((s) => ({ ...s, connected: false, nextReconnect: nextTime, reconnectAttempt: s.reconnectAttempt + 1 }));
        backoffDelay = Math.min(backoffDelay * 2, 30000);
      }
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      clearTimeout(backoffTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, connection }}>
      {children}
    </SocketContext.Provider>
  );
}
