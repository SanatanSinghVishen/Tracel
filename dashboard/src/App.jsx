import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { SignIn, SignUp, useUser } from '@clerk/clerk-react';
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

function AppShell() {
  const { pathname } = useLocation();
  const isDashboardRoute = pathname.startsWith('/dashboard');

  return (
    <SocketProvider>
      <div className="h-[100svh] min-h-[100svh] font-sans overflow-hidden bg-zinc-950 text-white">
        <div className="h-full min-w-0 flex">
          <Sidebar />

          <div className="flex-1 min-w-0 flex flex-col">
            <main
              className={
                `flex-1 min-w-0 min-h-0 overflow-x-hidden scroll-hidden ` +
                (isDashboardRoute ? 'overflow-hidden p-3 sm:p-5' : 'overflow-y-auto p-4 sm:p-6')
              }
              data-scroll-wrapper="app"
            >
              <div data-scroll-content className={isDashboardRoute ? 'h-full min-h-0' : 'min-h-full'}>
                <Outlet />
              </div>
            </main>
          </div>
        </div>

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