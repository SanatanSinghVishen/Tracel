import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { SignIn, SignUp, UserButton, useUser } from '@clerk/clerk-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Forensics from './pages/Forensics';
import Settings from './pages/Settings';
import About from './pages/About';
import Contact from './pages/Contact';
import ContactSubmissions from './pages/ContactSubmissions';
import Landing from './pages/Landing';
import { SocketProvider } from './context/SocketContext.jsx';
import { disableSmoothScroll, enableSmoothScroll } from './lib/scroller.js';
import ChatAssistant from './components/ChatAssistant.jsx';

const clerkAppearance = {
  elements: {
    rootBox: 'w-full',
    card: 'w-full max-w-none glass-card shadow-none',
    headerTitle: 'text-white text-2xl sm:text-3xl font-semibold tracking-tight',
    headerSubtitle: 'text-slate-400',
    socialButtonsBlockButton:
      'glass rounded-lg hover:bg-zinc-800 transition text-slate-100',
    formButtonPrimary:
      'btn-primary w-full font-semibold',
    formFieldLabel: 'text-slate-300',
    formFieldInput:
      'glass rounded-lg text-slate-100 placeholder:text-slate-500 focus:ring-2 focus:ring-tracel-accent-blue/40 focus:border-zinc-700',
    otpCodeFieldInput:
      'glass rounded-lg text-slate-100 placeholder:text-slate-500 focus:ring-2 focus:ring-tracel-accent-blue/40 focus:border-zinc-700',
    dividerLine: 'bg-zinc-800',
    dividerText: 'text-slate-400',
    footerActionText: 'text-slate-400',
    footerActionLink: 'text-slate-200 hover:text-white',
    formFieldAction: 'text-slate-300 hover:text-white',
    alertText: 'text-slate-200',
    identityPreviewText: 'text-slate-200',
    identityPreviewEditButton: 'text-slate-200 hover:text-white',
  },
};

function AuthShell({ children }) {
  return (
    <div className="min-h-screen overflow-y-auto scroll-hidden" data-scroll-wrapper="auth">
      <div className="min-h-screen flex items-center justify-center p-6 sm:p-10" data-scroll-content>
        <div className="w-full max-w-[720px]">
          {children}
        </div>
      </div>
    </div>
  );
}

function AppNavLink({ to, label, onNavigate }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          'flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-semibold transition',
          'outline-none focus-visible:ring-2 focus-visible:ring-tracel-accent-blue/40',
          isActive
            ? 'bg-zinc-950/70 text-white border-zinc-800'
            : 'bg-zinc-950/40 text-slate-200 border-zinc-800 hover:bg-zinc-950/60',
        ].join(' ')
      }
    >
      <span>{label}</span>
    </NavLink>
  );
}

function AppShell() {
  const { pathname } = useLocation();
  const isDashboardRoute = pathname.startsWith('/dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { user, isLoaded } = useUser();
  const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').trim();
  const email = useMemo(
    () =>
      user?.primaryEmailAddress?.emailAddress ||
      user?.emailAddresses?.[0]?.emailAddress ||
      '',
    [user]
  );
  const isAdmin =
    isLoaded &&
    !!user &&
    adminEmail.length > 0 &&
    email.toLowerCase() === adminEmail.toLowerCase();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <SocketProvider>
      <div className="h-[100svh] min-h-[100svh] font-sans overflow-hidden bg-zinc-950 text-white">
        <div className="h-full min-w-0 flex flex-col md:flex-row">
          {/* Desktop sidebar */}
          <div className="hidden md:block">
            <Sidebar />
          </div>

          {/* Mobile top bar */}
          <div className="md:hidden shrink-0 border-b border-zinc-900/80 bg-zinc-950/60 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/50 text-slate-200"
                aria-label="Open navigation"
              >
                <Menu size={18} />
              </button>

              <div className="text-sm font-semibold tracking-tight text-white">Tracel</div>

              <div className="h-10 w-10 flex items-center justify-center">
                {isLoaded && user ? <UserButton afterSignOutUrl="/" /> : null}
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <main
              className={
                `flex-1 min-w-0 min-h-0 overflow-x-hidden overflow-y-auto scroll-hidden ` +
                (isDashboardRoute
                  ? 'md:overflow-hidden p-3 sm:p-5'
                  : 'p-4 sm:p-6')
              }
              data-scroll-wrapper="app"
            >
              <div
                data-scroll-content
                className={
                  isDashboardRoute
                    ? 'min-h-full md:h-full md:min-h-0'
                    : 'min-h-full'
                }
              >
                <Outlet />
              </div>
            </main>
          </div>
        </div>

        {/* Mobile drawer */}
        <AnimatePresence>
          {mobileNavOpen ? (
            <motion.div
              className="fixed inset-0 z-[90]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <button
                type="button"
                className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
              />

              <motion.aside
                className="absolute left-0 top-0 h-full w-[min(88vw,360px)] bg-zinc-950/95 border-r border-zinc-900 p-4"
                initial={{ x: -24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={{ type: 'tween', duration: 0.18 }}
                role="dialog"
                aria-modal="true"
                aria-label="Navigation"
              >
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold text-white">Navigation</div>
                  <button
                    type="button"
                    onClick={() => setMobileNavOpen(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/50 text-slate-200"
                    aria-label="Close navigation"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  <AppNavLink to="/dashboard" label="Dashboard" onNavigate={() => setMobileNavOpen(false)} />
                  <AppNavLink to="/forensics" label="Forensics" onNavigate={() => setMobileNavOpen(false)} />
                  <AppNavLink to="/settings" label="Settings" onNavigate={() => setMobileNavOpen(false)} />
                  <AppNavLink to="/about" label="About" onNavigate={() => setMobileNavOpen(false)} />
                  <AppNavLink to="/contact" label="Contact" onNavigate={() => setMobileNavOpen(false)} />
                  {isAdmin ? (
                    <AppNavLink
                      to="/contact-submissions"
                      label="Contact Submissions"
                      onNavigate={() => setMobileNavOpen(false)}
                    />
                  ) : null}
                </div>

                <div className="mt-6 border-t border-zinc-900 pt-4 text-xs text-slate-400">
                  Swipe back or tap outside to close.
                </div>
              </motion.aside>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ChatAssistant />
      </div>
    </SocketProvider>
  );
}

function AdminOnly({ children }) {
  const { user, isLoaded } = useUser();
  const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').trim();
  const email =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    '';

  if (!isLoaded) return null;
  if (!user) return <Navigate to="/dashboard" replace />;
  const isAdmin = adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

function GlobalScroller() {
  const { pathname } = useLocation();
  const shouldSmooth = !pathname.startsWith('/dashboard');

  useEffect(() => {
    // Touch devices (Android/iOS): always prefer native scrolling.
    // Lenis with smoothTouch=false can block scrolling on touch browsers,
    // especially in "desktop mode" where viewport width may be >= md.
    const isTouchDevice =
      typeof window !== 'undefined' &&
      ((typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0) ||
        'ontouchstart' in window);

    if (isTouchDevice) {
      disableSmoothScroll();
      return undefined;
    }

    if (!shouldSmooth) {
      disableSmoothScroll();
      return undefined;
    }

    // Always reset so wrapper/content can change between routes.
    disableSmoothScroll();

    const isAuthRoute = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');
    const selector = isAuthRoute ? '[data-scroll-wrapper="auth"]' : '[data-scroll-wrapper="app"]';

    let cancelled = false;

    const tryEnable = () => {
      if (cancelled) return;

      // Landing uses normal document scrolling (no app shell wrapper).
      if (pathname === '/') {
        enableSmoothScroll();
        return;
      }

      const wrapper = document.querySelector(selector);
      const content = wrapper ? wrapper.querySelector('[data-scroll-content]') : null;

      if (!wrapper) {
        // Route may not have rendered yet.
        window.requestAnimationFrame(tryEnable);
        return;
      }

      enableSmoothScroll({ wrapper, content });
    };

    window.requestAnimationFrame(tryEnable);

    return () => {
      cancelled = true;
      disableSmoothScroll();
    };
  }, [pathname, shouldSmooth]);

  return null;
}

function App() {
  return (
    <BrowserRouter>
      <GlobalScroller />
      <Routes>
        <Route path="/" element={<Landing />} />

        <Route
          path="/sign-in/*"
          element={
            <AuthShell>
              <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" appearance={clerkAppearance} />
            </AuthShell>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <AuthShell>
              <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" appearance={clerkAppearance} />
            </AuthShell>
          }
        />

        {/* App pages (sidebar + socket). Dashboard is public; sensitive pages require auth. */}
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />

          <Route path="/forensics" element={<Forensics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route
            path="/contact-submissions"
            element={
              <AdminOnly>
                <ContactSubmissions />
              </AdminOnly>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;