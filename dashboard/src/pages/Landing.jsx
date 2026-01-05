import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  Cpu,
  Github,
  Globe,
  Globe2,
  Linkedin,
  Mail,
  Radar,
  ShieldAlert,
  Sparkles,
  Twitter,
} from 'lucide-react';
import { SignedOut, SignInButton, SignUpButton } from '@clerk/clerk-react';

function ParticleNetwork() {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const mouseRef = useRef({ x: 0, y: 0, active: false });

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    reduceMotionRef.current = !!mq?.matches;

    const onChange = () => {
      reduceMotionRef.current = !!mq?.matches;
    };

    mq?.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const rand = (min, max) => min + Math.random() * (max - min);
    const points = [];

    const pointCountForArea = (w, h) => Math.max(34, Math.min(78, Math.floor((w * h) / 26000)));
    const linkDistForArea = (w, h) => Math.max(80, Math.min(150, Math.floor(Math.min(w, h) * 0.22)));

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const desired = pointCountForArea(width, height);
      points.length = 0;
      for (let i = 0; i < desired; i += 1) {
        points.push({
          x: rand(0, width),
          y: rand(0, height),
          vx: rand(-0.22, 0.22),
          vy: rand(-0.18, 0.18),
          r: rand(1.0, 1.8),
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const linkDist = linkDistForArea(width, height);
      const linkDist2 = linkDist * linkDist;

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const mouseActive = mouseRef.current.active;

      for (const p of points) {
        if (!reduceMotionRef.current) {
          p.x += p.vx;
          p.y += p.vy;
        }

        if (p.x < -12) p.x = width + 12;
        if (p.x > width + 12) p.x = -12;
        if (p.y < -12) p.y = height + 12;
        if (p.y > height + 12) p.y = -12;
      }

      // Links (neutral, low-opacity)
      ctx.lineWidth = 1;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j += 1) {
          const b = points[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > linkDist2) continue;

          const dist = Math.sqrt(dist2);
          let alpha = (1 - dist / linkDist) * 0.22;

          if (mouseActive) {
            const gx = (a.x + b.x) * 0.5;
            const gy = (a.y + b.y) * 0.5;
            const mdx = gx - mx;
            const mdy = gy - my;
            const md = Math.sqrt(mdx * mdx + mdy * mdy);
            alpha += Math.max(0, 1 - md / 240) * 0.14;
          }

          ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Dots
      for (const p of points) {
        const boost =
          mouseActive ? Math.max(0, 1 - Math.hypot(p.x - mx, p.y - my) / 280) : 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + boost * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.32 + boost * 0.40})`;
        ctx.fill();
      }

      rafRef.current = window.requestAnimationFrame(draw);
    };

    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
      mouseRef.current.active = true;
    };

    const onMouseLeave = () => {
      mouseRef.current.active = false;
    };

    resize();
    rafRef.current = window.requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    return () => {
      window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}

function useTypewriter(phrases, options) {
  const { typingMs = 34, deletingMs = 18, holdMs = 1100 } = options ?? {};

  const [phraseIndex, setPhraseIndex] = useState(0);
  const [subIndex, setSubIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!Array.isArray(phrases) || phrases.length === 0) return undefined;

    const current = phrases[phraseIndex % phrases.length];
    const isDoneTyping = !isDeleting && subIndex === current.length;
    const isDoneDeleting = isDeleting && subIndex === 0;

    let nextDelay = isDeleting ? deletingMs : typingMs;
    if (isDoneTyping) nextDelay = holdMs;

    const t = window.setTimeout(() => {
      if (isDoneTyping) {
        setIsDeleting(true);
        return;
      }

      if (isDoneDeleting) {
        setIsDeleting(false);
        setPhraseIndex((v) => (v + 1) % phrases.length);
        return;
      }

      setSubIndex((v) => v + (isDeleting ? -1 : 1));
    }, nextDelay);

    return () => window.clearTimeout(t);
  }, [phrases, phraseIndex, subIndex, isDeleting, typingMs, deletingMs, holdMs]);

  const current = phrases?.[phraseIndex % (phrases?.length || 1)] ?? '';
  return current.slice(0, subIndex);
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
};

const MotionDiv = motion.div;

export default function Landing() {
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

  const phrases = useMemo(
    () => [
      'Watch activity live.',
      'Get alerts when something looks off.',
      'Ask the assistant for help.',
    ],
    [],
  );

  const typed = useTypewriter(phrases, { typingMs: 32, deletingMs: 18, holdMs: 1150 });

  const features = useMemo(
    () => [
      {
        icon: Radar,
        title: 'Live Monitoring',
        body: 'See what’s happening right now, in a simple view.',
      },
      {
        icon: Cpu,
        title: 'AI Engine',
        body: 'It checks patterns and flags unusual behavior for you.',
      },
      {
        icon: Globe2,
        title: '3D Globe',
        body: 'See where traffic is coming from around the world.',
      },
      {
        icon: Bot,
        title: 'Chat Assistant',
        body: 'Ask simple questions and get clear answers and next steps.',
      },
    ],
    [],
  );

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* Moving background (subtle) */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.65]">
          <ParticleNetwork />
        </div>

        <div
          className="absolute -top-24 -left-24 h-80 w-80 rounded-full blur-2xl bg-tracel-accent-blue/[0.26]"
          style={{ animation: 'tracelFloat 18s ease-in-out infinite' }}
        />
        <div
          className="absolute top-10 -right-28 h-96 w-96 rounded-full blur-2xl bg-tracel-accent-purple/[0.26]"
          style={{ animation: 'tracelFloat 22s ease-in-out infinite' }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-screen-2xl p-4 sm:p-6">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg border border-zinc-800 bg-zinc-950 grid place-items-center">
              <ShieldAlert className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="text-[20px] uppercase tracking-[0.28em] text-slate-400">TRACEL</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300">
          </div>
        </div>

        {/* Hero */}
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <MotionDiv
            className="lg:col-span-7"
            variants={fadeUp}
            initial="hidden"
            animate="show"
          >
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-slate-200 border border-white/10 bg-white/5">
              <Sparkles className="h-4 w-4 text-tracel-accent-purple" />
              <span className="data-mono">Real-time • AI • Forensics</span>
            </div>

            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold text-white leading-[1.05] tracking-tight">
              See what’s happening.
              <span className="block text-zinc-300">Know what to do next.</span>
            </h1>

            <p className="mt-4 text-slate-300 leading-relaxed max-w-xl">
              TRACEL helps you watch your network in real time. If something looks unusual, it helps you
              understand it and take action.
            </p>
            <div className="mt-5 text-sm sm:text-base text-slate-200">
              <span className="data-mono">
                {typed}
                <span className="tracel-caret" aria-hidden="true">
                  |
                </span>
              </span>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link
                to="/dashboard"
                className="btn-primary"
              >
                Enter Live Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>

              <SignedOut>
                <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                  <button className="btn-secondary">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                  <button className="btn-primary">
                    Create Account
                  </button>
                </SignUpButton>
              </SignedOut>
            </div>
          </MotionDiv>

          {/* Right bento: calm snapshot */}
          <MotionDiv
            className="lg:col-span-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.08 }}
          >
            <div className="glass-card glow-hover p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400">Command Snapshot</div>
                  <div className="mt-1 text-white font-medium">At a glance</div>
                </div>
                <div className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <span className="pulse-dot" />
                  <span className="data-mono">LIVE</span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="glass rounded-lg border border-zinc-800 p-4">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Streams</div>
                  <div className="mt-1 text-white font-semibold data-mono">Live</div>
                  <div className="mt-1 text-xs text-slate-300">Updates as they happen</div>
                </div>
                <div className="glass rounded-lg border border-zinc-800 p-4">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Detection</div>
                  <div className="mt-1 text-white font-semibold data-mono">Alerts</div>
                  <div className="mt-1 text-xs text-slate-300">Flags unusual activity</div>
                </div>
                <div className="glass rounded-lg border border-zinc-800 p-4">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Response</div>
                  <div className="mt-1 text-white font-semibold data-mono">See who it was </div>
                  <div className="mt-1 text-xs text-slate-300">See where it came from</div>
                </div>
                <div className="glass rounded-lg border border-zinc-800 p-4">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Investigate</div>
                  <div className="mt-1 text-white font-semibold data-mono">Tracer Chatbot</div>
                  <div className="mt-1 text-xs text-slate-300">Summarises every detail</div>
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="text-xs text-slate-300">
                  <span className="text-slate-400">Tip:</span> If you’re unsure, ask the assistant: “What should
                  I check first?”
                </div>
              </div>
            </div>
          </MotionDiv>
        </div>

        {/* Feature grid */}
        <MotionDiv
          className="mt-14"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ show: { transition: { staggerChildren: 0.06 } } }}
        >
          <MotionDiv variants={fadeUp} className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Capabilities</div>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold text-white">Everything you need, in one view</h2>
              <p className="mt-2 text-slate-300 max-w-2xl">
                Start simple: watch live activity and click into details only when you need to.
              </p>
            </div>
            <Link
              to="/about"
              className="hidden sm:inline-flex items-center gap-2 text-sm text-slate-200 hover:text-white transition"
            >
              See how it works <ArrowRight className="h-4 w-4" />
            </Link>
          </MotionDiv>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <MotionDiv
                  key={f.title}
                  variants={fadeUp}
                  className="glass-card kpi-tile p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 grid place-items-center">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="text-white font-medium">{f.title}</div>
                  </div>
                  <div className="mt-3 text-sm text-slate-300 leading-relaxed">{f.body}</div>
                </MotionDiv>
              );
            })}
          </div>
        </MotionDiv>

        {/* Glass tiles (quick access) */}
        <MotionDiv
          className="mt-12"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ show: { transition: { staggerChildren: 0.06 } } }}
        >
          <MotionDiv variants={fadeUp} className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Explore</div>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold text-white">Jump into the tools</h2>
              <p className="mt-2 text-slate-300 max-w-2xl">
                Glass tiles that match the dashboard — quick entry points to the core views.
              </p>
            </div>
          </MotionDiv>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <MotionDiv variants={fadeUp}>
              <Link
                to="/dashboard"
                className="glass-card kpi-tile p-4 block"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 grid place-items-center">
                    <Radar className="h-5 w-5 text-white" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-4 text-white font-medium">Live Dashboard</div>
                <div className="mt-1 text-sm text-slate-300">Watch traffic, alerts, and activity in real time.</div>
              </Link>
            </MotionDiv>

            <MotionDiv variants={fadeUp}>
              <Link
                to="/forensics"
                className="glass-card kpi-tile p-4 block"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 grid place-items-center">
                    <ShieldAlert className="h-5 w-5 text-white" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-4 text-white font-medium">Forensics</div>
                <div className="mt-1 text-sm text-slate-300">Zoom in on events and understand what happened.</div>
              </Link>
            </MotionDiv>

            <MotionDiv variants={fadeUp}>
              <Link
                to="/settings"
                className="glass-card kpi-tile p-4 block"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 grid place-items-center">
                    <Cpu className="h-5 w-5 text-white" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-4 text-white font-medium">Settings</div>
                <div className="mt-1 text-sm text-slate-300">Tune simulation and monitoring behavior.</div>
              </Link>
            </MotionDiv>

            <MotionDiv variants={fadeUp}>
              <Link
                to="/about"
                className="glass-card kpi-tile p-4 block"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 grid place-items-center">
                    <Globe2 className="h-5 w-5 text-white" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-4 text-white font-medium">How it works</div>
                <div className="mt-1 text-sm text-slate-300">Architecture, stack, and a quick tour.</div>
              </Link>
            </MotionDiv>
          </div>
        </MotionDiv>

        {/* Tech / capability marquee */}
        <div className="mt-14">
          <div className="text-xs uppercase tracking-wider text-slate-400">What you can do</div>
          <div className="mt-3 glass-card p-4">
            <div className="tracel-marquee" aria-label="TRACEL capabilities marquee">
              <div className="tracel-marquee__track">
                {[
                  'Live dashboard',
                  'Alerts',
                  'Map view',
                  'Chat help',
                  'Investigation',
                  'Reports',
                ].map((t) => (
                  <div
                    key={`m1-${t}`}
                    className="pill pill-neutral"
                  >
                    <span className="data-mono">{t}</span>
                  </div>
                ))}
                {[
                  'Live dashboard',
                  'Alerts',
                  'Map view',
                  'Chat help',
                  'Investigation',
                  'Reports',
                ].map((t) => (
                  <div
                    key={`m2-${t}`}
                    className="pill pill-neutral"
                  >
                    <span className="data-mono">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Final CTA + footer */}
        <div className="mt-14">
          <div className="glass-card glow-hover p-6 sm:p-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Ready</div>
                <div className="mt-2 text-2xl sm:text-3xl font-semibold text-white">
                  Start with the live dashboard
                </div>
                <div className="mt-2 text-slate-300 max-w-2xl">
                  You don’t need to learn everything on day one. Just open the dashboard and explore.
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  to="/dashboard"
                  className="btn-primary"
                >
                  Open Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <Link
                  to="/about"
                  className="btn-secondary"
                >
                  Quick Tour
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-400">
            <div className="data-mono">TRACEL</div>

            {hasAnyLink ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Connect</div>
                  <div className="text-xs text-slate-200 max-w-[420px] truncate">
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-semibold text-slate-100">
                      {creator.name ? creator.name : 'Creator'}
                    </span>
                    {creator.tagline ? <span className="text-slate-400"> — {creator.tagline}</span> : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {creator.links.website ? (
                    <a
                      href={creator.links.website}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Website"
                      title="Website"
                      className="nav-tile h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 transition grid place-items-center"
                    >
                      <Globe className="w-5 h-5 text-slate-100" />
                    </a>
                  ) : null}
                  {creator.links.github ? (
                    <a
                      href={creator.links.github}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="GitHub"
                      title="GitHub"
                      className="nav-tile h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 transition grid place-items-center"
                    >
                      <Github className="w-5 h-5 text-slate-100" />
                    </a>
                  ) : null}
                  {creator.links.linkedin ? (
                    <a
                      href={creator.links.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="LinkedIn"
                      title="LinkedIn"
                      className="nav-tile h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 transition grid place-items-center"
                    >
                      <Linkedin className="w-5 h-5 text-slate-100" />
                    </a>
                  ) : null}
                  {creator.links.x ? (
                    <a
                      href={creator.links.x}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="X (Twitter)"
                      title="X (Twitter)"
                      className="nav-tile h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 transition grid place-items-center"
                    >
                      <Twitter className="w-5 h-5 text-slate-100" />
                    </a>
                  ) : null}
                  {creator.links.email ? (
                    <a
                      href={`mailto:${creator.links.email}`}
                      aria-label="Email"
                      title="Email"
                      className="nav-tile h-10 w-10 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 transition grid place-items-center"
                    >
                      <Mail className="w-5 h-5 text-slate-100" />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
