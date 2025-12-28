import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Inbox, RefreshCcw } from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/clerk-react';
import { useSocket } from '../hooks/useSocket.js';
import { getServerUrl } from '../lib/socket.js';

export default function ContactSubmissions() {
  const { user, isLoaded } = useUser();
  const { connection } = useSocket();

  const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').trim();
  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    '';

  const isAdmin =
    isLoaded &&
    adminEmail.length > 0 &&
    email.toLowerCase() === adminEmail.toLowerCase();

  const serverUrl = useMemo(() => {
    const fromSocket = typeof connection?.serverUrl === 'string' ? connection.serverUrl : '';
    const fromEnv = getServerUrl();
    return (fromSocket || fromEnv || '').replace(/\/$/, '');
  }, [connection?.serverUrl]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submissions, setSubmissions] = useState([]);

  const refresh = useCallback(async () => {
    setError('');

    if (!serverUrl) {
      setError('Server URL is not configured. Set VITE_SERVER_URL and restart the dashboard.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/api/contact?limit=100`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ? String(body.error) : `Request failed (HTTP ${res.status})`);
      }

      const list = Array.isArray(body?.submissions) ? body.submissions : [];
      setSubmissions(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin, refresh]);

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="glass-card glow-hover p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl border border-white/10 bg-gradient-to-br from-tracel-accent-blue/20 to-tracel-accent-purple/20 flex items-center justify-center">
              <Inbox className="w-5 h-5 text-slate-100" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white tracking-tight">Contact Submissions</h2>
              <p className="mt-1 text-xs text-slate-400">Admin inbox for messages submitted via the Contact page.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={loading || !isAdmin}
            className="px-3 py-2 rounded-xl text-xs font-semibold glass border border-white/10 text-slate-100 hover:bg-white/10 disabled:opacity-60"
            title={!isAdmin ? 'Admin only' : 'Refresh'}
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCcw size={14} /> {loading ? 'Refreshing…' : 'Refresh'}
            </span>
          </button>
        </div>
      </div>

      {!isAdmin ? (
        <div className="glass-card glow-hover p-5 sm:p-6 text-slate-200 animate-fade-up">
          <p className="text-sm">
            This page is <span className="text-white font-semibold">Admin-only</span>.
          </p>
          <p className="mt-1 text-xs text-slate-400">Admin email: {adminEmail || 'Not set'}</p>

          <SignedOut>
            <div className="mt-3">
              <SignInButton mode="modal" forceRedirectUrl="/contact-submissions">
                <button className="glass rounded-xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10 transition hover-lift">
                  Log in
                </button>
              </SignInButton>
            </div>
          </SignedOut>

          <SignedIn>
            <p className="mt-2 text-xs text-slate-400">Signed in as {email || 'user'}, but not admin.</p>
          </SignedIn>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="glass-card glow-hover p-6 sm:p-7 animate-fade-up">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <Database size={16} className="text-slate-200" /> Inbox
            </div>
            <div className="text-xs text-slate-400">Showing newest first</div>
          </div>

          {error ? <div className="mt-3 text-sm text-red-300">{error}</div> : null}

          {!error && submissions.length === 0 ? (
            <div className="mt-4 text-sm text-slate-300">No messages yet.</div>
          ) : (
            <div className="mt-4 space-y-3">
              {submissions.map((s) => (
                <div key={s.id || `${s.receivedAt}-${s.email}`} className="glass rounded-2xl border border-white/10 p-4 hover:bg-white/10 transition">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="text-sm font-semibold text-white">
                      {s.name || 'Unknown'}
                      <span className="text-slate-400 font-normal"> — {s.email || 'no-email'}</span>
                    </div>
                    <div className="text-xs text-slate-400 data-mono">{s.receivedAt || '—'}</div>
                  </div>

                  {s.org ? <div className="mt-1 text-xs text-slate-400">{s.org}</div> : null}

                  <div className="mt-3 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {s.message || ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
