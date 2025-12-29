import { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings as SettingsIcon, Wifi, Database, User, RefreshCcw } from 'lucide-react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useSocket } from '../hooks/useSocket.js';
import { buildAuthHeaders, getOrCreateAnonId } from '../lib/authClient.js';
import { readDefaultTrafficView, writeDefaultTrafficView } from '../utils/prefs.js';

export default function Settings() {
  const { user, isLoaded } = useUser();
  const auth = useAuth();
  const { connection } = useSocket();
  const anonId = useMemo(() => getOrCreateAnonId(), []);

  const [defaultTrafficView, setDefaultTrafficView] = useState('bandwidth');
  const [persistence, setPersistence] = useState({ status: 'unknown', message: '', checkedAt: null });
  const [checking, setChecking] = useState(false);

  const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').trim();
  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    '';
  const isAdmin =
    isLoaded &&
    adminEmail.length > 0 &&
    email.toLowerCase() === adminEmail.toLowerCase();

  const identityLabel = useMemo(() => {
    if (!isLoaded) return 'Loading…';
    if (!email) return 'Guest';
    return email;
  }, [email, isLoaded]);

  useEffect(() => {
    setDefaultTrafficView(readDefaultTrafficView());
  }, []);

  useEffect(() => {
    writeDefaultTrafficView(defaultTrafficView);
  }, [defaultTrafficView]);

  const checkPersistence = useCallback(async () => {
    if (!connection?.serverUrl) return;
    setChecking(true);
    try {
      const url = `${connection.serverUrl.replace(/\/$/, '')}/api/packets?limit=1`;
      const headers = await buildAuthHeaders(auth.isLoaded ? auth.getToken : null, anonId);
      const res = await fetch(url, { headers, credentials: 'include' });
      if (res.ok) {
        setPersistence({ status: 'ok', message: 'Mongo persistence enabled', checkedAt: new Date() });
      } else {
        const body = await res.json().catch(() => ({}));
        setPersistence({
          status: 'warn',
          message: body?.error ? String(body.error) : `HTTP ${res.status}`,
          checkedAt: new Date(),
        });
      }
    } catch (e) {
      setPersistence({ status: 'warn', message: String(e), checkedAt: new Date() });
    } finally {
      setChecking(false);
    }
  }, [connection?.serverUrl, auth.isLoaded, auth.getToken, anonId]);

  useEffect(() => {
    // Auto-check when you open the page.
    checkPersistence();
  }, [checkPersistence]);

  return (
    <div className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden space-y-6 animate-fade-in">
      {/* Header */}
      <div className="glass-card glow-hover p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl border border-white/10 bg-gradient-to-br from-tracel-accent-blue/20 to-tracel-accent-purple/20 flex items-center justify-center">
            <SettingsIcon className="w-5 h-5 text-slate-100" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-white tracking-tight">Configuration</h2>
            <p className="mt-1 text-xs text-slate-400">
              Environment, connection status, persistence checks, and client preferences.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-card glow-hover p-5 hover-lift interactive animate-fade-up">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <User size={16} className="text-slate-200" /> Access
            </div>
            <div className="mt-3 text-sm text-slate-200">
              <div>
                <span className="text-slate-400">Signed in as:</span> {identityLabel}
              </div>
              {isAdmin ? (
                <div className="mt-1">
                  <span className="text-slate-400">Role:</span>{' '}
                  <span className="text-white font-semibold">Admin</span>
                </div>
              ) : null}
            </div>
          </div>

        <div className="glass-card glow-hover p-5 hover-lift interactive animate-fade-up">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <Wifi size={16} className="text-slate-200" /> Connections
            </div>
            <div className="mt-3 text-sm text-slate-200">
              <div>
                <span className="text-slate-400">Socket server:</span>{' '}
                <span className="data-mono text-slate-100">{connection.serverUrl}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-slate-400">Status:</span>
                <span className={connection.connected ? 'pulse-dot' : 'pulse-dot pulse-dot--off'} />
                <span className="text-slate-200">{connection.connected ? 'Connected' : 'Disconnected'}</span>
              </div>
              {isAdmin ? (
                <p className="mt-2 text-xs text-slate-400">
                  To change the server URL, edit <span className="data-mono">VITE_SERVER_URL</span> in{' '}
                  <span className="data-mono">dashboard/.env.local</span> and restart Vite.
                </p>
              ) : null}
            </div>
          </div>

        <div className="glass-card glow-hover p-5 hover-lift interactive animate-fade-up">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <SettingsIcon size={16} className="text-slate-200" /> Client Preferences
            </div>
            <div className="mt-3 text-sm text-slate-200">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-slate-400 text-xs uppercase tracking-wider">Default traffic view</div>
                  <div className="text-sm text-slate-200">Controls what Monitor shows first</div>
                </div>
                <select
                  value={defaultTrafficView}
                  onChange={(e) => setDefaultTrafficView(e.target.value === 'globe' ? 'globe' : 'bandwidth')}
                  className="glass rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-tracel-accent-blue/40"
                >
                  <option value="bandwidth">Bandwidth</option>
                  <option value="globe">Globe</option>
                </select>
              </div>
            </div>
          </div>

        <div className="glass-card glow-hover p-5 hover-lift interactive lg:col-span-3 animate-fade-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <Database size={16} className="text-slate-200" /> Data & Forensics
            </div>
            <button
              type="button"
              onClick={checkPersistence}
              disabled={checking}
              className="px-3 py-1.5 rounded-xl text-[11px] font-semibold glass border border-white/10 hover:bg-white/10 text-slate-100 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCcw size={14} /> {checking ? 'Checking…' : 'Re-check'}
              </span>
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-slate-200">
            <div className="glass rounded-2xl border border-white/10 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Mongo persistence</div>
              <div
                className={
                  persistence.status === 'ok'
                    ? 'mt-2 text-white font-semibold'
                    : persistence.status === 'warn'
                      ? 'mt-2 text-red-300 font-semibold'
                      : 'mt-2 text-gray-400 font-semibold'
                }
              >
                {persistence.status === 'ok' ? 'Enabled' : persistence.status === 'warn' ? 'Unavailable' : 'Unknown'}
              </div>
              <div className="mt-2 text-xs text-slate-400">{persistence.message || 'Uses /api/packets to detect DB status.'}</div>
            </div>

            <div className="glass rounded-2xl border border-white/10 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Last checked</div>
              <div className="mt-2 data-mono text-slate-100">
                {persistence.checkedAt ? persistence.checkedAt.toLocaleString() : '—'}
              </div>
              <div className="mt-2 text-xs text-slate-400">Re-check to refresh status.</div>
            </div>

            <div className="glass rounded-2xl border border-white/10 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wider">How to enable</div>
              <div className="mt-2 text-xs text-slate-400">
                {isAdmin ? (
                  <>
                    Set <span className="data-mono text-slate-200">MONGO_URL</span> in{' '}
                    <span className="data-mono text-slate-200">server/.env</span> and restart the server.
                  </>
                ) : (
                  'Only shown to admins.'
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
