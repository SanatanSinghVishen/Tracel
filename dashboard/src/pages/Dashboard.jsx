import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Shield, ShieldAlert, Terminal, Wifi, Zap } from 'lucide-react';
import { useSocket } from '../hooks/useSocket.js';
import TrafficGlobe from '../components/TrafficGlobe.jsx';
import ChatAssistant from '../components/ChatAssistant.jsx';
import { readDefaultTrafficView, writeDefaultTrafficView } from '../utils/prefs.js';
import { buildAuthHeaders, getOrCreateAnonId } from '../lib/authClient.js';

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function Dashboard() {
  const { isLoaded, getToken } = useAuth();
  const { socket, connection } = useSocket();
  const anonId = useMemo(() => getOrCreateAnonId(), []);
  const [trafficView, setTrafficView] = useState(() => readDefaultTrafficView());
  const [trafficData, setTrafficData] = useState([]);
  const [stats, setStats] = useState({ packets: 0, threats: 0, uptime: 0 });
  const [currentPacket, setCurrentPacket] = useState(null);
  const [logs, setLogs] = useState([]);
  const [attackSimEnabled, setAttackSimEnabled] = useState(false);
  const [uptimeStartMs, setUptimeStartMs] = useState(0);

  // Load recent history so UI doesn't reset on refresh/navigation.
  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    async function loadRecent() {
      try {
        const base = connection.serverUrl || 'http://localhost:3000';
        const u = new URL('/api/packets', base);
        u.searchParams.set('limit', '200');
        // Ensure refresh always pulls the latest snapshot (avoid disk cache).
        u.searchParams.set('_', String(Date.now()));

        const intelUrl = new URL('/api/threat-intel', base);
        intelUrl.searchParams.set('sinceHours', '24');
        intelUrl.searchParams.set('limit', '10000');

        async function fetchIntelWithRetry(url, options) {
          const attempts = 3;
          for (let i = 0; i < attempts; i += 1) {
            const res = await fetch(url, options);
            if (res.status !== 503 || i === attempts - 1) return res;
            await new Promise((r) => setTimeout(r, 400 * (i + 1)));
          }
          return fetch(url, options);
        }

        const headers = await buildAuthHeaders(isLoaded ? getToken : null, anonId);
        const [res, intelRes] = await Promise.all([
          fetch(u.toString(), { headers, credentials: 'include', cache: 'no-store' }),
          fetchIntelWithRetry(intelUrl.toString(), { headers, credentials: 'include', cache: 'no-store' }),
        ]);

        const data = await res.json().catch(() => ({}));
        const intelData = await intelRes.json().catch(() => ({}));
        if (!res.ok) return;

        const packets = Array.isArray(data.packets) ? data.packets : [];
        // API returns newest-first; charts want oldest-first.
        const chronological = packets.slice().reverse();
        const last60 = chronological.slice(-60);

        if (cancelled) return;

        setTrafficData(last60);
        setCurrentPacket(packets[0] || null);

        const sessionPackets = typeof data?.session?.packets === 'number' ? data.session.packets : null;
        const intelThreats24h = typeof intelData?.totalThreats === 'number' ? intelData.totalThreats : null;

        const sessionStartedAt = typeof data?.session?.startedAt === 'string' ? data.session.startedAt : null;
        if (sessionStartedAt) {
          const parsed = Date.parse(sessionStartedAt);
          if (Number.isFinite(parsed) && parsed > 0) setUptimeStartMs(parsed);
        }

        const threatsFromPackets = packets.reduce((acc, p) => acc + (p?.is_anomaly ? 1 : 0), 0);
        setStats((s) => ({
          ...s,
          packets: sessionPackets ?? packets.length,
          // Match Forensics: Threat Intel total for last 24h.
          threats: intelThreats24h ?? threatsFromPackets,
        }));

        setLogs(() => {
          const lines = [];
          for (const p of packets.slice(0, 10)) {
            const ts = new Date(p.timestamp || Date.now()).toLocaleTimeString();
            lines.push(`[${ts}] ${p.method} ${p.source_ip} → ${p.destination_ip} | ${p.bytes}B`);
          }
          return lines;
        });
      } catch {
        // ignore
      }
    }

    loadRecent();
    return () => {
      cancelled = true;
    };
  }, [connection.serverUrl, isLoaded, getToken, anonId]);

  useEffect(() => {
    writeDefaultTrafficView(trafficView);
  }, [trafficView]);

  // Uptime should reset when the server restarts.
  // We derive uptime from the server session start timestamp.
  useEffect(() => {
    if (!uptimeStartMs) return undefined;

    const tick = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - uptimeStartMs) / 1000));
      setStats((s) => (s.uptime === seconds ? s : { ...s, uptime: seconds }));
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [uptimeStartMs]);

  useEffect(() => {
    function onPacket(data) {
      setCurrentPacket(data);

      if (typeof data?.session_started_at === 'string') {
        const parsed = Date.parse(data.session_started_at);
        if (Number.isFinite(parsed) && parsed > 0) {
          setUptimeStartMs((prev) => (prev !== parsed ? parsed : prev));
        }
      }

      setStats((prev) => {
        const nextPackets = typeof data?.session_total_packets === 'number' ? data.session_total_packets : prev.packets + 1;
        // Keep the threat KPI aligned to 24h intel. On live packets, increment on anomalies.
        const nextThreats = data.is_anomaly ? prev.threats + 1 : prev.threats;

        return {
          ...prev,
          packets: nextPackets,
          threats: nextThreats,
        };
      });
      setTrafficData((prev) => [...prev, data].slice(-60));
      setLogs((prev) => {
        const ts = new Date(data.timestamp || Date.now()).toLocaleTimeString();
        const line = `[${ts}] ${data.method} ${data.source_ip} → ${data.destination_ip} | ${data.bytes}B`;
        return [line, ...prev].slice(0, 10);
      });
    }

    socket.on('packet', onPacket);

    return () => {
      socket.off('packet', onPacket);
    };
  }, [socket]);

  const toggleAttack = (active) => socket.emit('toggle_attack', active);

  const status = useMemo(() => {
    if (!currentPacket) return { label: 'WAITING', tone: 'neutral' };
    if (currentPacket.is_anomaly) return { label: 'CRITICAL', tone: 'danger' };
    return { label: 'SECURE', tone: 'safe' };
  }, [currentPacket]);

  const attackActive = !!currentPacket?.is_anomaly;

  return (
    <div className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden scroll-hidden flex flex-col gap-4 animate-fade-in">
      <ChatAssistant
        connection={connection}
        stats={stats}
        currentPacket={currentPacket}
        trafficView={trafficView}
      />
      {/* Header */}
      <div className="glass-card glow-hover p-5 sm:p-6 shrink-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                Monitor
                <span className="ml-3 text-slate-400 font-normal">/ Tracel</span>
              </h1>

              <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-200">
                <span className={connection.connected ? 'pulse-dot' : 'pulse-dot pulse-dot--off'} />
                <span className={connection.connected ? 'text-slate-200' : 'text-red-200'}>
                  {connection.connected ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>

            <div className="sm:hidden mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-200">
              <span className={connection.connected ? 'pulse-dot' : 'pulse-dot pulse-dot--off'} />
              <span className="text-slate-400">Connection</span>
              <span className={connection.connected ? 'text-slate-200' : 'text-red-200'}>
                {connection.connected ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="hidden sm:block text-right">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Uptime</p>
              <p className="data-mono text-xl text-white">{formatUptime(stats.uptime)}</p>
            </div>

            <div className="w-full sm:w-auto">
              <div className="flex items-center justify-between sm:justify-start gap-3">
                <div
                  className="relative w-full sm:w-[320px] rounded-2xl border border-white/10 bg-white/5 p-1"
                  role="group"
                  aria-label="Attack simulation toggle"
                >
                  <div
                    className={
                      `absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl border border-white/10 ` +
                      `transition-transform duration-200 ease-out ` +
                      (attackSimEnabled
                        ? 'translate-x-full bg-gradient-to-r from-red-500/25 to-red-400/15'
                        : 'translate-x-0 bg-gradient-to-r from-tracel-accent-blue/25 to-tracel-accent-purple/25')
                    }
                    aria-hidden="true"
                  />

                  <div className="relative grid grid-cols-2">
                    <button
                      type="button"
                      aria-pressed={!attackSimEnabled}
                      onClick={() => {
                        if (!attackSimEnabled) return;
                        setAttackSimEnabled(false);
                        toggleAttack(false);
                      }}
                      className={
                        `flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold ` +
                        `transition-all outline-none focus-visible:ring-2 focus-visible:ring-tracel-accent-blue/40 ` +
                        (!attackSimEnabled ? 'text-white' : 'text-slate-300 hover:text-white')
                      }
                      title="Defense mode"
                    >
                      <Shield size={14} className={!attackSimEnabled ? 'text-white' : 'text-slate-200'} />
                      Defense
                    </button>

                    <button
                      type="button"
                      aria-pressed={attackSimEnabled}
                      onClick={() => {
                        if (attackSimEnabled) return;
                        setAttackSimEnabled(true);
                        toggleAttack(true);
                      }}
                      className={
                        `flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold ` +
                        `transition-all outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ` +
                        (attackSimEnabled ? 'text-white' : 'text-slate-300 hover:text-white')
                      }
                      title="Simulate attack"
                    >
                      <Zap size={14} className={attackSimEnabled ? 'text-white' : 'text-slate-200'} />
                      Attack
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <div className="glass-card glow-hover p-5 hover-lift">
          <p className="text-slate-400 text-xs uppercase tracking-wider">Total Packets</p>
          <p className="mt-2 text-3xl font-semibold text-white data-mono tabular-nums whitespace-nowrap leading-none">
            {stats.packets.toLocaleString()}
          </p>
          <p className="mt-2 text-xs text-slate-400">Streaming from {connection.serverUrl}</p>
        </div>

        <div className="glass-card glow-hover p-5 hover-lift">
          <p className="text-slate-400 text-xs uppercase tracking-wider">Threats (24 Hours)</p>
          <p className="mt-2 text-3xl font-semibold text-white data-mono tabular-nums whitespace-nowrap leading-none">
            {stats.threats.toLocaleString()}
          </p>
        </div>

        <div className="glass-card glow-hover p-5 hover-lift">
          <p className="text-slate-400 text-xs uppercase tracking-wider">Security Status</p>
          <p
            className={`mt-2 text-3xl font-semibold data-mono ${
              status.tone === 'danger'
                ? 'critical-shimmer'
                : status.tone === 'safe'
                ? 'text-white'
                : 'text-slate-300'
            }`}
          >
            {status.label}
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
            <ShieldAlert size={14} className="text-slate-200" />
            <span>{currentPacket ? 'Live verdict applied' : 'Waiting for packets'}</span>
          </div>
        </div>

        <div className="glass-card glow-hover p-5 hover-lift">
          <p className="text-slate-400 text-xs uppercase tracking-wider">Last Packet</p>
          <p className="mt-2 text-sm text-slate-200">
            <span className="text-slate-400">Source:</span> {currentPacket?.source_ip || '—'}
          </p>
          <p className="mt-1 text-sm text-slate-200">
            <span className="text-slate-400">Bytes:</span> {typeof currentPacket?.bytes === 'number' ? `${currentPacket.bytes} B` : '—'}
          </p>
          <p className="mt-1 text-sm text-slate-200">
            <span className="text-slate-400">Method:</span> {currentPacket?.method || '—'}
          </p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-[560px] min-w-0">
        {/* Traffic */}
        <div className="glass-card glow-hover lg:col-span-2 p-5 sm:p-6 flex flex-col min-h-0 h-full animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Wifi size={16} className="text-slate-200" /> {trafficView === 'globe' ? 'Global Traffic' : 'Live Bandwidth'}
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setTrafficView('bandwidth')}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                    trafficView === 'bandwidth' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Bandwidth
                </button>
                <button
                  type="button"
                  onClick={() => setTrafficView('globe')}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                    trafficView === 'globe' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Globe
                </button>
              </div>
              <span className="text-xs px-2.5 py-1 bg-gradient-to-r from-tracel-accent-blue/20 to-tracel-accent-purple/20 text-slate-200 rounded-xl border border-white/10">
                <span
                  className={
                    attackActive
                      ? 'critical-shimmer'
                      : undefined
                  }
                >
                  LIVE
                </span>
              </span>
            </div>
          </div>

          <div className="flex-1 min-h-0 min-w-0">
            {trafficView === 'globe' ? (
              <div className="h-full">
                <TrafficGlobe />
              </div>
            ) : trafficData.length === 0 ? (
              <div className="h-full flex flex-col justify-center gap-3">
                <div className="h-6 w-40 skeleton" />
                <div className="h-40 w-full skeleton" />
                <div className="h-3 w-3/4 skeleton" />
              </div>
            ) : (
              <div className="h-56 sm:h-64 lg:h-72 min-h-[224px] min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={224}>
                  <AreaChart data={trafficData}>
                    <defs>
                      <linearGradient id="bytesFillSafe" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.26} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="bytesFillDanger" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis hide />
                    <YAxis
                      stroke="rgba(148,163,184,0.45)"
                      fontSize={12}
                      width={56}
                      tickFormatter={(val) => `${val} B`}
                      domain={[0, 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(2, 6, 23, 0.9)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        color: '#fff',
                        borderRadius: 14,
                        backdropFilter: 'blur(12px)',
                      }}
                      itemStyle={{ color: '#e2e8f0' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="bytes"
                      stroke={attackActive ? '#ef4444' : '#3b82f6'}
                      strokeWidth={2}
                      fill={attackActive ? 'url(#bytesFillDanger)' : 'url(#bytesFillSafe)'}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 min-h-0 h-full">
          {/* Logs */}
          <div className="glass-card glow-hover p-5 sm:p-6 flex flex-col min-h-0 flex-[2] animate-fade-up">
            <h2 className="text-slate-400 mb-3 flex items-center gap-2 uppercase tracking-wider text-[10px]">
              <Terminal size={12} /> Live System Logs
            </h2>
            <div className="flex-1 min-h-0 overflow-y-auto scroll-hidden space-y-2 pr-2">
              {logs.length === 0 ? (
                <div className="space-y-2">
                  <div className="h-4 w-3/4 skeleton" />
                  <div className="h-4 w-2/3 skeleton" />
                  <div className="h-4 w-5/6 skeleton" />
                  <div className="h-4 w-1/2 skeleton" />
                </div>
              ) : (
                logs.map((line, i) => (
                  <div
                    key={`${line}-${i}`}
                    className="border-b border-white/10 pb-2 last:border-0 text-slate-200 hover:text-white transition"
                  >
                    <span className="mr-2 text-slate-400">•</span>
                    <span className="data-mono text-[12px]">{line}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}