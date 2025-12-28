import { LayoutDashboard, Database, Settings, ShieldAlert, Lock, Info, Mail, Inbox } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser } from '@clerk/clerk-react';

const Sidebar = () => {
  const { user, isLoaded } = useUser();
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

  return (
    <aside className="fixed left-4 top-4 bottom-4 z-50 w-[72px] md:w-[280px]">
      <div className="h-full glass-card p-3 md:p-4 flex flex-col">

        {/* Brand */}
        <Link
          to="/"
          className="nav-tile flex items-center gap-3 px-2 py-2.5 md:px-3 md:py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/8 transition"
          aria-label="Home"
        >
          <div className="relative h-11 w-11 rounded-2xl border border-white/10 bg-black/30 overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 opacity-80 bg-gradient-to-br from-tracel-accent-blue/35 to-tracel-accent-purple/30" />
            <div className="absolute inset-px rounded-2xl bg-black/35" />
            <ShieldAlert className="relative w-5 h-5 text-slate-100" />
          </div>
          <div className="hidden md:block">
            <div className="flex items-center">
              <div className="text-sm font-extrabold tracking-[0.28em] uppercase bg-gradient-to-r from-tracel-accent-blue to-tracel-accent-purple bg-clip-text text-transparent">
                TRACEL
              </div>
            </div>
            <div className="mt-1 text-xs text-slate-300 tracking-tight">Command Center</div>
            <div className="mt-2 h-px w-full bg-gradient-to-r from-tracel-accent-blue/60 via-white/10 to-tracel-accent-purple/60" />
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
            className={({ isActive }) => `
              group nav-tile relative flex items-center gap-3 px-3 py-2.5 rounded-xl outline-none transition-all
              focus-visible:ring-2 focus-visible:ring-tracel-accent-blue/40 focus-visible:ring-offset-0
              ${isActive
                ? 'nav-tile--active text-white bg-white/8'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}
            `}
          >
            {({ isActive }) => (
              <>
                <div
                  className={`h-9 w-9 rounded-xl grid place-items-center transition border ${
                    isActive
                      ? 'bg-white/10 border-white/15'
                      : 'bg-white/5 border-white/10 group-hover:bg-white/10'
                  }`}
                >
                  <item.icon size={18} className="text-slate-200" />
                </div>
                <span className="hidden md:block font-medium text-sm">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}

        {isAdmin ? (
          <div className="pt-3 mt-3 border-t border-white/10">
            {adminNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) => `
                  group nav-tile relative flex items-center gap-3 px-3 py-2.5 rounded-xl outline-none transition-all
                  focus-visible:ring-2 focus-visible:ring-tracel-accent-blue/40 focus-visible:ring-offset-0
                  ${isActive
                    ? 'nav-tile--active text-white bg-white/8'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}
                `}
              >
                {({ isActive }) => (
                  <>
                    <div
                      className={`h-9 w-9 rounded-xl grid place-items-center transition border ${
                        isActive
                          ? 'bg-white/10 border-white/15'
                          : 'bg-white/5 border-white/10 group-hover:bg-white/10'
                      }`}
                    >
                      <item.icon size={18} className="text-slate-200" />
                    </div>
                    <span className="hidden md:block font-medium text-sm">{item.label}</span>
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
              className="h-10 w-10 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition outline-none focus-visible:ring-2 focus-visible:ring-tracel-accent-blue/40"
            >
              <ShieldAlert className="w-5 h-5 text-slate-100" />
            </button>
          </SignInButton>
        </SignedOut>
      </div>

      <SignedIn>
        <div className="mt-auto hidden md:block px-2">
          <div className="flex items-center justify-between rounded-2xl bg-white/5 border border-white/10 px-3 py-2.5">
            <span className="text-xs text-slate-400 leading-none">Account</span>
            <div className="flex items-center justify-center">
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </div>
      </SignedIn>

      <SignedOut>
        <div className="mt-auto hidden md:block px-2">
          <div className="glass-card p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Account</p>
            <div className="mt-3 flex flex-col gap-2">
              <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                <button className="w-full glass rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10 transition">
                  Log In
                </button>
              </SignInButton>
              <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                <button className="w-full glass rounded-xl border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10 transition">
                  Create Account
                </button>
              </SignUpButton>
            </div>
          </div>
        </div>
      </SignedOut>

        {/* Bottom Status */}
        <div className="mt-4 hidden md:block">
          <div className="glass rounded-2xl border border-white/10 px-4 py-4">
            <p className="text-xs text-slate-400">Security Level</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-white font-semibold">Operational</span>
              <Lock size={14} className="text-slate-200" />
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full w-full bg-gradient-to-r from-tracel-accent-blue/60 to-tracel-accent-purple/60" />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;