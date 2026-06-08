import React from 'react';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { useDataFreshness } from '../hooks/useDataFreshness';

export default function ConnectionStatusBanner() {
  const { connected, isReconnecting, countdown, reconnectAttempt } = useConnectionStatus();
  const { isStale, lastPacketAt } = useDataFreshness();

  if (connected && !isStale) {
    return null; // Don't show if connected and fresh
  }

  if (connected && isStale) {
    const secondsAgo = lastPacketAt ? Math.floor((Date.now() - lastPacketAt) / 1000) : 0;
    return (
      <div style={{
        backgroundColor: '#fff3cd',
        color: '#856404',
        padding: '10px',
        textAlign: 'center',
        borderBottom: '1px solid #ffeeba',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        fontFamily: 'Inter, sans-serif'
      }}>
        <strong>Stream Paused</strong>
        <span style={{ marginLeft: '10px' }}>
          {lastPacketAt ? `No data received for ${secondsAgo}s` : 'Waiting for initial data...'}
        </span>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: '#f8d7da',
      color: '#721c24',
      padding: '10px',
      textAlign: 'center',
      borderBottom: '1px solid #f5c6cb',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      fontFamily: 'Inter, sans-serif'
    }}>
      <strong>Connection Lost!</strong>
      {isReconnecting && (
        <span style={{ marginLeft: '10px' }}>
          Attempt {reconnectAttempt}... Retrying in {countdown}s
        </span>
      )}
    </div>
  );
}
