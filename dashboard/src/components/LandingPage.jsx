import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Cpu,
  Github,
  Globe,
  Globe2,
  Linkedin,
  LogIn,
  Mail,
  Radar,
  ShieldAlert,
  Sparkles,
  Twitter,
} from 'lucide-react';
import { SignedOut, SignInButton, SignUpButton } from '@clerk/clerk-react';

const MotionDiv = motion.div;

function AnimatedBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Subtle moving grid */}
      <div className="tracel-grid absolute inset-0 opacity-[0.45]" />

      {/* Neon scanline */}
      <div className="tracel-scanline absolute -top-[40%] left-0 right-0 h-[42%] opacity-[0.22]" />

      {/* Soft blooms */}
      <div className="absolute -left-28 -top-28 h-80 w-80 rounded-full blur-3xl bg-emerald-400/10" />
      <div className="absolute -right-28 top-10 h-96 w-96 rounded-full blur-3xl bg-cyan-400/10" />

      <style>{`
        .tracel-grid{
          background-image:
            linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px);
          background-size: 44px 44px;
          background-position: 0 0;
          animation: tracelGridDrift 14s linear infinite;
          mask-image: radial-gradient(90% 70% at 50% 25%, black 0%, rgba(0,0,0,0.75) 55%, transparent 100%);
        }
        @keyframes tracelGridDrift{
          0% { transform: translate3d(0,0,0); }
          100% { transform: translate3d(-44px, 44px, 0); }
        }

        .tracel-scanline{
          background: linear-gradient(
            180deg,
            rgba(34,197,94,0.0),
            rgba(34,197,94,0.12),
            rgba(34,197,94,0.0)
          );
          animation: tracelScanline 5.8s ease-in-out infinite;
          mask-image: linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%);
        }
        @keyframes tracelScanline{
          0% { transform: translateY(0%); }
          55% { transform: translateY(240%); }
          100% { transform: translateY(260%); }
        }
      `}</style>
    </div>
  );
}

function HeroVisual() {
  return (
    <MotionDiv
      className="relative w-full max-w-[560px] aspect-[1.05] mx-auto"
      initial={{ opacity: 0, y: 10, filter: 'blur(10px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.65, ease: 'easeOut', delay: 0.2 }}
    >
      <div className="absolute inset-0 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md overflow-hidden">
        <div className="absolute inset-0 opacity-[0.10] bg-[radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.50),transparent_45%),radial-gradient(circle_at_85%_35%,rgba(34,211,238,0.42),transparent_50%)]" />
        <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(to_right,rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.10)_1px,transparent_1px)] bg-[size:22px_22px]" />

        <MotionDiv
          className="absolute -left-12 -top-10 h-64 w-64 rounded-full blur-2xl bg-emerald-400/15"
          animate={{ x: [0, 22, 0], y: [0, 14, 0] }}
          transition={{ duration: 7.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <MotionDiv
          className="absolute -right-14 bottom-0 h-72 w-72 rounded-full blur-2xl bg-cyan-400/15"
          animate={{ x: [0, -18, 0], y: [0, -16, 0] }}
          transition={{ duration: 8.2, repeat: Infinity, ease: 'easeInOut' }}
        />

        <div className="absolute inset-0 flex items-center justify-center">
          <svg viewBox="0 0 420 420" className="h-[92%] w-[92%] opacity-[0.85]">
            <defs>
              <linearGradient id="tracelWire" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(34,197,94,0.90)" />
                <stop offset="55%" stopColor="rgba(34,211,238,0.55)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0.18)" />
              </linearGradient>
              <radialGradient id="tracelCore" cx="50%" cy="45%" r="55%">
                <stop offset="0%" stopColor="rgba(34,197,94,0.35)" />
                <stop offset="55%" stopColor="rgba(34,211,238,0.14)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
            </defs>

            <circle cx="210" cy="210" r="165" fill="url(#tracelCore)" />
            <circle cx="210" cy="210" r="132" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <circle cx="210" cy="210" r="96" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />

            <g stroke="url(#tracelWire)" strokeWidth="1.35" fill="none" opacity="0.85">
              <path d="M78 152 L210 118 L342 152" />
              <path d="M86 270 L210 302 L334 270" />
              <path d="M130 94 L210 210 L290 94" />
              <path d="M120 330 L210 210 L300 330" />
              <path d="M72 210 L348 210" />
              <path d="M210 70 L210 350" />
            </g>

            <g fill="rgba(255,255,255,0.62)">
              {Array.from({ length: 12 }).map((_, i) => {
                const a = (i / 12) * Math.PI * 2;
                const r = 132;
                const x = 210 + Math.cos(a) * r;
                const y = 210 + Math.sin(a) * r;
                return <circle key={i} cx={x} cy={y} r="2.2" opacity="0.7" />;
              })}
            </g>
          </svg>
        </div>
      </div>
    </MotionDiv>
  );
}

function splitWords(text) {
  return String(text).split(/\s+/).filter(Boolean);
}

function GlassFeatureTile({ icon: Icon, title, body, accent = 'green' }) {
  const borderHover = accent === 'cyan' ? 'hover:border-cyan-400/50' : 'hover:border-emerald-400/50';
  const overlay = accent === 'cyan'
    ? 'from-cyan-400/20 via-transparent to-emerald-400/10'
    : 'from-emerald-400/20 via-transparent to-cyan-400/10';

  return (
    <motion.div
      whileHover={{ y: -5 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className={[
        'relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md',
        'p-5 sm:p-6 transition-colors duration-200',
        borderHover,
      ].join(' ')}
    >
      <div aria-hidden="true" className={['pointer-events-none absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-200', 'bg-gradient-to-br', overlay].join(' ')} />

      <div className="relative flex items-start gap-3">
        <div className="h-11 w-11 shrink-0 rounded-xl border border-white/10 bg-black/30 backdrop-blur-md grid place-items-center">
          <Icon className="h-5 w-5 text-zinc-100" />
        </div>
        <div className="min-w-0">
          <div className="text-sm sm:text-base font-semibold text-white tracking-tight">{title}</div>
          <p className="mt-2 text-xs sm:text-sm text-zinc-300 leading-relaxed">{body}</p>
        </div>
      </div>
    </motion.div>
  );
}

export default function LandingPage() {
  const creator = {
    name: (import.meta.env.VITE_PORTFOLIO_NAME || '').trim(),
    tagline: (import.meta.env.VITE_PORTFOLIO_TAGLINE || '').trim(),
    links: {
      website: (import.meta.env.VITE_PORTFOLIO_WEBSITE || '').trim(),
      github: (import.meta.env.VITE_PORTFOLIO_GITHUB || '').trim(),
      linkedin: (import.meta.env.VITE_PORTFOLIO_LINKEDIN || '').trim(),
      x: (import.meta.env.VITE_PORTFOLIO_X || '').trim(),
      email: (import.meta.env.VITE_PORTFOLIO_EMAIL || '').trim(),
    },
  };

  const hasAnyLink =
    !!creator.links.website ||
    !!creator.links.github ||
    !!creator.links.linkedin ||
    !!creator.links.x ||
    !!creator.links.email;

  const headline = 'The Future of Network Threat Simulation.';
  const words = useMemo(() => splitWords(headline), []);

  const heroContainer = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
  };

  const heroItem = {
    hidden: { opacity: 0, y: 14, filter: 'blur(10px)' },
    show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.55, ease: 'easeOut' } },
  };

  const features = useMemo(
    () => [
      {
        icon: Radar,
        title: 'Real-time Monitoring',
        body: 'Live traffic insights and instant threat labeling for fast situational awareness.',
        accent: 'green',
      },
      {
        icon: Cpu,
        title: 'AI Analysis',
        body: 'Isolation Forest scoring highlights anomalies in real time (lower score = more suspicious).',
        accent: 'cyan',
      },
      {
        icon: Globe2,
        title: '3D Forensics',
        body: 'Investigate origins and incidents with clear visual summaries and geo intelligence.',
        accent: 'green',
      },
    ],
    [],
  );

  return (
    <div className="relative min-h-screen w-full bg-zinc-950 text-white overflow-hidden">
      <AnimatedBackdrop />

      {/* HERO (Full Viewport) */}
      <section className="relative min-h-[100svh] flex items-center">
        <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-14 sm:py-16">
          {/* Header */}
          <div className="mb-10 flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md grid place-items-center">
                <ShieldAlert className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="text-[18px] uppercase tracking-[0.28em] text-zinc-300">TRACEL</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <motion.div className="lg:col-span-7" variants={heroContainer} initial="hidden" animate="show">

              <motion.h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.04]">
                {words.map((w, idx) => (
                  <motion.span
                    key={`${w}-${idx}`}
                    variants={heroItem}
                    className="inline-block mr-3"
                  >
                    {w}
                  </motion.span>
                ))}
              </motion.h1>

              <motion.p variants={heroItem} className="mt-5 text-base sm:text-lg text-zinc-300 max-w-2xl leading-relaxed">
                Visualize. Detect. Secure. Real-time anomaly detection powered by Isolation Forest.
              </motion.p>

              <motion.div variants={heroItem} className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
                <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
                  <Link
                    to="/dashboard"
                    className="relative inline-flex items-center justify-center rounded-xl px-6 py-3.5 font-semibold bg-emerald-400 text-black border border-emerald-300/60"
                  >
                    <span aria-hidden="true" className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-200" style={{ background: 'radial-gradient(800px circle at 30% 40%, rgba(34,211,238,0.25), transparent 45%)' }} />
                    <span className="relative inline-flex items-center gap-2">
                      Launch Simulator <ArrowRight className="h-4 w-4" />
                    </span>
                  </Link>
                </motion.div>

                <SignedOut>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                      <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md px-6 py-3.5 text-sm text-zinc-200 hover:text-white hover:border-emerald-400/30 transition">
                        <LogIn className="h-4 w-4" /> Log in
                      </button>
                    </SignInButton>
                    <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                      <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-400 px-6 py-3.5 text-sm font-semibold text-black hover:brightness-110 transition">
                        Create account <ArrowRight className="h-4 w-4" />
                      </button>
                    </SignUpButton>
                  </div>
                </SignedOut>
              </motion.div>
            </motion.div>

            {/* Visual */}
            <div className="lg:col-span-5">
              <HeroVisual />
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES GRID (Bento) */}
      <section className="relative">
        <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-14 sm:py-16">
          <MotionDiv
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-400">Capabilities</div>
            <h2 className="mt-2 text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              Real-time security insights, built for speed.
            </h2>
            <p className="mt-2 text-sm text-zinc-300 max-w-2xl">
              Tracel streams simulated traffic, scores anomalies, and surfaces threats with clear forensics.
            </p>
          </MotionDiv>

          <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-4">
            {features.map((f, idx) => (
              <MotionDiv
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.5, ease: 'easeOut', delay: idx * 0.05 }}
              >
                <GlassFeatureTile icon={f.icon} title={f.title} body={f.body} accent={f.accent} />
              </MotionDiv>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS (Timeline) */}
      <section className="relative">
        <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-14 sm:py-16">
          <MotionDiv
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-400">How it works</div>
            <h2 className="mt-2 text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              Traffic Gen → Node.js Stream → Python AI → Dashboard
            </h2>
            <p className="mt-2 text-sm text-zinc-300 max-w-2xl">
              Each stage is designed to be lightweight, fast, and easy to reason about.
            </p>
          </MotionDiv>

          <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7">
              <div className="relative">
                <div className="absolute left-[18px] top-0 bottom-0 w-px bg-gradient-to-b from-emerald-400/40 via-white/10 to-transparent" />

                <div className="space-y-4">
                  {[
                    { title: 'Traffic Gen', body: 'Generate synthetic traffic and attack-like patterns.' },
                    { title: 'Node.js Stream', body: 'Stream packets live over Socket.IO.' },
                    { title: 'Python AI', body: 'Score anomalies in real time using Isolation Forest.' },
                    { title: 'Dashboard', body: 'Visualize threats, origins, and forensic details in a clean UI.' },
                  ].map((s, idx) => (
                    <MotionDiv
                      key={s.title}
                      initial={{ opacity: 0, y: 14 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.35 }}
                      transition={{ duration: 0.5, ease: 'easeOut', delay: idx * 0.04 }}
                      className="relative pl-12"
                    >
                      <div className="absolute left-0 top-5 h-9 w-9 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md grid place-items-center">
                        <span className="text-xs font-semibold text-zinc-200">{idx + 1}</span>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-4 sm:p-5">
                        <div className="text-sm font-semibold text-white">{s.title}</div>
                        <div className="mt-1 text-sm text-zinc-300 leading-relaxed">{s.body}</div>
                      </div>
                    </MotionDiv>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-5">
              <MotionDiv
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-5 sm:p-6 overflow-hidden"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-400">Purpose</div>
                    <div className="mt-2 text-lg font-semibold text-white tracking-tight">
                      Simulate. Detect. Investigate.
                    </div>
                    <p className="mt-2 text-sm text-zinc-300 leading-relaxed">
                      Tracel helps you stress-test networks with realistic attack patterns and use AI to flag anomalies in real time.
                    </p>
                  </div>
                  <div className="h-11 w-11 rounded-xl border border-white/10 bg-black/30 backdrop-blur-md grid place-items-center">
                    <Sparkles className="h-5 w-5 text-emerald-300" />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    { k: 'Simulator', v: 'Node.js stream' },
                    { k: 'AI', v: 'Isolation Forest' },
                    { k: 'Forensics', v: 'Origins + incidents' },
                    { k: 'Source', v: 'MongoDB truth' },
                  ].map((x) => (
                    <div key={x.k} className="rounded-xl border border-white/10 bg-black/20 backdrop-blur-md p-3">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-400">{x.k}</div>
                      <div className="mt-1 text-sm font-semibold text-white">{x.v}</div>
                    </div>
                  ))}
                </div>
              </MotionDiv>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative border-t border-white/10">
        <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="text-[12px] uppercase tracking-[0.28em] text-zinc-300">TRACEL</div>

              <div className="mt-4 text-xs text-zinc-400">
                Built by{' '}
                <span className="text-zinc-200 font-semibold">
                  {creator.name ? creator.name : 'Your Name'}
                </span>
                {creator.tagline ? <span className="text-zinc-500"> — {creator.tagline}</span> : null}
              </div>
            </div>

            {hasAnyLink ? (
              <div className="flex items-center gap-2">
                {creator.links.website ? (
                  <a
                    href={creator.links.website}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Website"
                    title="Website"
                    className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md hover:border-emerald-400/30 hover:bg-white/10 transition grid place-items-center"
                  >
                    <Globe className="h-5 w-5 text-zinc-100" />
                  </a>
                ) : null}
                {creator.links.github ? (
                  <a
                    href={creator.links.github}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="GitHub"
                    title="GitHub"
                    className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md hover:border-emerald-400/30 hover:bg-white/10 transition grid place-items-center"
                  >
                    <Github className="h-5 w-5 text-zinc-100" />
                  </a>
                ) : null}
                {creator.links.linkedin ? (
                  <a
                    href={creator.links.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="LinkedIn"
                    title="LinkedIn"
                    className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md hover:border-emerald-400/30 hover:bg-white/10 transition grid place-items-center"
                  >
                    <Linkedin className="h-5 w-5 text-zinc-100" />
                  </a>
                ) : null}
                {creator.links.x ? (
                  <a
                    href={creator.links.x}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="X (Twitter)"
                    title="X (Twitter)"
                    className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md hover:border-emerald-400/30 hover:bg-white/10 transition grid place-items-center"
                  >
                    <Twitter className="h-5 w-5 text-zinc-100" />
                  </a>
                ) : null}
                {creator.links.email ? (
                  <a
                    href={`mailto:${creator.links.email}`}
                    aria-label="Email"
                    title="Email"
                    className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md hover:border-emerald-400/30 hover:bg-white/10 transition grid place-items-center"
                  >
                    <Mail className="h-5 w-5 text-zinc-100" />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
