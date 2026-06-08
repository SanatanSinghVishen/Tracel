import { useContext, useEffect, useState } from 'react';
import { SocketContext } from '../context/socketContext';

export function useConnectionStatus() {
  const { connection } = useContext(SocketContext);
  const { connected, nextReconnect, reconnectAttempt } = connection;
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (connected || !nextReconnect) {
      setCountdown(0);
      return;
    }

    const interval = setInterval(() => {
      const remaining = Math.max(0, nextReconnect - Date.now());
      setCountdown(Math.ceil(remaining / 1000));
    }, 1000);

    // Initial calculation
    setCountdown(Math.max(0, Math.ceil((nextReconnect - Date.now()) / 1000)));

    return () => clearInterval(interval);
  }, [connected, nextReconnect]);

  return {
    connected,
    reconnectAttempt,
    countdown,
    isReconnecting: reconnectAttempt > 0 && !connected
  };
}
