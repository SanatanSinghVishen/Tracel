import React from 'react';
import { useDataFreshness } from '../hooks/useDataFreshness';

export default function FreshnessGuard({ children }) {
  const { isStale, lastPacketAt } = useDataFreshness();

  if (!isStale) {
    return <>{children}</>;
  }

  const secondsAgo = lastPacketAt ? Math.floor((Date.now() - lastPacketAt) / 1000) : 0;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.4)',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'grayscale(0.5) blur(1px)'
      }}>
        <div style={{
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '4px',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 600,
          fontSize: '14px'
        }}>
          Stream Paused {lastPacketAt ? `(Last updated ${secondsAgo}s ago)` : ''}
        </div>
      </div>
      <div style={{ opacity: 0.5 }}>
        {children}
      </div>
    </div>
  );
}
