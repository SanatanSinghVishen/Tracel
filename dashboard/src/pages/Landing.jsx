import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  Cpu,
  Globe2,
  Radar,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { SignedOut, SignInButton, SignUpButton } from '@clerk/clerk-react';

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
    const pointCountForArea = (w, h) => Math.max(52, Math.min(110, Math.floor((w * h) / 19000)));
    const linkDistForArea = (w, h) => Math.max(90, Math.min(160, Math.floor(Math.min(w, h) * 0.22)));

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
          vx: rand(-0.28, 0.28),
          vy: rand(-0.26, 0.26),
          r: rand(1.1, 2.0),
        });
      }
    };

    const draw = (timeMs) => {
      const t = timeMs * 0.001;
      const linkDist = linkDistForArea(width, height);
      const linkDist2 = linkDist * linkDist;

      ctx.clearRect(0, 0, width, height);

      // Soft vignette
      const vg = ctx.createRadialGradient(width * 0.55, height * 0.35, 10, width * 0.55, height * 0.35, Math.max(width, height) * 0.72);
      vg.addColorStop(0, 'rgba(59,130,246,0.12)');
      vg.addColorStop(0.45, 'rgba(139,92,246,0.08)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);

      // Points + motion
      for (const p of points) {
        if (!reduceMotionRef.current) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -10) p.x = width + 10;
          if (p.x > width + 10) p.x = -10;
          if (p.y < -10) p.y = height + 10;
          if (p.y > height + 10) p.y = -10;
        }
      }

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const mouseActive = mouseRef.current.active;

      // Links
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
          const alpha = (1 - dist / linkDist) * 0.22;

          const gx = (a.x + b.x) * 0.5;
          const gy = (a.y + b.y) * 0.5;
          const hueShift = 0.5 + 0.5 * Math.sin(t * 0.35 + gx * 0.002);
          const c1 = `rgba(59,130,246,${alpha * (0.55 + hueShift * 0.45)})`;
          const c2 = `rgba(139,92,246,${alpha * (0.55 + (1 - hueShift) * 0.45)})`;

          const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          grad.addColorStop(0, c1);
          grad.addColorStop(1, c2);
          ctx.strokeStyle = grad;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();

          // Slight highlight near mouse
          if (mouseActive) {
            const mdx = gx - mx;
            const mdy = gy - my;
            const md2 = mdx * mdx + mdy * mdy;
            if (md2 < 140 * 140) {
              ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.25})`;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }

      // Dots
      for (const p of points) {
        const mdx = p.x - mx;
        const mdy = p.y - my;
        const md2 = mdx * mdx + mdy * mdy;
        const boost = mouseActive ? Math.max(0, 1 - Math.sqrt(md2) / 240) : 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + boost * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.26 + boost * 0.32})`;
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

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
};

const MotionDiv = motion.div;

export default function Landing() {
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
      {/* Background: particle network + soft orbs */}
      <div className="pointer-events-none absolute inset-0">
        <ParticleNetwork />

        <div
          className="absolute -top-24 -left-24 h-80 w-80 rounded-full blur-3xl opacity-35"
          style={{
            background: 'radial-gradient(circle at 30% 30%, rgba(59,130,246,0.40), rgba(59,130,246,0) 60%)',
            animation: 'tracelFloat 16s ease-in-out infinite',
          }}
        />
        <div
          className="absolute top-24 -right-28 h-96 w-96 rounded-full blur-3xl opacity-30"
          style={{
            background: 'radial-gradient(circle at 30% 30%, rgba(139,92,246,0.40), rgba(139,92,246,0) 60%)',
            animation: 'tracelFloat 20s ease-in-out infinite',
          }}
        />
        <div
          className="absolute bottom-[-160px] left-1/3 h-[540px] w-[540px] rounded-full blur-3xl opacity-15"
          style={{
            background: 'radial-gradient(circle at 30% 30%, rgba(59,130,246,0.26), rgba(139,92,246,0.20), rgba(0,0,0,0) 65%)',
            animation: 'tracelFloat 24s ease-in-out infinite',
          }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-6 pt-10 pb-16 sm:pt-12 sm:pb-20">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative h-11 w-11 rounded-2xl glass flex items-center justify-center">
              <div className="absolute inset-0 rounded-2xl opacity-75 bg-gradient-to-br from-tracel-accent-blue/30 to-tracel-accent-purple/30" />
              <ShieldAlert className="relative h-6 w-6 text-white" />
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
              <span className="data-mono">Real-time • AI • Forensics • Globe</span>
            </div>

            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold text-white leading-[1.05] tracking-tight">
              See what’s happening.
              <span className="block bg-gradient-to-r from-tracel-accent-blue to-tracel-accent-purple bg-clip-text text-transparent">
                Know what to do next.
              </span>
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
                className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium text-white border border-white/10 bg-gradient-to-r from-tracel-accent-blue/25 to-tracel-accent-purple/25 hover:from-tracel-accent-blue/35 hover:to-tracel-accent-purple/35 transition hover-lift"
              >
                Enter Live Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>

              <SignedOut>
                <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                  <button className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium text-slate-200 border border-white/10 bg-white/5 hover:bg-white/10 transition hover-lift">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                  <button className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium text-white border border-white/10 bg-gradient-to-r from-tracel-accent-blue/20 to-tracel-accent-purple/20 hover:from-tracel-accent-blue/30 hover:to-tracel-accent-purple/30 transition hover-lift">
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
            <div className="glass-card animated-border p-5 sm:p-6">
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
                <div className="glass rounded-2xl border border-white/10 p-4 kpi-tile">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Streams</div>
                  <div className="mt-1 text-white font-semibold data-mono">Live</div>
                  <div className="mt-1 text-xs text-slate-300">Updates as they happen</div>
                </div>
                <div className="glass rounded-2xl border border-white/10 p-4 kpi-tile">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Detection</div>
                  <div className="mt-1 text-white font-semibold data-mono">Alerts</div>
                  <div className="mt-1 text-xs text-slate-300">Flags unusual activity</div>
                </div>
                <div className="glass rounded-2xl border border-white/10 p-4 kpi-tile">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Response</div>
                  <div className="mt-1 text-white font-semibold data-mono">See who it was </div>
                  <div className="mt-1 text-xs text-slate-300">See where it came from</div>
                </div>
                <div className="glass rounded-2xl border border-white/10 p-4 kpi-tile">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">Investigate</div>
                  <div className="mt-1 text-white font-semibold data-mono">Tracer Chatbot</div>
                  <div className="mt-1 text-xs text-slate-300">Summarises every detail</div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 hud-scan">
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
                  className="glass rounded-2xl border border-white/10 p-5 glow-hover"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative h-10 w-10 rounded-2xl glass flex items-center justify-center">
                      <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-60 bg-gradient-to-br from-tracel-accent-blue/20 to-tracel-accent-purple/20" />
                      <Icon className="relative h-5 w-5 text-white" />
                    </div>
                    <div className="text-white font-medium">{f.title}</div>
                  </div>
                  <div className="mt-3 text-sm text-slate-300 leading-relaxed">{f.body}</div>
                </MotionDiv>
              );
            })}
          </div>
        </MotionDiv>

        {/* Tech / capability marquee */}
        <div className="mt-14">
          <div className="text-xs uppercase tracking-wider text-slate-400">What you can do</div>
          <div className="mt-3 glass rounded-2xl border border-white/10 p-4">
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
                    className="inline-flex items-center rounded-full px-3 py-1.5 text-xs border border-white/10 bg-white/5 text-slate-200"
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
                    className="inline-flex items-center rounded-full px-3 py-1.5 text-xs border border-white/10 bg-white/5 text-slate-200"
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
          <div className="glass-card animated-border p-6 sm:p-8">
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
                  className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium text-white border border-white/10 bg-gradient-to-r from-tracel-accent-blue/25 to-tracel-accent-purple/25 hover:from-tracel-accent-blue/35 hover:to-tracel-accent-purple/35 transition hover-lift"
                >
                  Open Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <Link
                  to="/about"
                  className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-medium text-slate-200 border border-white/10 bg-white/5 hover:bg-white/10 transition hover-lift"
                >
                  Quick Tour
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-400">
            <div className="data-mono">TRACEL</div>
          </div>
        </div>
      </div>
    </div>
  );
}
