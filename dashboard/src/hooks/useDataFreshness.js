import { useState, useEffect } from 'react';
import { useSocket } from './useSocket';

export function useDataFreshness() {
  const { socket, connection } = useSocket();
  const [lastPacketAt, setLastPacketAt] = useState(null);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    if (!socket) return;

    const handlePacket = () => {
      setLastPacketAt(Date.now());
      setIsStale(false);
    };

    socket.on('packet', handlePacket);
    socket.on('packets_batch', handlePacket);

    return () => {
      socket.off('packet', handlePacket);
      socket.off('packets_batch', handlePacket);
    };
  }, [socket]);

  useEffect(() => {
    if (!connection.connected) {
      setIsStale(false); // Disconnected state is handled separately
      return;
    }

    const threshold = parseInt(import.meta.env.VITE_STALE_DATA_THRESHOLD_MS || '5000', 10);
    
    const interval = setInterval(() => {
      if (lastPacketAt && Date.now() - lastPacketAt > threshold) {
        setIsStale(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lastPacketAt, connection.connected]);

  return { isStale, lastPacketAt };
}
