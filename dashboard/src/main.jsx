import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.jsx'

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY. Add it to dashboard/.env (see .env.example).');
}

const clerkAppearance = {
  variables: {
    colorPrimary: '#3b82f6',
    colorDanger: '#ef4444',
    colorBackground: '#020617',
    colorText: '#ffffff',
    colorInputBackground: 'rgba(255,255,255,0.05)',
    colorInputText: '#e2e8f0',
    borderRadius: '16px',
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'",
  },
  elements: {
    // Center + constrain consistently (modal + dedicated routes)
    rootBox: 'w-full flex justify-center',
    card: 'w-full max-w-[720px] glass-card glow-hover border border-white/10 shadow-none p-8 sm:p-10',
    headerTitle: 'text-white text-2xl sm:text-3xl font-semibold tracking-tight',
    headerSubtitle: 'text-slate-400',
    socialButtonsBlockButton:
      'glass rounded-xl border border-white/10 hover:bg-white/10 transition text-slate-100',
    formButtonPrimary:
      'w-full rounded-xl border border-white/10 bg-gradient-to-r from-tracel-accent-blue/25 to-tracel-accent-purple/25 hover:from-tracel-accent-blue/35 hover:to-tracel-accent-purple/35 text-white font-semibold transition',
    formFieldInput:
      'glass rounded-xl border border-white/10 text-slate-100 placeholder:text-slate-500 focus:ring-2 focus:ring-tracel-accent-blue/40 focus:border-white/20',
    formFieldLabel: 'text-slate-300',
    footerActionText: 'text-slate-400',
    footerActionLink: 'text-slate-200 hover:text-white',
    dividerLine: 'bg-white/10',
    dividerText: 'text-slate-400',

    // Modal polish
    modalBackdrop: 'backdrop-blur-md',
    modalContent: 'p-0',

    // UserButton (account menu)
    userButtonBox: 'flex items-center',
    userButtonTrigger:
      'h-9 w-9 flex items-center justify-center leading-none rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition',
    userButtonPopoverCard: 'glass-card border border-white/10 shadow-none',
    userButtonPopoverMain: 'text-slate-200',
    userButtonPopoverActionButton: 'hover:bg-white/10 text-white',
    userButtonPopoverActionButtonText: 'text-white',
    userButtonPopoverActionButtonIcon: 'text-slate-200',
    userButtonPopoverFooter: 'border-t border-white/10',
  },
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPubKey} afterSignOutUrl="/" appearance={clerkAppearance}>
      <App />
    </ClerkProvider>
  </StrictMode>,
)
