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
    function onConnect() {
      setConnection((s) => ({ ...s, connected: true }));
    }

    function onDisconnect() {
      setConnection((s) => ({ ...s, connected: false }));
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, connection }}>
      {children}
    </SocketContext.Provider>
  );
}
