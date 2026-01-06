import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Cpu, Shield, ShieldAlert, Terminal, Wifi, Zap } from 'lucide-react';
import { useSocket } from '../hooks/useSocket.js';
import TrafficGlobe from '../components/TrafficGlobe.jsx';
import ChatAssistant from '../components/ChatAssistant.jsx';
import { readDefaultTrafficView, writeDefaultTrafficView } from '../utils/prefs.js';
import { buildAuthHeaders, getOrCreateAnonId } from '../lib/authClient.js';
import { cyberFacts } from '../utils/cyberFacts.js';

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
  const [isMobile, setIsMobile] = useState(false);
  const [trafficData, setTrafficData] = useState([]);
  const [stats, setStats] = useState({ packets: 0, threats: 0, uptime: 0 });
  const [currentPacket, setCurrentPacket] = useState(null);
  const [logs, setLogs] = useState([]);
  const [attackSimEnabled, setAttackSimEnabled] = useState(false);
  const [uptimeStartMs, setUptimeStartMs] = useState(0);

  const countsRefreshTimerRef = useRef(null);
  const lastCountsRefreshMsRef = useRef(0);

  // --- System Bootup Overlay (Render AI cold-start handling) ---
  const [bootVisible, setBootVisible] = useState(true);
  const [bootFading, setBootFading] = useState(false);

  const [bootFactIndex, setBootFactIndex] = useState(0);

  useEffect(() => {
    if (!bootVisible || bootFading) return undefined;

    const id = window.setInterval(() => {
      setBootFactIndex((i) => (i + 1) % cyberFacts.length);
    }, 4200);

    return () => window.clearInterval(id);
  }, [bootVisible, bootFading]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;
    let fadeTimer = null;

    async function pollSystemStatus() {
      try {
        const base = connection.serverUrl || 'http://localhost:3000';
        const url = new URL('/api/status', base);
        url.searchParams.set('_', String(Date.now()));

        // Public endpoint: avoid Authorization headers to prevent CORS preflight spam.
        const res = await fetch(url.toString(), { credentials: 'include', cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        const ready = !!data?.ai_ready;
        if (ready) {
          if (!bootFading) setBootFading(true);
          if (intervalId) window.clearInterval(intervalId);
          fadeTimer = window.setTimeout(() => {
            if (!cancelled) setBootVisible(false);
          }, 600);
        } else {
          setBootVisible(true);
          setBootFading(false);
        }
      } catch {
        if (cancelled) return;
        setBootVisible(true);
        setBootFading(false);
      }
    }

    pollSystemStatus();
    intervalId = window.setInterval(pollSystemStatus, 2000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      if (fadeTimer) window.clearTimeout(fadeTimer);
    };
  }, [connection.serverUrl, isLoaded, getToken, anonId, bootFading]);
  // Intentionally does NOT depend on auth/token to avoid preflight requests.

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

        const threatsCountUrl = new URL('/api/threats/count', base);
        threatsCountUrl.searchParams.set('sinceHours', '24');

        const packetsCountUrl = new URL('/api/packets/count', base);
        // Total Packets KPI is all-time total.

        async function fetchWithRetry(url, options) {
          const attempts = 3;
          for (let i = 0; i < attempts; i += 1) {
            const res = await fetch(url, options);
            if (res.status !== 503 || i === attempts - 1) return res;
            await new Promise((r) => setTimeout(r, 400 * (i + 1)));
          }
          return fetch(url, options);
        }

        const headers = await buildAuthHeaders(isLoaded ? getToken : null, anonId);
        const [res, threatsRes, packetsRes] = await Promise.all([
          fetch(u.toString(), { headers, credentials: 'include', cache: 'no-store' }),
          fetchWithRetry(threatsCountUrl.toString(), { headers, credentials: 'include', cache: 'no-store' }),
          fetchWithRetry(packetsCountUrl.toString(), { headers, credentials: 'include', cache: 'no-store' }),
        ]);

        const data = await res.json().catch(() => ({}));
        const threatsData = await threatsRes.json().catch(() => ({}));
        const packetsCountData = await packetsRes.json().catch(() => ({}));
        if (!res.ok) return;

        const packets = Array.isArray(data.packets) ? data.packets : [];
        // API returns newest-first; charts want oldest-first.
        const chronological = packets.slice().reverse();
        const last60 = chronological.slice(-60);

        if (cancelled) return;

        setTrafficData(last60);
        setCurrentPacket(packets[0] || null);

        const mongoPacketsTotal = typeof packetsCountData?.totalPackets === 'number' ? packetsCountData.totalPackets : null;
        const mongoThreats24h = typeof threatsData?.totalThreats === 'number' ? threatsData.totalThreats : null;

        const sessionStartedAt = typeof data?.session?.startedAt === 'string' ? data.session.startedAt : null;
        if (sessionStartedAt) {
          const parsed = Date.parse(sessionStartedAt);
          if (Number.isFinite(parsed) && parsed > 0) setUptimeStartMs(parsed);
        }

        const threatsFromPackets = packets.reduce((acc, p) => acc + (p?.is_anomaly ? 1 : 0), 0);
        setStats((s) => ({
          ...s,
          packets: mongoPacketsTotal ?? packets.length,
          // Threats KPI should be Mongo-backed for correctness.
          threats: mongoThreats24h ?? threatsFromPackets,
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

  // Cleanup any pending counts refresh timer.
  useEffect(() => {
    return () => {
      if (countsRefreshTimerRef.current) window.clearTimeout(countsRefreshTimerRef.current);
      countsRefreshTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    writeDefaultTrafficView(trafficView);
  }, [trafficView]);

  // Mobile = < md breakpoint (Tailwind md starts at 768px)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const media = window.matchMedia('(max-width: 767.98px)');
    const apply = () => setIsMobile(!!media.matches);
    apply();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }

    // Safari fallback
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  // Never mount the 3D globe on mobile.
  useEffect(() => {
    if (!isMobile) return;
    if (trafficView === 'globe') setTrafficView('feed');
  }, [isMobile, trafficView]);

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
        // Packets + threats counts come from Mongo. Do not increment locally.
        const nextPackets = prev.packets;
        const nextThreats = prev.threats;

        return {
          ...prev,
          packets: nextPackets,
          threats: nextThreats,
        };
      });

      // Refresh counts from Mongo (debounced). This keeps KPIs correct without relying on
      // in-memory increments and prevents drift across refreshes.
      const now = Date.now();
      if (now - lastCountsRefreshMsRef.current >= 2000 && !countsRefreshTimerRef.current) {
        countsRefreshTimerRef.current = window.setTimeout(async () => {
          countsRefreshTimerRef.current = null;
          lastCountsRefreshMsRef.current = Date.now();

          try {
            const base = connection.serverUrl || 'http://localhost:3000';
            const threatsUrl = new URL('/api/threats/count', base);
            threatsUrl.searchParams.set('sinceHours', '24');
            threatsUrl.searchParams.set('_', String(Date.now()));

            const packetsUrl = new URL('/api/packets/count', base);
            packetsUrl.searchParams.set('_', String(Date.now()));

            const headers = await buildAuthHeaders(isLoaded ? getToken : null, anonId);

            const [threatsRes, packetsRes] = await Promise.all([
              fetch(threatsUrl.toString(), { headers, credentials: 'include', cache: 'no-store' }),
              fetch(packetsUrl.toString(), { headers, credentials: 'include', cache: 'no-store' }),
            ]);

            const threatsBody = await threatsRes.json().catch(() => ({}));
            const packetsBody = await packetsRes.json().catch(() => ({}));

            setStats((s) => ({
              ...s,
              packets: typeof packetsBody?.totalPackets === 'number' ? packetsBody.totalPackets : s.packets,
              threats: typeof threatsBody?.totalThreats === 'number' ? threatsBody.totalThreats : s.threats,
            }));
          } catch {
            // ignore
          }
        }, 650);
      }
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
    <div className="min-w-0 flex flex-col gap-3 min-h-full md:h-full md:min-h-0 animate-fade-in">
      {bootVisible ? (
        <div
          className={
            `fixed inset-0 z-[80] grid place-items-center bg-zinc-950/85 backdrop-blur-sm ` +
            `transition-opacity duration-500 ` +
            (bootFading ? 'opacity-0 pointer-events-none' : 'opacity-100')
          }
        >
          <div className="w-[min(92vw,560px)] glass-card glow-hover p-6 sm:p-8 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-zinc-800 bg-zinc-950/60">
              <Cpu className="h-7 w-7 text-slate-200" />
            </div>

            <div className="text-white text-xl sm:text-2xl font-semibold">Initializing AI Engine…</div>
            <div className="mt-1 text-xs text-slate-400 uppercase tracking-wider">
              Waking up models + scoring pipeline
            </div>

            <div className="mt-5 h-2 w-full overflow-hidden rounded-full border border-zinc-800 bg-zinc-950/60">
              <div className="tracel-bootbar h-full w-[45%] rounded-full bg-gradient-to-r from-tracel-accent-blue/70 to-tracel-accent-purple/70" />
            </div>

            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-left">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Fact</div>
                <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/60 px-2.5 py-1 text-[11px] text-slate-200">
                  <span className="pulse-dot" />
                  <span>Booting</span>
                </div>
              </div>
              <div key={bootFactIndex} className="mt-2 text-sm text-slate-200 leading-relaxed animate-fade-in">
                {cyberFacts[bootFactIndex % cyberFacts.length]}
              </div>
            </div>

            <style>{`
              .tracel-bootbar{ animation: tracelBootSweep 1.35s ease-in-out infinite; }
              @keyframes tracelBootSweep{
                0% { transform: translateX(-55%); opacity: 0.65; }
                50% { opacity: 1; }
                100% { transform: translateX(145%); opacity: 0.65; }
              }
            `}</style>
          </div>
        </div>
      ) : null}
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

              <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1 text-[11px] text-slate-200">
                <span className={connection.connected ? 'pulse-dot' : 'pulse-dot pulse-dot--off'} />
                <span className={connection.connected ? 'text-slate-200' : 'text-red-200'}>
                  {connection.connected ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>

            <div className="sm:hidden mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1 text-[11px] text-slate-200">
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
              {/* Mobile: stacked, larger touch targets */}
              <div className="sm:hidden grid grid-cols-1 gap-2" role="group" aria-label="Attack simulation toggle">
                <button
                  type="button"
                  aria-pressed={!attackSimEnabled}
                  onClick={() => {
                    if (!attackSimEnabled) return;
                    setAttackSimEnabled(false);
                    toggleAttack(false);
                  }}
                  className={
                    `h-12 w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 ` +
                    `bg-zinc-950/60 text-sm font-semibold transition-all ` +
                    `outline-none focus-visible:ring-2 focus-visible:ring-tracel-accent-blue/40 ` +
                    (!attackSimEnabled ? 'text-white' : 'text-slate-300 hover:text-white')
                  }
                >
                  <Shield size={16} className={!attackSimEnabled ? 'text-white' : 'text-slate-200'} />
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
                    `h-12 w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 ` +
                    `bg-zinc-950/60 text-sm font-semibold transition-all ` +
                    `outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 ` +
                    (attackSimEnabled ? 'text-white' : 'text-slate-300 hover:text-white')
                  }
                >
                  <Zap size={16} className={attackSimEnabled ? 'text-white' : 'text-slate-200'} />
                  Attack
                </button>
              </div>

              {/* Desktop/tablet: compact segmented control */}
              <div className="hidden sm:flex items-center justify-between sm:justify-start gap-3">
                <div
                  className="relative w-full sm:w-[320px] rounded-lg border border-zinc-800 bg-zinc-900 p-1"
                  role="group"
                  aria-label="Attack simulation toggle"
                >
                  <div
                    className={
                      `absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-md border border-zinc-800 ` +
                      `transition-transform duration-200 ease-out ` +
                      (attackSimEnabled
                        ? 'translate-x-full bg-red-500/15'
                        : 'translate-x-0 bg-zinc-950/70')
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
                        `flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-semibold ` +
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
                        `flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-semibold ` +
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <div className="glass-card glow-hover p-5 hover-lift">
          <p className="text-slate-400 text-xs uppercase tracking-wider">Total Packets</p>
          <p className="mt-2 text-2xl sm:text-3xl font-semibold text-white data-mono tabular-nums whitespace-nowrap leading-none">
            {stats.packets.toLocaleString()}
          </p>
        </div>

        <div className="glass-card glow-hover p-5 hover-lift">
          <p className="text-slate-400 text-xs uppercase tracking-wider">Threats (24 Hours)</p>
          <p className="mt-2 text-2xl sm:text-3xl font-semibold text-white data-mono tabular-nums whitespace-nowrap leading-none">
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
          <div className="mt-2 text-sm text-slate-200 space-y-1 min-w-0">
            <div className="min-w-0">
              <span className="text-slate-400">Source:</span>{' '}
              <span className="break-all">{currentPacket?.source_ip || '—'}</span>
            </div>
            <div className="min-w-0">
              <span className="text-slate-400">Bytes:</span>{' '}
              <span className="break-all">
                {typeof currentPacket?.bytes === 'number' ? `${currentPacket.bytes} B` : '—'}
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-slate-400">Method:</span>{' '}
              <span className="break-all">{currentPacket?.method || '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 min-w-0 items-stretch md:flex-1 md:min-h-0">
        {/* Traffic */}
        <div className="glass-card glow-hover md:col-span-2 lg:col-span-3 p-5 sm:p-6 flex flex-col animate-fade-up">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Wifi size={16} className="text-slate-200" />{' '}
              {trafficView === 'globe' ? 'Global Traffic' : trafficView === 'feed' ? 'Live Event Feed' : 'Live Bandwidth'}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setTrafficView('bandwidth')}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                    trafficView === 'bandwidth' ? 'bg-zinc-950/70 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Bandwidth
                </button>
                {isMobile ? (
                  <button
                    type="button"
                    onClick={() => setTrafficView('feed')}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                      trafficView === 'feed' ? 'bg-zinc-950/70 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Feed
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTrafficView('globe')}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                      trafficView === 'globe' ? 'bg-zinc-950/70 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Globe
                  </button>
                )}
              </div>
              <span className="text-xs px-2.5 py-1 bg-zinc-900 text-slate-200 rounded-lg border border-zinc-800">
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

          <div className="min-w-0 min-h-[260px] sm:min-h-[320px] md:flex-1 md:min-h-0">
            {trafficView === 'globe' ? (
              <div className="h-full overflow-hidden rounded-lg">
                <TrafficGlobe />
              </div>
            ) : trafficView === 'feed' ? (
              <div className="h-full overflow-y-auto scroll-hidden rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
                {trafficData.length === 0 ? (
                  <div className="space-y-3">
                    <div className="h-4 w-2/3 skeleton" />
                    <div className="h-4 w-5/6 skeleton" />
                    <div className="h-4 w-3/4 skeleton" />
                    <div className="h-4 w-1/2 skeleton" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {trafficData
                      .slice()
                      .reverse()
                      .slice(0, 14)
                      .map((p, i) => {
                        const ts = new Date(p?.timestamp || Date.now()).toLocaleTimeString();
                        const critical = !!p?.is_anomaly;
                        const src = p?.source_ip || '—';
                        const dst = p?.destination_ip || '—';
                        const method = p?.method || '—';
                        const bytes = typeof p?.bytes === 'number' ? `${p.bytes}B` : '—';
                        return (
                          <div
                            key={`${p?.timestamp || 't'}-${p?.source_ip || 's'}-${i}`}
                            className={
                              'rounded-lg border px-3 py-2 ' +
                              (critical
                                ? 'border-red-500/25 bg-red-500/10'
                                : 'border-white/10 bg-zinc-950/40')
                            }
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[11px] text-slate-400 data-mono">[{ts}]</div>
                              <div className={
                                'text-[10px] uppercase tracking-wider ' +
                                (critical ? 'text-red-200' : 'text-slate-400')
                              }>
                                {critical ? 'Threat' : 'OK'}
                              </div>
                            </div>
                            <div className="mt-1 text-sm text-slate-200">
                              <span className="data-mono">{method}</span>{' '}
                              <span className="text-slate-400">·</span>{' '}
                              <span className="data-mono break-all">{src}</span>{' '}
                              <span className="text-slate-400">→</span>{' '}
                              <span className="data-mono break-all">{dst}</span>{' '}
                              <span className="text-slate-400">·</span>{' '}
                              <span className="data-mono">{bytes}</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            ) : trafficData.length === 0 ? (
              <div className="h-full flex flex-col justify-center gap-3">
                <div className="h-6 w-40 skeleton" />
                <div className="h-40 w-full skeleton" />
                <div className="h-3 w-3/4 skeleton" />
              </div>
            ) : (
              <div className="h-full min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart data={trafficData}>
                    <defs>
                      <linearGradient id="bytesFillSafe" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.26} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="bytesFillDanger" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis hide />
                    <YAxis
                      stroke="rgba(161,161,170,0.45)"
                      fontSize={12}
                      width={56}
                      tickFormatter={(val) => `${val} B`}
                      domain={[0, 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(9, 9, 11, 0.9)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        color: '#fff',
                        borderRadius: 14,
                        backdropFilter: 'blur(12px)',
                      }}
                      itemStyle={{ color: '#e2e8f0' }}
                      labelStyle={{ color: '#a1a1aa' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="bytes"
                      stroke={attackActive ? '#ef4444' : '#10b981'}
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

        <div className="flex flex-col gap-4 md:col-span-2 lg:col-span-1 md:min-h-0 md:h-full">
          {/* Logs */}
          <div className="glass-card glow-hover p-5 sm:p-6 flex flex-col animate-fade-up">
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