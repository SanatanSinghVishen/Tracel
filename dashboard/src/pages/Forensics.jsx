import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Database, Download, Globe2, RefreshCw, Search, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useSocket } from '../hooks/useSocket.js';
import { buildAuthHeaders, getOrCreateAnonId } from '../lib/authClient.js';

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function Forensics() {
  const { isLoaded, getToken } = useAuth();
  const { socket, connection } = useSocket();
  const anonId = useMemo(() => getOrCreateAnonId(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [packets, setPackets] = useState([]);
  // Separate, unfiltered score history used only for the AI chart.
  // This keeps the chart stable even when the incident filters change.
  const [scorePackets, setScorePackets] = useState([]);
  const [selected, setSelected] = useState(null);

  const [scoreWindowSize, setScoreWindowSize] = useState(35);

  const scoreSeries = useMemo(() => {
    const rows = Array.isArray(scorePackets) ? scorePackets : [];
    const slice = rows.slice(0, Math.max(10, Math.min(Number(scoreWindowSize) || 35, 200))).slice().reverse();
    return slice.map((p, i) => {
      const ts = new Date(p?.timestamp || Date.now());
      const t = Number.isNaN(ts.getTime()) ? Date.now() : ts.getTime();
      const label = Number.isNaN(ts.getTime()) ? String(i + 1) : ts.toLocaleTimeString();
      const score = typeof p?.anomaly_score === 'number' ? p.anomaly_score : null;
      const threshold = typeof p?.anomaly_threshold === 'number' ? p.anomaly_threshold : null;
      const mean = typeof p?.anomaly_mean === 'number' ? p.anomaly_mean : null;
      const warmedUp = typeof p?.anomaly_warmed_up === 'boolean' ? p.anomaly_warmed_up : null;
      const baselineN = typeof p?.anomaly_baseline_n === 'number' ? p.anomaly_baseline_n : null;
      const ai_scored = typeof p?.ai_scored === 'boolean' ? p.ai_scored : (typeof score === 'number');
      return {
        key: p?._id || `${p?.timestamp || 't'}-${i}`,
        i,
        t,
        label,
        score,
        threshold,
        mean,
        warmedUp,
        baselineN,
        ai_scored,
        is_anomaly: !!p?.is_anomaly,
      };
    });
  }, [scorePackets, scoreWindowSize]);

  const anomalyPoints = useMemo(() => scoreSeries.filter((p) => p.is_anomaly && typeof p.score === 'number'), [scoreSeries]);
  const safePoints = useMemo(
    () => scoreSeries.filter((p) => p.ai_scored && !p.is_anomaly && typeof p.score === 'number'),
    [scoreSeries]
  );

  const latestScoreMeta = useMemo(() => {
    const p = Array.isArray(scorePackets) ? scorePackets[0] : null;
    const baselineN = typeof p?.anomaly_baseline_n === 'number' ? p.anomaly_baseline_n : null;
    const warmedUp = typeof p?.anomaly_warmed_up === 'boolean' ? p.anomaly_warmed_up : null;
    const mean = typeof p?.anomaly_mean === 'number' ? p.anomaly_mean : null;
    const threshold = typeof p?.anomaly_threshold === 'number' ? p.anomaly_threshold : null;
    return { baselineN, warmedUp, mean, threshold };
  }, [scorePackets]);

  const scoreWindowMeta = useMemo(() => {
    const total = scoreSeries.length;
    const threats = scoreSeries.reduce((acc, p) => acc + (p?.is_anomaly ? 1 : 0), 0);
    return { total, threats };
  }, [scoreSeries]);

  const scoreYDomain = useMemo(() => {
    const vals = [];
    for (const p of scoreSeries) {
      if (typeof p?.score === 'number') vals.push(p.score);
      if (typeof p?.threshold === 'number') vals.push(p.threshold);
      if (typeof p?.mean === 'number') vals.push(p.mean);
    }
    if (!vals.length) return [0, 1];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = Math.max(1e-6, max - min);
    const pad = Math.max(0.02, span * 0.15);
    return [min - pad, max + pad];
  }, [scoreSeries]);

  const renderScoreTooltip = useCallback(({ active, payload }) => {
    if (!active || !Array.isArray(payload) || payload.length === 0) return null;
    const p = payload[0]?.payload;
    if (!p) return null;

    const status = p.ai_scored === false
      ? 'UNSCORED'
      : (p.is_anomaly ? 'THREAT' : 'SAFE');

    return (
      <div
        className="rounded-2xl border border-white/10 px-3 py-2"
        style={{
          backgroundColor: 'rgba(2, 6, 23, 0.9)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="text-xs text-slate-300">{p.label}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-slate-400">Status</span>
          <span className={`text-xs font-semibold ${
            status === 'THREAT' ? 'text-red-300' : (status === 'UNSCORED' ? 'text-slate-200' : 'text-emerald-300')
          }`}>
            {status}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="text-slate-400">AI score</div>
          <div className="text-slate-200 data-mono text-right">{typeof p.score === 'number' ? p.score.toFixed(4) : '—'}</div>

          <div className="text-slate-400">Threshold</div>
          <div className="text-slate-200 data-mono text-right">{typeof p.threshold === 'number' ? p.threshold.toFixed(4) : '—'}</div>

          <div className="text-slate-400">Baseline mean</div>
          <div className="text-slate-200 data-mono text-right">{typeof p.mean === 'number' ? p.mean.toFixed(4) : '—'}</div>

          <div className="text-slate-400">Baseline N</div>
          <div className="text-slate-200 data-mono text-right">{typeof p.baselineN === 'number' ? p.baselineN : '—'}</div>

          <div className="text-slate-400">Warmup</div>
          <div className="text-slate-200 text-right">{p.warmedUp == null ? '—' : (p.warmedUp ? 'ready' : 'learning')}</div>
        </div>

        <div className="mt-2 text-[11px] text-slate-400">
          Interpretation: if score &lt; threshold → THREAT. (Lower score = more suspicious.)
        </div>
      </div>
    );
  }, []);

  const hasAnyNumericScores = useMemo(
    () => scoreSeries.some((p) => typeof p.score === 'number'),
    [scoreSeries]
  );

  const [showIncidentLog, setShowIncidentLog] = useState(false);

  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [timeline, setTimeline] = useState([]);

  // Threat Intelligence report (anomaly aggregates)
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState('');
  const [intelLoaded, setIntelLoaded] = useState(false);
  const [intelExpanded, setIntelExpanded] = useState(false);
  const [intelGeneratedAt, setIntelGeneratedAt] = useState(null);
  const [intelConfidenceMeta, setIntelConfidenceMeta] = useState({ definition: null, thresholds: null });
  const [intelReport, setIntelReport] = useState({
    total: 0,
    topIps: [],
    pie: [
      { name: 'Volumetric', value: 0 },
      { name: 'Protocol', value: 0 },
      { name: 'Application', value: 0 },
    ],
    topCountries: [],
    confidence: [
      { bucket: 'Obvious', count: 0 },
      { bucket: 'Subtle', count: 0 },
      { bucket: 'Other', count: 0 },
    ],
  });

  // Minimal, non-invasive query controls
  const [ip, setIp] = useState('');
  const [anomalyOnly, setAnomalyOnly] = useState(false);

  // AI chart dot visibility
  const [scoreDotMode, setScoreDotMode] = useState('both'); // 'both' | 'threats'
  const [scoreSettingsOpen, setScoreSettingsOpen] = useState(false);
  const scoreSettingsRef = useRef(null);

  useEffect(() => {
    if (!scoreSettingsOpen) return;

    function onMouseDown(e) {
      const el = scoreSettingsRef.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      setScoreSettingsOpen(false);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') setScoreSettingsOpen(false);
    }

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [scoreSettingsOpen]);

  const StatChip = useCallback(({ label, value, help }) => {
    return (
      <div className="relative group">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-200">
          <span className="text-slate-400">{label}</span>
          <span className="data-mono text-slate-100">{value}</span>
        </div>

        {help ? (
          <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-xs text-slate-200 shadow-xl backdrop-blur-xl whitespace-normal break-words group-hover:block">
            <div className="text-[11px] font-semibold text-slate-100">{label}</div>
            <div className="mt-1 text-[11px] text-slate-300 leading-snug">{help}</div>
          </div>
        ) : null}
      </div>
    );
  }, []);

  const packetMatchesIncidentFilters = useCallback(
    (p) => {
      if (!p) return false;
      if (anomalyOnly && !p.is_anomaly) return false;
      const q = ip.trim();
      if (q && p.source_ip !== q) return false;
      return true;
    },
    [anomalyOnly, ip]
  );

  const apiUrl = useMemo(() => {
    const base = connection.serverUrl || 'http://localhost:3000';
    const u = new URL('/api/packets', base);
    u.searchParams.set('limit', '200');
    // Avoid cached history on refresh.
    u.searchParams.set('_', String(Date.now()));
    if (anomalyOnly) u.searchParams.set('anomaly', '1');
    if (ip.trim()) u.searchParams.set('ip', ip.trim());
    return u.toString();
  }, [connection.serverUrl, anomalyOnly, ip]);

  const baseUrl = useMemo(() => (connection.serverUrl || 'http://localhost:3000'), [connection.serverUrl]);

  const scoreApiUrl = useMemo(() => {
    const u = new URL('/api/packets', baseUrl);
    u.searchParams.set('limit', '200');
    // Avoid cached history on refresh.
    u.searchParams.set('_', String(Date.now()));
    return u.toString();
  }, [baseUrl]);

  const intelUrl = useMemo(() => {
    const u = new URL('/api/threat-intel', baseUrl);
    u.searchParams.set('sinceHours', '24');
    u.searchParams.set('limit', '10000');
    return u.toString();
  }, [baseUrl]);

  const loadThreatIntel = useCallback(async () => {
    if (!isLoaded) return;

    setIntelLoading(true);
    setIntelError('');

    try {
      const headers = await buildAuthHeaders(isLoaded ? getToken : null, anonId);
      const res = await fetch(intelUrl, { headers, credentials: 'include', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) {
        setIntelLoaded(false);
        setIntelReport((prev) => ({ ...prev, total: 0, topIps: [], topCountries: [] }));
        setIntelError(data?.error || `Request failed (${res.status})`);
        return;
      }

      const total = typeof data.totalThreats === 'number' ? data.totalThreats : 0;
      const topIps = Array.isArray(data.topHostileIps)
        ? data.topHostileIps.slice(0, 5).map((r) => ({
            ip: r.ip,
            count: r.count,
            lastSeenRaw: r.lastSeen || null,
            lastSeenLabel: r.lastSeen ? fmtTime(r.lastSeen) : '—',
          }))
        : [];

      const pie = Array.isArray(data.attackVectorDistribution) ? data.attackVectorDistribution : [];
      const topCountries = Array.isArray(data.geoTopCountries) ? data.geoTopCountries : [];
      const confidence = Array.isArray(data.aiConfidenceDistribution) ? data.aiConfidenceDistribution : [];

      setIntelConfidenceMeta({
        definition: data?.aiConfidenceDefinition ?? null,
        thresholds: data?.aiConfidenceThresholds ?? null,
      });

      setIntelReport({
        total,
        topIps,
        pie: [
          { name: 'Volumetric', value: pie.find((p) => p?.name === 'Volumetric')?.value || 0 },
          { name: 'Protocol', value: pie.find((p) => p?.name === 'Protocol')?.value || 0 },
          { name: 'Application', value: pie.find((p) => p?.name === 'Application')?.value || 0 },
        ],
        topCountries: topCountries.slice(0, 5).map((c) => ({
          name: c.name,
          count: c.count,
          pct: c.pct,
        })),
        confidence: [
          { bucket: 'Obvious', count: confidence.find((b) => b?.bucket === 'Obvious')?.count || 0 },
          { bucket: 'Subtle', count: confidence.find((b) => b?.bucket === 'Subtle')?.count || 0 },
          { bucket: 'Other', count: confidence.find((b) => b?.bucket === 'Other')?.count || 0 },
        ],
      });
      setIntelLoaded(true);
      setIntelGeneratedAt(new Date());
    } catch (e) {
      setIntelLoaded(false);
      setIntelError(String(e));
    } finally {
      setIntelLoading(false);
    }
  }, [intelUrl, isLoaded, getToken, anonId]);

  // Auto-generate once when the Forensics page loads so the collapsed preview isn't empty.
  useEffect(() => {
    if (!isLoaded) return;
    if (intelLoaded || intelLoading) return;
    loadThreatIntel();
  }, [isLoaded, intelLoaded, intelLoading, loadThreatIntel]);

  const intelLastAttackLabel = useMemo(() => {
    if (!intelLoaded || intelLoading) return '—';
    const rows = Array.isArray(intelReport.topIps) ? intelReport.topIps : [];
    let newest = null;
    for (const r of rows) {
      const raw = r?.lastSeenRaw;
      if (!raw) continue;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) continue;
      if (!newest || d > newest) newest = d;
    }
    if (!newest) return '—';
    return fmtTime(newest);
  }, [intelLoaded, intelLoading, intelReport.topIps]);

  const intelTopOriginLabel = useMemo(() => {
    if (!intelLoaded || intelLoading || intelReport.total <= 0) return '—';
    const c = intelReport.topCountries?.[0];
    if (!c) return '—';
    return `${c.pct ?? 0}% ${c.name ?? '—'}`;
  }, [intelLoaded, intelLoading, intelReport.total, intelReport.topCountries]);

  const intelVectorTotal = useMemo(() => {
    const pie = Array.isArray(intelReport.pie) ? intelReport.pie : [];
    return pie.reduce((acc, p) => acc + (typeof p?.value === 'number' ? p.value : 0), 0);
  }, [intelReport.pie]);

  const load = useCallback(async () => {
    if (!isLoaded) return;

    setLoading(true);
    setError('');
    try {
      const headers = await buildAuthHeaders(isLoaded ? getToken : null, anonId);
      const res = await fetch(apiUrl, { headers, credentials: 'include', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPackets([]);
        setError(data?.error || `Request failed (${res.status})`);
        return;
      }

      setPackets(Array.isArray(data.packets) ? data.packets : []);
    } catch (e) {
      setPackets([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, isLoaded, getToken, anonId]);

  // Load unfiltered history for the AI score chart.
  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    async function loadScoreHistory() {
      try {
        const headers = await buildAuthHeaders(isLoaded ? getToken : null, anonId);
        const res = await fetch(scoreApiUrl, { headers, credentials: 'include', cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (cancelled) return;
        const list = Array.isArray(data.packets) ? data.packets : [];
        setScorePackets(list);
      } catch {
        // ignore
      }
    }

    loadScoreHistory();
    return () => {
      cancelled = true;
    };
  }, [scoreApiUrl, isLoaded, getToken, anonId]);

  const loadTimeline = useCallback(async () => {
    if (!isLoaded) return;

    setTimelineLoading(true);
    setTimelineError('');

    try {
      // Align to local hour boundaries for accurate “when” visualization.
      const end = new Date();
      end.setMinutes(0, 0, 0);
      const start = new Date(end.getTime() - 23 * 60 * 60 * 1000);
      const since = start.toISOString();

      const u = new URL('/api/packets', baseUrl);
      u.searchParams.set('limit', '1000');
      u.searchParams.set('anomaly', '1');
      u.searchParams.set('since', since);

      const headers = await buildAuthHeaders(isLoaded ? getToken : null, anonId);
      const res = await fetch(u.toString(), { headers, credentials: 'include', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setTimeline([]);
        setTimelineError(data?.error || `Request failed (${res.status})`);
        return;
      }

      const packets24 = Array.isArray(data.packets) ? data.packets : [];

      // 24 buckets, hour by hour (start..end inclusive hours)
      const buckets = Array.from({ length: 24 }, (_, i) => {
        const d = new Date(start.getTime() + i * 60 * 60 * 1000);
        return {
          key: d.toISOString(),
          label: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          attacks: 0,
        };
      });

      for (const p of packets24) {
        const t = new Date(p.timestamp);
        if (Number.isNaN(t.getTime())) continue;
        const idx = Math.floor((t.getTime() - start.getTime()) / (60 * 60 * 1000));
        if (idx >= 0 && idx < 24) buckets[idx].attacks += 1;
      }

      setTimeline(buckets);
    } catch (e) {
      setTimeline([]);
      setTimelineError(String(e));
    } finally {
      setTimelineLoading(false);
    }
  }, [baseUrl, isLoaded, getToken, anonId]);

  // Live refresh: update the current bucket whenever an attack arrives.
  useEffect(() => {
    function onPacket(p) {
      if (!p || !p.is_anomaly) return;

      setTimeline((prev) => {
        if (!prev || prev.length !== 24) return prev;
        const start = new Date(prev[0].key);
        if (Number.isNaN(start.getTime())) return prev;

        const t = new Date(p.timestamp || Date.now());
        const idx = Math.floor((t.getTime() - start.getTime()) / (60 * 60 * 1000));
        if (idx < 0 || idx >= 24) {
          // Timeline window has shifted (e.g., hour rolled over) — reload.
          loadTimeline();
          return prev;
        }

        const next = prev.slice();
        next[idx] = { ...next[idx], attacks: (next[idx].attacks || 0) + 1 };
        return next;
      });
    }

    socket.on('packet', onPacket);
    return () => socket.off('packet', onPacket);
  }, [socket, loadTimeline]);

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    const filename = `tracel-forensics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    downloadFile(filename, JSON.stringify(packets, null, 2), 'application/json');
  }

  function toCsv(rows) {
    const cols = ['timestamp', 'source_ip', 'destination_ip', 'method', 'bytes', 'is_anomaly', 'anomaly_score'];
    const escape = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = cols.join(',');
    const lines = rows.map((r) => cols.map((c) => escape(r[c])).join(','));
    return [header, ...lines].join('\n');
  }

  function exportCsv() {
    const filename = `tracel-forensics-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    downloadFile(filename, toCsv(packets), 'text/csv');
  }

  useEffect(() => {
    if (!showIncidentLog) return;
    load();
  }, [load, showIncidentLog]);

  // Hydrate initial history so the page isn't stale after refresh.
  useEffect(() => {
    if (!isLoaded) return;
    load();
  }, [load, isLoaded]);

  // Real-time incident log: keep newest-first and de-duplicate by id when possible.
  useEffect(() => {
    function onPacket(p) {
      if (!packetMatchesIncidentFilters(p)) return;

      setPackets((prev) => {
        const id = p?._id || null;
        const next = id ? prev.filter((x) => x?._id !== id) : prev;
        return [p, ...next].slice(0, 200);
      });
    }

    socket.on('packet', onPacket);
    return () => socket.off('packet', onPacket);
  }, [socket, packetMatchesIncidentFilters]);

  // Real-time score chart: always collect latest packets (unfiltered).
  useEffect(() => {
    function onScorePacket(p) {
      setScorePackets((prev) => {
        const id = p?._id || null;
        const next = id ? prev.filter((x) => x?._id !== id) : prev;
        // Keep newest-first (same convention as API) and cap memory.
        return [p, ...next].slice(0, 300);
      });
    }

    socket.on('packet', onScorePacket);
    return () => socket.off('packet', onScorePacket);
  }, [socket]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  // Note: Threat intel is generated on-demand when user opens the report.

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setSelected(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden space-y-6 animate-fade-in">
      <div className="glass-card glow-hover p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-300 mb-1">
              <Database size={16} className="text-slate-200" />
              <span className="text-xs font-semibold tracking-[0.22em] uppercase text-slate-400">Forensics</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              Forensics <span className="text-slate-400 font-normal">/ Tracel</span>
            </h1>
            <p className="mt-2 text-sm text-slate-300">Query and review stored packet history</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">

            <div className="flex items-center gap-2 glass rounded-2xl border border-white/10 px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="Search source IP (optional)"
                className="bg-transparent text-sm outline-none text-slate-200 placeholder:text-slate-500 w-56 max-w-full"
              />
            </div>

            <label className="glass rounded-2xl border border-white/10 px-3 py-2 flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={anomalyOnly}
                onChange={(e) => setAnomalyOnly(e.target.checked)}
                className="accent-tracel-accent-blue"
              />
              Anomalies only
            </label>

            <button
              onClick={load}
              className="glass rounded-2xl border border-white/10 px-4 py-2 flex items-center justify-center gap-2 text-sm text-white hover:bg-white/10 transition"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>

            <button
              onClick={exportCsv}
              className="glass rounded-2xl border border-white/10 px-4 py-2 flex items-center justify-center gap-2 text-sm text-white hover:bg-white/10 transition disabled:opacity-60"
              disabled={packets.length === 0}
            >
              <Download size={14} /> CSV
            </button>

            <button
              onClick={exportJson}
              className="glass rounded-2xl border border-white/10 px-4 py-2 flex items-center justify-center gap-2 text-sm text-white hover:bg-white/10 transition disabled:opacity-60"
              disabled={packets.length === 0}
            >
              <Download size={14} /> JSON
            </button>
          </div>
        </div>
      </div>

      {/* Incident timeline */}
      <div className="glass-card glow-hover p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider">Incident Timeline</p>
            <h2 className="text-sm font-semibold text-slate-200">Attacks in the last 24 hours</h2>
          </div>
          <button
            onClick={loadTimeline}
            className="glass rounded-2xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10 transition"
            disabled={timelineLoading}
          >
            <RefreshCw size={14} className={timelineLoading ? 'animate-spin inline-block' : 'inline-block'} />
            <span className="ml-2">Refresh</span>
          </button>
        </div>

        {timelineError ? (
          <div className="mb-4 p-4 glass rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300">
            {timelineError}
          </div>
        ) : null}

        <div className="h-56 min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={224}>
            <BarChart data={timeline}>
              <XAxis dataKey="label" stroke="#444" fontSize={12} interval={2} />
              <YAxis stroke="#444" fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(2, 6, 23, 0.9)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#fff',
                  borderRadius: 14,
                  backdropFilter: 'blur(12px)',
                }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Bar dataKey="attacks" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AI score threshold */}
      <div className="glass-card glow-hover p-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider">AI Threshold</p>
            <h2 className="text-sm font-semibold text-slate-200">AI score vs. dynamic threshold (live)</h2>
          </div>
          <div className="flex items-center justify-end gap-2 flex-nowrap whitespace-nowrap overflow-visible">
            <div className="flex items-center gap-2 flex-nowrap">
              <StatChip
                label="Baseline"
                value={latestScoreMeta.baselineN ?? '—'}
                help="How many recent SAFE packets the server has learned from to estimate normal behavior (mean/std). Larger baseline = more stable threshold."
              />
              <StatChip
                label="Warmup"
                value={latestScoreMeta.warmedUp == null ? '—' : (latestScoreMeta.warmedUp ? 'ready' : 'learning')}
                help="When warmup is ready, the server uses the rolling baseline threshold. If still learning, it may fall back to the AI model’s calibrated threshold."
              />
              <StatChip
                label="Threshold"
                value={typeof latestScoreMeta.threshold === 'number' ? latestScoreMeta.threshold.toFixed(4) : '—'}
                help="Decision rule: if AI score < threshold → THREAT. The threshold is dynamic (mean − k·std) and updates as baseline learns."
              />
              <StatChip
                label="Window"
                value={`${scoreWindowMeta.total}/${Math.max(10, Math.min(Number(scoreWindowSize) || 35, 200))}`}
                help="How many packets are currently displayed in this chart (sliding window). Old points drop out as new packets arrive."
              />
              <StatChip
                label="Threats"
                value={scoreWindowMeta.threats}
                help="How many packets in the current window were flagged by server thresholding. Red dots show these packets."
              />
            </div>

            <div className="mx-1 h-5 w-px bg-white/10 shrink-0" />

            <div ref={scoreSettingsRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setScoreSettingsOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={scoreSettingsOpen ? 'true' : 'false'}
                className={
                  'inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-[11px] transition-colors ' +
                  (scoreSettingsOpen ? 'text-slate-100' : 'text-slate-200 hover:text-slate-100')
                }
              >
                <span className="text-slate-400">Settings</span>
                <span className="text-slate-300">▾</span>
              </button>

              {scoreSettingsOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-white/10 bg-slate-950/90 p-3 shadow-xl backdrop-blur-xl"
                >
                  <div className="text-[11px] font-semibold text-slate-100">Dots</div>
                  <div className="mt-2 inline-flex w-full items-center rounded-2xl border border-white/10 bg-white/5 p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setScoreDotMode('threats');
                        setScoreSettingsOpen(false);
                      }}
                      className={
                        'flex-1 px-3 py-1 rounded-xl transition-colors ' +
                        (scoreDotMode === 'threats'
                          ? 'bg-white/10 text-slate-100'
                          : 'text-slate-300 hover:text-slate-100')
                      }
                    >
                      Threats only
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setScoreDotMode('both');
                        setScoreSettingsOpen(false);
                      }}
                      className={
                        'flex-1 px-3 py-1 rounded-xl transition-colors ' +
                        (scoreDotMode === 'both'
                          ? 'bg-white/10 text-slate-100'
                          : 'text-slate-300 hover:text-slate-100')
                      }
                    >
                      Threats + Safe
                    </button>
                  </div>

                  <div className="mt-3 text-[11px] font-semibold text-slate-100">Window size</div>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {[20, 30, 35, 50].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          setScoreWindowSize(n);
                          setScoreSettingsOpen(false);
                        }}
                        className={
                          'rounded-xl border border-white/10 px-2 py-2 text-[11px] transition-colors ' +
                          (Number(scoreWindowSize) === n
                            ? 'bg-white/10 text-slate-100'
                            : 'bg-white/5 text-slate-300 hover:text-slate-100')
                        }
                      >
                        {n}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 text-[11px] text-slate-400">
                    Window controls how many recent packets are shown.
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="h-56 min-w-0">
          {!hasAnyNumericScores ? (
            <div className="h-full rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center px-4">
              <div className="text-center">
                <div className="text-sm text-slate-200 font-semibold">No AI scores yet</div>
                <div className="mt-1 text-xs text-slate-400">
                  This chart appears empty when the AI engine is offline or hasn’t produced scores.
                  Start the Python AI at <span className="data-mono text-slate-200">http://127.0.0.1:5000</span> and wait a few seconds.
                </div>
              </div>
            </div>
          ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={224}>
            <ComposedChart
              data={scoreSeries}
              margin={{ top: 8, right: 12, bottom: 0, left: 12 }}
            >
              <defs>
                <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                stroke="#444"
                fontSize={12}
                interval="preserveStartEnd"
                minTickGap={28}
                padding={{ left: 12, right: 12 }}
                tickFormatter={(v) => {
                  const n = Number(v);
                  if (!Number.isFinite(n)) return '';
                  const d = new Date(n);
                  if (Number.isNaN(d.getTime())) return '';
                  return d.toLocaleTimeString();
                }}
              />
              <YAxis
                stroke="#444"
                fontSize={12}
                domain={scoreYDomain}
                padding={{ top: 10, bottom: 10 }}
                tickFormatter={(v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '')}
              />
              <Tooltip
                cursor={{ stroke: 'rgba(255,255,255,0.15)' }}
                content={renderScoreTooltip}
              />

              <Legend
                wrapperStyle={{ color: '#e2e8f0' }}
                formatter={(value) => {
                  if (value === 'score') return 'AI score (lower = suspicious)';
                  if (value === 'threshold') return 'Dynamic threshold';
                  if (value === 'mean') return 'Baseline mean';
                  if (value === 'anomalies') return 'Flagged threats';
                  if (value === 'safe') return 'Safe packets';
                  return value;
                }}
              />

              {typeof latestScoreMeta.threshold === 'number' ? (
                <ReferenceArea
                  y1={scoreYDomain[0]}
                  y2={latestScoreMeta.threshold}
                  fill="rgba(239, 68, 68, 0.08)"
                  strokeOpacity={0}
                  ifOverflow="extendDomain"
                />
              ) : null}

              <Line
                type="monotone"
                dataKey="threshold"
                name="threshold"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="10 6"
                dot={false}
                connectNulls={false}
                isAnimationActive
                animationDuration={250}
              />

              <Line
                type="monotone"
                dataKey="mean"
                name="mean"
                stroke="rgba(59, 130, 246, 0.55)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                dot={false}
                connectNulls={false}
                isAnimationActive
                animationDuration={250}
              />

              <Area
                type="monotone"
                dataKey="score"
                name="score"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#scoreFill)"
                dot={false}
                connectNulls={false}
                isAnimationActive
                animationDuration={250}
              />

              <Scatter
                data={anomalyPoints}
                name="anomalies"
                dataKey="score"
                fill="#ef4444"
                isAnimationActive
                animationDuration={250}
              />

              {scoreDotMode === 'both' ? (
                <Scatter
                  data={safePoints}
                  name="safe"
                  dataKey="score"
                  fill="#22c55e"
                  fillOpacity={0.55}
                  isAnimationActive
                  animationDuration={250}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Threat Intelligence Report */}
      <div className="glass-card glow-hover p-5 sm:p-6">
        <details
          className="group"
          onToggle={(e) => {
            const open = !!e.currentTarget?.open;
            setIntelExpanded(open);
            // When user opens the report, generate it once.
            if (open && !intelLoaded && !intelLoading) {
              loadThreatIntel();
            }
          }}
        >
          <summary className="list-none cursor-pointer select-none">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Threat Intelligence</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5">
                    <Sparkles size={14} className="text-slate-200" />
                    <h2 className="text-sm font-semibold text-slate-200">Snapshot</h2>
                    <span className="text-xs text-slate-400">(last 24h)</span>
                  </div>
                  <span className={intelLoading ? 'pulse-dot' : 'hidden'} />
                </div>

                <p className="mt-2 text-sm text-slate-300">
                  A quick, calm overview. Open the report for charts and full details.
                </p>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="glass rounded-2xl border border-white/10 p-3 kpi-tile">
                    <div className="text-xs text-slate-400">Threats (24h)</div>
                    <div className="mt-1 text-lg font-semibold text-white data-mono">
                      {intelLoading ? '…' : (intelLoaded ? intelReport.total : '…')}
                    </div>
                  </div>

                  <div className="glass rounded-2xl border border-white/10 p-3 kpi-tile">
                    <div className="text-xs text-slate-400">Last attack seen</div>
                    <div className="mt-1 text-sm font-semibold text-white">
                      {intelLoading ? '…' : intelLastAttackLabel}
                    </div>
                  </div>

                  <div className="glass rounded-2xl border border-white/10 p-3 kpi-tile">
                    <div className="text-xs text-slate-400">Top origin</div>
                    <div className="mt-1 text-sm font-semibold text-white truncate">
                      {intelLoading ? '…' : intelTopOriginLabel}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-slate-500">
                  Updated: {intelGeneratedAt ? <span className="data-mono">{fmtTime(intelGeneratedAt)}</span> : (intelLoading ? 'Generating…' : '—')}
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  loadThreatIntel();
                }}
                className="shrink-0 glass rounded-2xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10 transition disabled:opacity-60"
                disabled={intelLoading}
                title="Refresh threat intel"
              >
                <RefreshCw size={14} className={intelLoading ? 'animate-spin inline-block' : 'inline-block'} />
                <span className="ml-2">Generate</span>
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
              <span className="inline-block">▸</span>
              <span className="group-open:hidden">Open report</span>
              <span className="hidden group-open:inline">Close report</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500">Auto-generated on load</span>
            </div>
          </summary>

          {intelExpanded && intelError ? (
            <div className="mt-4 p-4 glass rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300">
              {intelError}
            </div>
          ) : null}

          {intelExpanded ? (
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Hostile IPs */}
            <div className="lg:col-span-7 glass rounded-2xl border border-white/10 p-4 hover:bg-white/10 transition hover-lift">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wider">Hot IPs</div>
                  <div className="mt-0.5 text-sm font-semibold text-white">Top 5 hostile sources</div>
                  <div className="mt-1 text-sm text-slate-300">Ranked by threat occurrences (24h).</div>
                </div>
                <div className="text-xs text-slate-400">
                  {intelLoading ? 'Generating…' : (intelLoaded ? 'Updated' : 'Not generated')}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {intelLoading ? (
                  <>
                    <div className="h-9 rounded-xl bg-white/5 border border-white/10 skeleton" />
                    <div className="h-9 rounded-xl bg-white/5 border border-white/10 skeleton" />
                    <div className="h-9 rounded-xl bg-white/5 border border-white/10 skeleton" />
                  </>
                ) : !intelLoaded ? (
                  <div className="text-sm text-slate-400">Click “Generate” to load the report.</div>
                ) : intelReport.total === 0 ? (
                  <div className="text-sm text-slate-400">No threats found in the last 24 hours.</div>
                ) : (
                  intelReport.topIps.map((r, idx) => {
                    const max = Math.max(1, intelReport.topIps?.[0]?.count ?? 1);
                    const pct = Math.round((100 * (r.count || 0)) / max);
                    return (
                      <div key={r.ip} className="glass rounded-xl border border-white/10 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400">#{idx + 1}</span>
                              <span className="data-mono text-sm text-slate-100 truncate">{r.ip}</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded bg-white/10 overflow-hidden">
                              <div
                                className="h-1.5 bg-gradient-to-r from-tracel-accent-blue/80 to-tracel-accent-purple/80"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex items-end gap-3">
                            <div className="text-right">
                              <div className="text-xs text-slate-400">Threats</div>
                              <div className="text-sm font-semibold text-white data-mono">{r.count}</div>
                            </div>
                            <div className="hidden sm:block text-right">
                              <div className="text-xs text-slate-400">Last seen</div>
                              <div className="text-sm text-slate-200 data-mono whitespace-nowrap">{r.lastSeenLabel}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Attack split */}
            <div className="lg:col-span-5 glass rounded-2xl border border-white/10 p-4 hover:bg-white/10 transition hover-lift">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">Vectors</div>
                <div className="mt-0.5 text-sm font-semibold text-white">Attack type split</div>
                <div className="mt-1 text-sm text-slate-300">Distribution across vectors (one-line definitions below).</div>
              </div>

              <div className="mt-4 h-56 min-w-0">
                {intelLoading ? (
                  <div className="h-full rounded-2xl bg-white/5 border border-white/10 skeleton" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={224}>
                    <PieChart>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(2, 6, 23, 0.9)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: '#fff',
                          borderRadius: 14,
                          backdropFilter: 'blur(12px)',
                        }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                      <Legend />
                      <Pie data={intelReport.pie} dataKey="value" nameKey="name" outerRadius={80}>
                        <Cell fill="#3b82f6" />
                        <Cell fill="#8b5cf6" />
                        <Cell fill="#f87171" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="mt-2 text-xs text-slate-400">
                Total labeled: <span className="data-mono text-slate-200">{intelLoaded ? intelVectorTotal : '—'}</span>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-300">
                <div className="glass rounded-xl border border-white/10 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
                    <span className="font-semibold text-slate-200">Volumetric</span>
                  </div>
                  <div className="mt-1 text-slate-300">So much traffic hits at once that it clogs the internet pipe.</div>
                </div>

                <div className="glass rounded-xl border border-white/10 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#8b5cf6' }} />
                    <span className="font-semibold text-slate-200">Protocol</span>
                  </div>
                  <div className="mt-1 text-slate-300">It tricks the basic “rules of the road” of networking to slow things down.</div>
                </div>

                <div className="glass rounded-xl border border-white/10 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#f87171' }} />
                    <span className="font-semibold text-slate-200">Application</span>
                  </div>
                  <div className="mt-1 text-slate-300">It targets the website/app itself by repeatedly hitting pages or actions.</div>
                </div>
              </div>
            </div>

            {/* Origins */}
            <div className="lg:col-span-7 glass rounded-2xl border border-white/10 p-4 hover:bg-white/10 transition hover-lift">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">Origins</div>
                <div className="mt-0.5 text-sm font-semibold text-white">Where attacks come from</div>
                <div className="mt-1 text-sm text-slate-300">Country-level breakdown.</div>
              </div>

              <div className="mt-4 space-y-2">
                {intelLoading ? (
                  <>
                    <div className="h-9 rounded-xl bg-white/5 border border-white/10 skeleton" />
                    <div className="h-9 rounded-xl bg-white/5 border border-white/10 skeleton" />
                    <div className="h-9 rounded-xl bg-white/5 border border-white/10 skeleton" />
                  </>
                ) : !intelLoaded ? (
                  <div className="text-sm text-slate-400">Click “Generate” to load the report.</div>
                ) : intelReport.total === 0 ? (
                  <div className="text-sm text-slate-400">No data available yet.</div>
                ) : (
                  intelReport.topCountries.slice(0, 5).map((c) => (
                    <div key={c.name} className="flex items-center gap-3">
                      <div className="w-40 text-sm text-slate-200 truncate">{c.name}</div>
                      <div className="flex-1 h-2 rounded bg-white/10 overflow-hidden">
                        <div
                          className="h-2 bg-gradient-to-r from-tracel-accent-blue/80 to-tracel-accent-purple/80"
                          style={{ width: `${c.pct}%` }}
                        />
                      </div>
                      <div className="w-14 text-right text-sm text-slate-400 tabular-nums">{c.pct}%</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* AI Confidence */}
            <div className="lg:col-span-5 glass rounded-2xl border border-white/10 p-4 hover:bg-white/10 transition hover-lift">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">AI confidence</div>
                <div className="mt-0.5 text-sm font-semibold text-white">How obvious were these?</div>
                <div className="mt-1 text-sm text-slate-300">Lower scores tend to be more suspicious.</div>
              </div>

              <div className="mt-4 h-56 min-w-0">
                {intelLoading ? (
                  <div className="h-full rounded-2xl bg-white/5 border border-white/10 skeleton" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={224}>
                    <BarChart data={intelReport.confidence}>
                      <XAxis dataKey="bucket" stroke="#444" fontSize={12} />
                      <YAxis stroke="#444" fontSize={12} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(2, 6, 23, 0.9)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: '#fff',
                          borderRadius: 14,
                          backdropFilter: 'blur(12px)',
                        }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                      <Bar dataKey="count" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <p className="mt-2 text-xs text-slate-400">
                Buckets are relative: Obvious = most suspicious ~20%, Subtle = next ~40%, Other = the rest.
              </p>

              {intelLoaded && !intelLoading && (intelConfidenceMeta?.thresholds?.obviousLe == null || intelConfidenceMeta?.thresholds?.subtleLe == null) ? (
                <p className="mt-2 text-xs text-slate-500">
                  Note: scores are almost identical right now, so everything lands in one bucket.
                </p>
              ) : null}

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-300">
                <div className="glass rounded-xl border border-white/10 px-3 py-2">
                  <div className="font-semibold text-slate-200">Obvious</div>
                  <div className="mt-1 text-slate-300">Looks clearly suspicious — very likely an attack.</div>
                </div>
                <div className="glass rounded-xl border border-white/10 px-3 py-2">
                  <div className="font-semibold text-slate-200">Subtle</div>
                  <div className="mt-1 text-slate-300">Looks a bit suspicious — could be an early or sneaky attempt.</div>
                </div>
                <div className="glass rounded-xl border border-white/10 px-3 py-2">
                  <div className="font-semibold text-slate-200">Other</div>
                  <div className="mt-1 text-slate-300">Doesn’t fit neatly — could be noise or unclear activity.</div>
                </div>
              </div>
            </div>
          </div>
          ) : null}
        </details>
      </div>

      <div className="glass-card glow-hover p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider">Searchable Incident Log</p>
            <p className="text-sm text-slate-300">Open the table only when you need it.</p>
          </div>

          <button
            onClick={() => setShowIncidentLog((v) => !v)}
            className="glass rounded-2xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10 transition"
          >
            {showIncidentLog ? 'Hide Incident Log' : 'View Incident Log'}
          </button>
        </div>

        {showIncidentLog ? (
          <div className="mt-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-sm text-slate-300 flex items-center gap-2 flex-wrap">
                <span className={connection.connected ? 'pulse-dot' : 'pulse-dot pulse-dot--off'} />
                <span>{connection.connected ? 'Socket connected' : 'Socket disconnected'}</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400">API:</span> <span className="data-mono text-slate-200">{connection.serverUrl}</span>
              </div>
              <div className="text-sm text-slate-400">
                {loading ? 'Loading…' : `${packets.length} records`}
              </div>
            </div>

            {error ? (
              <div className="mt-4 p-4 glass rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300">
                {error}
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-400">
                  <tr className="border-b border-white/10">
                    <th className="text-left font-medium py-3 pr-4">Time</th>
                    <th className="text-left font-medium py-3 pr-4">Source</th>
                    <th className="text-left font-medium py-3 pr-4">Destination</th>
                    <th className="text-left font-medium py-3 pr-4">Method</th>
                    <th className="text-left font-medium py-3 pr-4">Bytes</th>
                    <th className="text-left font-medium py-3 pr-4">Verdict</th>
                    <th className="text-left font-medium py-3 pr-0">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {packets.length === 0 && !loading ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-slate-400">
                        No records found.
                      </td>
                    </tr>
                  ) : (
                    packets.map((p) => (
                      <tr
                        key={p._id}
                        className="border-b border-white/5 hover:bg-white/5 transition cursor-pointer"
                        onClick={() => setSelected(p)}
                      >
                        <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">{fmtTime(p.timestamp)}</td>
                        <td className="py-3 pr-4 text-slate-200 data-mono">{p.source_ip}</td>
                        <td className="py-3 pr-4 text-slate-200 data-mono">{p.destination_ip}</td>
                        <td className="py-3 pr-4 text-slate-200">{p.method}</td>
                        <td className="py-3 pr-4 text-slate-200">{typeof p.bytes === 'number' ? `${p.bytes} B` : '—'}</td>
                        <td className="py-3 pr-4">
                          {p?.ai_scored === false ? (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold border border-white/10 bg-white/5 text-slate-200">
                              UNSCORED
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold border ${
                                p.is_anomaly
                                  ? 'text-red-300 border-red-500/20 bg-red-500/10'
                                  : 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10'
                              }`}
                            >
                              {p.is_anomaly ? 'THREAT' : 'SAFE'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-0 text-slate-200 data-mono">{typeof p.anomaly_score === 'number' ? p.anomaly_score.toFixed(3) : '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {/* Deep inspection modal */}
      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="glass-card glow-hover w-full max-w-3xl max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">Deep Inspection</p>
                <p className="text-sm text-slate-200 data-mono">
                  {selected.source_ip} → {selected.destination_ip}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-2 hover:bg-white/5 rounded transition"
                aria-label="Close"
              >
                <X size={16} className="text-gray-300" />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto max-h-[75vh]">
              <div className="flex flex-wrap gap-2">
                {selected?.ai_scored === false ? (
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold border border-white/10 bg-white/5 text-slate-200">
                    UNSCORED
                  </span>
                ) : (
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold border ${
                    selected.is_anomaly
                      ? 'text-red-300 border-red-500/20 bg-red-500/10'
                      : 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10'
                  }`}>
                    {selected.is_anomaly ? 'THREAT' : 'SAFE'}
                  </span>
                )}
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold border border-white/10 bg-gradient-to-r from-tracel-accent-blue/20 to-tracel-accent-purple/20 text-slate-100">
                  AI score: {typeof selected.anomaly_score === 'number' ? selected.anomaly_score : '—'}
                </span>
              </div>

              <pre className="text-xs text-slate-200 glass border border-white/10 rounded-2xl p-3 overflow-auto">
{JSON.stringify(selected, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}