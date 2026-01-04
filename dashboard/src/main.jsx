import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.jsx'

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY. Add it to dashboard/.env (see .env.example).');
}

// Optional override: some networks block *.clerk.accounts.dev in the browser.
// If set, Clerk will load its JS bundle from this URL instead.
// Example: https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js
const clerkJsUrl = (import.meta.env.VITE_CLERK_JS_URL || '').trim() || undefined;

const clerkAppearance = {
  variables: {
    colorPrimary: '#3b82f6',
    colorDanger: '#ef4444',
    colorBackground: '#020617',
    colorText: '#ffffff',
    colorInputBackground: 'rgba(9,9,11,0.55)',
    colorInputText: '#e2e8f0',
    borderRadius: '12px',
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'",
  },
  elements: {
    // Center + constrain consistently (modal + dedicated routes)
    rootBox: 'w-full flex justify-center',
    card: 'w-full max-w-[720px] glass-card glow-hover shadow-none p-8 sm:p-10',
    headerTitle: 'text-white text-2xl sm:text-3xl font-semibold tracking-tight',
    headerSubtitle: 'text-slate-400',
    socialButtonsBlockButton:
      'glass rounded-lg hover:bg-zinc-800 transition text-slate-100',
    formButtonPrimary: 'btn-primary w-full font-semibold',
    formFieldInput:
      'glass rounded-lg text-slate-100 placeholder:text-slate-500 focus:ring-2 focus:ring-tracel-accent-blue/40 focus:border-zinc-700',
    formFieldLabel: 'text-slate-300',
    footerActionText: 'text-slate-400',
    footerActionLink: 'text-slate-200 hover:text-white',
    dividerLine: 'bg-zinc-800',
    dividerText: 'text-slate-400',

    // Modal polish
    modalBackdrop: '',
    modalContent: 'p-0',

    // UserButton (account menu)
    userButtonBox: 'flex items-center',
    userButtonTrigger:
      'h-9 w-9 flex items-center justify-center leading-none rounded-lg border border-zinc-800 bg-zinc-950/60 hover:bg-zinc-900 transition',
    userButtonPopoverCard: 'glass-card shadow-none',
    userButtonPopoverMain: 'text-slate-200',
    userButtonPopoverActionButton: 'hover:bg-zinc-800 text-white',
    userButtonPopoverActionButtonText: 'text-white',
    userButtonPopoverActionButtonIcon: 'text-slate-200',
    userButtonPopoverFooter: 'border-t border-zinc-800',
  },
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={clerkPubKey}
      clerkJSUrl={clerkJsUrl}
      // Give slow/busy networks a bit more time to fetch the script.
      scriptLoadTimeout={30000}
      afterSignOutUrl="/"
      appearance={clerkAppearance}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
)
