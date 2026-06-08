import React from 'react';
import { useDataFreshness } from '../hooks/useDataFreshness';

export default function FreshnessGuard({ children }) {
  const { isStale, lastPacketAt } = useDataFreshness();

  if (!isStale) {
    return <>{children}</>;
  }

  const secondsAgo = lastPacketAt ? Math.floor((Date.now() - lastPacketAt) / 1000) : 0;

  return (
    <>
      {children}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '20px',
        fontFamily: 'Inter, sans-serif',
        fontWeight: 500,
        fontSize: '12px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        backdropFilter: 'blur(4px)'
      }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ffc107' }} />
        Stream Paused {lastPacketAt ? `(${secondsAgo}s ago)` : ''}
      </div>
    </>
  );
}
