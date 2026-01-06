import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, Database, Settings, ShieldAlert, Info, Mail, Inbox } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser } from '@clerk/clerk-react';
import { useSocket } from '../hooks/useSocket.js';

const Sidebar = () => {
  const { user, isLoaded } = useUser();
  const { socket, connection } = useSocket();
  const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').trim();
  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    '';
  const isAdmin =
    isLoaded &&
    adminEmail.length > 0 &&
    email.toLowerCase() === adminEmail.toLowerCase();

  const navItems = [
    { icon: LayoutDashboard, label: 'Monitor', path: '/dashboard' },
    { icon: Database, label: 'Forensics', path: '/forensics' },
    { icon: Settings, label: 'Config', path: '/settings' },
    // Hide About/Contact from the admin panel navigation.
    ...(isAdmin
      ? []
      : [
          { icon: Info, label: 'About', path: '/about' },
          { icon: Mail, label: 'Contact', path: '/contact' },
        ]),
  ];

  const adminNavItems = [
    { icon: Inbox, label: 'Inbox', path: '/contact-submissions' },
  ];

  // Live security status derived from real-time packet stream.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [lastPacketMs, setLastPacketMs] = useState(0);
  const [lastAnomalyMs, setLastAnomalyMs] = useState(0);
  const [aiReady, setAiReady] = useState(null);

  useEffect(() => {
    if (!connection.connected) return undefined;

    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connection.connected]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function pollStatus() {
      try {
        const base = connection.serverUrl || 'http://localhost:3000';
        const url = new URL('/api/status', base);
        url.searchParams.set('_', String(Date.now()));

        const res = await fetch(url.toString(), { credentials: 'include', cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        setAiReady(!!data?.ai_ready);
      } catch {
        if (cancelled) return;
        setAiReady(false);
      }
    }

    if (!connection.connected) {
      setAiReady(null);
      return undefined;
    }

    pollStatus();
    timer = window.setInterval(pollStatus, 5000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [connection.connected, connection.serverUrl]);

  useEffect(() => {
    function onPacket(packet) {
      const t = Date.now();
      setLastPacketMs(t);
      if (packet?.is_anomaly) setLastAnomalyMs(t);
    }

    socket.on('packet', onPacket);
    return () => {
      socket.off('packet', onPacket);
    };
  }, [socket]);

  const securityStatus = useMemo(() => {
    if (!connection.connected) {
      return { level: 'Offline', pillText: 'Offline', pillClass: 'pill pill-neutral' };
    }

    if (aiReady === false) {
      return { level: 'Booting', pillText: 'Warming', pillClass: 'pill pill-neutral' };
    }

    const anomalyWindowMs = 60_000;
    const hasRecentAnomaly = lastAnomalyMs > 0 && nowMs - lastAnomalyMs <= anomalyWindowMs;
    if (hasRecentAnomaly) {
      return { level: 'Critical', pillText: 'Attack', pillClass: 'pill pill-attack' };
    }

    // If connected but no packets yet, still treat as operational monitoring.
    const staleWindowMs = 15_000;
    const hasRecentPackets = lastPacketMs > 0 && nowMs - lastPacketMs <= staleWindowMs;
    return {
      level: 'Operational',
      pillText: hasRecentPackets ? 'Live' : 'Live',
      pillClass: 'pill pill-live',
    };
  }, [connection.connected, aiReady, lastAnomalyMs, lastPacketMs, nowMs]);

  return (
    <aside className="w-14 sm:w-[72px] md:w-[260px] shrink-0 h-full bg-zinc-950 border-r border-zinc-800">
      <div className="h-full p-3 md:p-4 flex flex-col">

        {/* Brand */}
        <Link to="/" className="flex items-center gap-3 px-2 py-2.5 md:px-3 md:py-3 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-900/70 transition" aria-label="Home">
          <div className="h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 grid place-items-center">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div className="hidden md:block">
            <div className="text-xs font-semibold tracking-[0.22em] uppercase text-white">TRACEL</div>
            <div className="mt-1 text-xs text-zinc-400">Command Center</div>
          </div>
        </Link>

        {/* Nav */}
        <nav className="mt-6 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={item.label}
            aria-label={item.label}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 px-3 py-2.5 rounded-lg outline-none transition ${
                isActive
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className="h-9 w-9 rounded-lg grid place-items-center border border-zinc-800 bg-zinc-950 group-hover:bg-zinc-950/70">
                  <item.icon size={18} className={isActive ? 'text-white' : 'text-zinc-300'} />
                </div>
                <span className="hidden md:block font-medium text-sm">{item.label}</span>
                {isActive ? <span className="ml-auto hidden md:inline-flex h-2 w-5 rounded-full bg-green-500/90" /> : null}
              </>
            )}
          </NavLink>
        ))}

        {isAdmin ? (
          <div className="pt-3 mt-3 border-t border-zinc-800">
            {adminNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 px-3 py-2.5 rounded-lg outline-none transition ${
                    isActive
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className="h-9 w-9 rounded-lg grid place-items-center border border-zinc-800 bg-zinc-950 group-hover:bg-zinc-950/70">
                      <item.icon size={18} className={isActive ? 'text-white' : 'text-zinc-300'} />
                    </div>
                    <span className="hidden md:block font-medium text-sm">{item.label}</span>
                    {isActive ? <span className="ml-auto hidden md:inline-flex h-2 w-5 rounded-full bg-green-500/90" /> : null}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ) : null}
      </nav>

        {/* Small-screen account controls (icon dock) */}
        <div className="mt-auto md:hidden flex flex-col items-center gap-3">
        <SignedIn>
          <div className="flex items-center justify-center">
            <UserButton afterSignOutUrl="/" />
          </div>
        </SignedIn>

        <SignedOut>
          <SignInButton mode="modal" forceRedirectUrl="/dashboard">
            <button
              type="button"
              aria-label="Log in"
              title="Log in"
              className="h-10 w-10 flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition outline-none"
            >
              <ShieldAlert className="w-5 h-5 text-white" />
            </button>
          </SignInButton>
        </SignedOut>
      </div>

      <SignedIn>
        <div className="mt-auto hidden md:block px-2">
          <div className="flex items-center justify-between rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2.5">
            <span className="text-xs text-zinc-400 leading-none">Account</span>
            <div className="flex items-center justify-center">
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </div>
      </SignedIn>

      <SignedOut>
        <div className="mt-auto hidden md:block px-2">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <p className="text-xs text-zinc-400 uppercase tracking-wider">Account</p>
            <div className="mt-3 flex flex-col gap-2">
              <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                <button className="w-full btn-secondary">
                  Log In
                </button>
              </SignInButton>
              <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                <button className="w-full btn-primary">
                  Create Account
                </button>
              </SignUpButton>
            </div>
          </div>
        </div>
      </SignedOut>

        {/* Bottom Status */}
        <div className="mt-4 hidden md:block">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-4">
            <p className="text-xs text-zinc-400">Security Level</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-white font-semibold">{securityStatus.level}</span>
              <span className={securityStatus.pillClass}>{securityStatus.pillText}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;