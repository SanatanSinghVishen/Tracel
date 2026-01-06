import { useEffect, useMemo, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import { useSocket } from '../hooks/useSocket.js';
import { getServerUrl } from '../lib/socket.js';

export default function Contact() {
  const { user, isLoaded } = useUser();
  const { connection } = useSocket();
  const [form, setForm] = useState({ name: '', email: '', org: '', message: '' });
  const [status, setStatus] = useState({ state: 'idle', error: '' });
  const [fieldErrors, setFieldErrors] = useState({ name: '', email: '', message: '' });

  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const messageRef = useRef(null);

  const serverUrl = useMemo(() => {
    const fromSocket = typeof connection?.serverUrl === 'string' ? connection.serverUrl : '';
    const fromEnv = getServerUrl();
    return (fromSocket || fromEnv || '').replace(/\/$/, '');
  }, [connection?.serverUrl]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));

    // Clear inline validation as the user types.
    if (field === 'name' || field === 'email' || field === 'message') {
      setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    }
  }

  function validateRequired(nextForm) {
    const name = String(nextForm?.name || '').trim();
    const email = String(nextForm?.email || '').trim();
    const message = String(nextForm?.message || '').trim();

    const next = { name: '', email: '', message: '' };
    if (!name) next.name = 'Name is required.';
    if (!email) next.email = 'Email is required.';
    if (!message) next.message = 'Message is required.';

    setFieldErrors(next);

    if (next.name) {
      nameRef.current?.focus?.();
      return false;
    }
    if (next.email) {
      emailRef.current?.focus?.();
      return false;
    }
    if (next.message) {
      messageRef.current?.focus?.();
      return false;
    }

    return true;
  }

  useEffect(() => {
    if (!isLoaded || !user) return;

    const inferredEmail =
      user?.primaryEmailAddress?.emailAddress ||
      user?.emailAddresses?.[0]?.emailAddress ||
      '';

    const inferredName =
      user?.fullName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
      '';

    // Only prefill if the user hasn't typed anything yet.
    setForm((prev) => ({
      ...prev,
      name: prev.name ? prev.name : inferredName,
      email: prev.email ? prev.email : inferredEmail,
    }));
  }, [isLoaded, user]);

  async function submit(e) {
    e.preventDefault();
    setStatus({ state: 'submitting', error: '' });

    const name = form.name.trim();
    const email = form.email.trim();
    const message = form.message.trim();

    if (!validateRequired(form)) {
      setStatus({ state: 'error', error: 'Please fill in Name, Email, and Message.' });
      return;
    }

    if (!serverUrl) {
      setStatus({
        state: 'error',
        error: 'Server URL is not configured. Set VITE_SERVER_URL and restart the dashboard.',
      });
      return;
    }

    try {
      const res = await fetch(`${serverUrl}/api/contact`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, org: form.org.trim(), message }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error ? String(body.error) : `Request failed (HTTP ${res.status})`;
        setStatus({ state: 'error', error: msg });
        return;
      }

      setStatus({ state: 'success', error: '' });
      setForm({ name: '', email: '', org: '', message: '' });
      setFieldErrors({ name: '', email: '', message: '' });
    } catch (err) {
      setStatus({ state: 'error', error: String(err) });
    }
  }

  return (
    <div className="min-w-0 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="glass-card glow-hover p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl border border-white/10 bg-gradient-to-br from-tracel-accent-blue/20 to-tracel-accent-purple/20 flex items-center justify-center">
            <Mail className="w-5 h-5 text-slate-100" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-white tracking-tight">Contact</h2>
            <p className="mt-1 text-xs text-slate-400">Send a message to the team.</p>
          </div>
        </div>
      </div>

      <div className="glass-card glow-hover p-6 sm:p-7 hover-lift interactive animate-fade-up">
        <h3 className="text-lg font-semibold text-white">Contact Us</h3>
        <p className="mt-2 text-sm text-slate-300">Leave your details and we’ll reach out.</p>

        <form onSubmit={submit} className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider">Name</label>
            <input
              ref={nameRef}
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              required
              aria-invalid={!!fieldErrors.name}
              className={`mt-2 w-full glass rounded-xl border px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-tracel-accent-blue/40 ${
                fieldErrors.name ? 'border-red-400/40' : 'border-white/10'
              }`}
              placeholder="Your full name"
            />
            {fieldErrors.name ? <div className="mt-1 text-xs text-red-300">{fieldErrors.name}</div> : null}
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider">Email</label>
            <input
              ref={emailRef}
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              type="email"
              required
              aria-invalid={!!fieldErrors.email}
              className={`mt-2 w-full glass rounded-xl border px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-tracel-accent-blue/40 ${
                fieldErrors.email ? 'border-red-400/40' : 'border-white/10'
              }`}
              placeholder="you@company.com"
            />
            {fieldErrors.email ? <div className="mt-1 text-xs text-red-300">{fieldErrors.email}</div> : null}
          </div>

          <div>
            <label className="text-xs text-slate-400 uppercase tracking-wider">Company (optional)</label>
            <input
              value={form.org}
              onChange={(e) => update('org', e.target.value)}
              className="mt-2 w-full glass rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-tracel-accent-blue/40"
              placeholder="Org / Team"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="text-xs text-slate-400 uppercase tracking-wider">Message</label>
            <textarea
              ref={messageRef}
              value={form.message}
              onChange={(e) => update('message', e.target.value)}
              rows={4}
              required
              aria-invalid={!!fieldErrors.message}
              className={`mt-2 w-full glass rounded-xl border px-4 py-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-tracel-accent-blue/40 ${
                fieldErrors.message ? 'border-red-400/40' : 'border-white/10'
              }`}
              placeholder="Your Message"
            />
            {fieldErrors.message ? <div className="mt-1 text-xs text-red-300">{fieldErrors.message}</div> : null}
          </div>

          <div className="lg:col-span-2 flex items-center justify-between gap-3">
            <div className="text-sm">
              {status.state === 'success' ? (
                <span className="text-slate-200">Submitted. We’ll contact you soon.</span>
              ) : status.state === 'submitting' ? (
                <span className="text-slate-400">Submitting…</span>
              ) : status.state === 'error' ? (
                <span className="text-red-300">{status.error}</span>
              ) : (
                <span className="text-slate-400">We’ll respond via the email you provide.</span>
              )}
            </div>
            <button
              type="submit"
              disabled={status.state === 'submitting'}
              className="rounded-xl px-5 py-3 text-white border border-white/10 bg-gradient-to-r from-tracel-accent-blue/25 to-tracel-accent-purple/25 hover:from-tracel-accent-blue/35 hover:to-tracel-accent-purple/35 transition hover-lift"
            >
              {status.state === 'submitting' ? 'Sending…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
