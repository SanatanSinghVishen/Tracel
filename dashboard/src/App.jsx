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
    card: 'w-full max-w-none glass-card border border-white/10 shadow-none',
    headerTitle: 'text-white text-2xl sm:text-3xl font-semibold tracking-tight',
    headerSubtitle: 'text-slate-400',
    socialButtonsBlockButton:
      'glass rounded-xl border border-white/10 hover:bg-white/10 transition text-slate-100',
    formButtonPrimary:
      'w-full rounded-xl border border-white/10 bg-gradient-to-r from-tracel-accent-blue/25 to-tracel-accent-purple/25 hover:from-tracel-accent-blue/35 hover:to-tracel-accent-purple/35 text-white font-semibold transition',
    formFieldLabel: 'text-slate-300',
    formFieldInput:
      'glass rounded-xl border border-white/10 text-slate-100 placeholder:text-slate-500 focus:ring-2 focus:ring-tracel-accent-blue/40 focus:border-white/20',
    otpCodeFieldInput:
      'glass rounded-xl border border-white/10 text-slate-100 placeholder:text-slate-500 focus:ring-2 focus:ring-tracel-accent-blue/40 focus:border-white/20',
    dividerLine: 'bg-white/10',
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
    <div className="min-h-screen overflow-y-auto scroll-hidden">
      <div className="min-h-screen flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[720px]">
          {children}
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  return (
    <SocketProvider>
      <div className="h-screen min-h-screen font-sans overflow-hidden bg-zinc-950 text-white">
        <div className="h-full min-w-0 flex">
          <Sidebar />

          <div className="flex-1 min-w-0 flex flex-col">
            <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
              <Outlet />
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
  const shouldSmooth = pathname === '/' || pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');

  useEffect(() => {
    if (shouldSmooth) {
      enableSmoothScroll();
      return () => disableSmoothScroll();
    }
    disableSmoothScroll();
    return undefined;
  }, [shouldSmooth]);

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