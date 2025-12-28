import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
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
  const [selected, setSelected] = useState(null);

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
    <div className="h-full min-h-0 overflow-y-auto space-y-6 animate-fade-in">
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

        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
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

              <div className="mt-4 h-56">
                {intelLoading ? (
                  <div className="h-full rounded-2xl bg-white/5 border border-white/10 skeleton" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
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

              <div className="mt-4 h-56">
                {intelLoading ? (
                  <div className="h-full rounded-2xl bg-white/5 border border-white/10 skeleton" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
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
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold border ${
                              p.is_anomaly
                                ? 'text-red-300 border-red-500/20 bg-red-500/10'
                                : 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10'
                            }`}
                          >
                            {p.is_anomaly ? 'THREAT' : 'SAFE'}
                          </span>
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
                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold border ${
                  selected.is_anomaly
                    ? 'text-red-300 border-red-500/20 bg-red-500/10'
                    : 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10'
                }`}>
                  {selected.is_anomaly ? 'THREAT' : 'SAFE'}
                </span>
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