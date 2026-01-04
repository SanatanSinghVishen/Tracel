import {
  Activity,
  ArrowRight,
  BarChart3,
  Brain,
  Globe,
  Github,
  Linkedin,
  Mail,
  MessageCircle,
  Package,
  Route,
  Server,
  ShieldAlert,
  Twitter,
  Webhook,
} from 'lucide-react';
import {
  SiExpress,
  SiFlask,
  SiMongodb,
  SiMongoose,
  SiNodedotjs,
  SiPython,
  SiReact,
  SiScikitlearn,
  SiSocketdotio,
  SiTailwindcss,
  SiThreedotjs,
  SiVite,
} from 'react-icons/si';
function SectionHeader({ kicker, title, subtitle, icon }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        {kicker ? (
          <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">{kicker}</div>
        ) : null}
        <div className="mt-1 text-lg font-bold text-white tracking-tight">{title}</div>
        {subtitle ? <div className="mt-1 text-xs text-slate-400">{subtitle}</div> : null}
      </div>
      {icon ? (
        <div className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 grid place-items-center shrink-0">
          {icon}
        </div>
      ) : null}
    </div>
  );
}

function Pill({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-200">
      {children}
    </span>
  );
}

function FeatureCard({ icon, title, body }) {
  return (
    <div className="glass rounded-2xl border border-white/10 p-4 hover-lift transition">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-2xl border border-white/10 bg-black/20 grid place-items-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-slate-400 leading-relaxed">{body}</div>
        </div>
      </div>
    </div>
  );
}

function StepCard({ step, title, subtitle, icon, bullets }) {
  return (
    <div className="glass rounded-2xl border border-white/10 p-4 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-slate-400">
            <span className="h-5 w-5 rounded-full border border-white/10 bg-white/5 grid place-items-center text-[10px] text-slate-200">
              {step}
            </span>
            <span>Step</span>
          </div>
          <div className="mt-2 text-sm font-semibold text-white">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-slate-400">{subtitle}</div> : null}
        </div>

        <div className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 grid place-items-center shrink-0">
          {icon}
        </div>
      </div>

      {Array.isArray(bullets) && bullets.length ? (
        <div className="mt-3 grid gap-2">
          {bullets.map((b) => (
            <div key={b} className="flex items-start gap-2 text-xs text-slate-300 leading-relaxed">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-white/20 shrink-0" />
              <span className="min-w-0">{b}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function About() {
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

  return (
    <div className="min-w-0 animate-fade-in">
      <div className="space-y-4 sm:space-y-6">
        {/* Hero */}
        <div className="glass-card glow-hover p-6 sm:p-7 relative pb-16 sm:pb-18">
          <div className="flex flex-col lg:flex-row lg:items-start gap-6">
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-200">
                <span className="h-1.5 w-1.5 rounded-full bg-tracel-accent-blue/60" />
                <span>About Tracel</span>
              </div>

              <h1 className="mt-4 text-3xl sm:text-4xl font-semibold text-white tracking-tight">
                Real‑time monitoring, with easy explanations.
              </h1>

              <p className="mt-3 text-sm text-slate-300 leading-relaxed max-w-2xl">
                Tracel is a real-time network security platform that transforms raw traffic into actionable intelligence.
                Using an advanced Isolation Forest AI engine, it instantly scrutinizes every data packet to distinguish between routine operations and critical threats like DDoS attacks.
                The immersive dashboard visualizes this activity through live rolling charts and an interactive 3D globe, offering immediate situational awareness without the need for static logs.
                Equipped with deep forensic tools, a realistic attack simulator, and a context-aware AI assistant, Tracel provides complete command over your network’s security posture from a single, modern interface.
              </p>
            </div>

            {/* Snapshot */}
            <div className="lg:w-[420px] w-full">
              <div className="glass rounded-2xl border border-white/10 p-4 sm:p-5">
                <SectionHeader
                  kicker="Snapshot"
                  title="What happens to each packet"
                  subtitle="From activity → score → decision → what you see"
                  icon={<ShieldAlert className="w-5 h-5 text-slate-200" />}
                />

                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
                      <Brain className="w-4 h-4 text-amber-300" />
                      AI Engine
                    </div>
                    <div className="mt-1 text-xs text-slate-400 leading-relaxed">
                      Looks at the packet details (like size, type, ports, and patterns) and returns a single
                      score. A lower score means it looks more suspicious.
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
                      <Server className="w-4 h-4 text-slate-200" />
                      Traffic Server
                    </div>
                    <div className="mt-1 text-xs text-slate-400 leading-relaxed">
                      Collects live activity, asks the AI for a score, and learns what “normal” looks like while
                      you run the app. Then it decides SAFE or THREAT and streams the result to your dashboard.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {hasAnyLink ? (
            <div className="absolute left-6 bottom-5 sm:left-7 sm:bottom-6">
              <div className="flex items-center gap-3">
                <div className="hidden sm:block min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Connect</div>
                  <div className="text-xs text-slate-200 max-w-[340px] truncate">
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
                      className="nav-tile h-10 w-10 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
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
                      className="nav-tile h-10 w-10 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
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
                      className="nav-tile h-10 w-10 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
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
                      className="nav-tile h-10 w-10 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
                    >
                      <Twitter className="w-5 h-5 text-slate-100" />
                    </a>
                  ) : null}
                  {creator.links.email ? (
                    <a
                      href={`mailto:${creator.links.email}`}
                      aria-label="Email"
                      title="Email"
                      className="nav-tile h-10 w-10 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
                    >
                      <Mail className="w-5 h-5 text-slate-100" />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Architecture strip */}
        <div className="glass-card glow-hover p-6 sm:p-7 hover-lift interactive animate-fade-up">
          <SectionHeader
            kicker="Architecture"
            title="Simple flow: score, then decision"
            subtitle="AI scores it. The server decides. You can understand what happened."
            icon={<Webhook className="w-5 h-5 text-slate-200" />}
          />

          <div className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-3">
              <StepCard
                step={1}
                title="Traffic"
                subtitle="Live activity (or demo traffic)"
                icon={<Activity className="w-5 h-5 text-emerald-300" />}
                bullets={[
                  "Sends activity in real time",
                  "Can simulate attack-like spikes for demos",
                ]}
              />
            </div>

            <div className="hidden md:flex md:col-span-1 items-center justify-center">
              <ArrowRight className="w-5 h-5 text-white/25" />
            </div>

            <div className="md:col-span-3">
              <StepCard
                step={2}
                title="AI score"
                subtitle="A quick suspiciousness score"
                icon={<Brain className="w-5 h-5 text-amber-300" />}
                bullets={["Returns one score per packet", "Lower score = more suspicious"]}
              />
            </div>

            <div className="hidden md:flex md:col-span-1 items-center justify-center">
              <ArrowRight className="w-5 h-5 text-white/25" />
            </div>

            <div className="md:col-span-4">
              <StepCard
                step={3}
                title="Final decision"
                subtitle="Learns what’s normal for you"
                icon={<Server className="w-5 h-5 text-slate-200" />}
                bullets={[
                  "Learns what “normal” looks like while you run it",
                  "Marks THREAT when the score looks clearly unusual",
                ]}
              />
            </div>
          </div>
        </div>

        {/* Experience */}
        <div className="glass-card glow-hover p-6 sm:p-7 hover-lift interactive animate-fade-up">
          <SectionHeader
            kicker="Experience"
            title="What you get in the dashboard"
            subtitle="A clean look — without hiding what matters."
            icon={<Globe className="w-5 h-5 text-tracel-accent-blue" />}
          />

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <FeatureCard
              icon={<BarChart3 className="w-5 h-5 text-emerald-300" />}
              title="Forensics AI Score tile"
              body="A live score chart that shows safe vs threat clearly. It keeps a small recent window so it stays fast and readable."
            />
            <FeatureCard
              icon={<ShieldAlert className="w-5 h-5 text-slate-200" />}
              title="Threat labeling"
              body="Shows SAFE or THREAT in a consistent way, even when you switch between normal monitoring and attack simulation."
            />
            <FeatureCard
              icon={<Webhook className="w-5 h-5 text-slate-200" />}
              title="Real-time streaming"
              body="Everything updates live (charts, maps, and alerts), so you don’t need to refresh." 
            />
            <FeatureCard
              icon={<MessageCircle className="w-5 h-5 text-tracel-accent-purple" />}
              title="Chat Assistant"
              body="Ask questions in plain language and get quick guidance while you investigate." 
            />
          </div>
        </div>

        {/* Tech stack */}
        <div className="glass-card glow-hover p-6 sm:p-7 hover-lift interactive animate-fade-up">
          <SectionHeader
            kicker="Stack"
            title="Built with familiar tools"
            subtitle="Simple building blocks so it stays reliable." 
            icon={<Package className="w-5 h-5 text-slate-200" />}
          />

          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass rounded-2xl border border-white/10 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Frontend</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiReact className="w-4 h-4 text-tracel-accent-blue" /> React
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiVite className="w-4 h-4 text-tracel-accent-purple" /> Vite
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiTailwindcss className="w-4 h-4 text-tracel-accent-blue" /> Tailwind
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <Route className="w-4 h-4 text-slate-100" /> Router
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiSocketdotio className="w-4 h-4 text-tracel-accent-purple" /> Socket.IO
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <BarChart3 className="w-4 h-4 text-emerald-300" /> Recharts
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiThreedotjs className="w-4 h-4 text-tracel-accent-purple" /> three.js
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <Globe className="w-4 h-4 text-tracel-accent-blue" /> Globe
                </div>
              </div>
            </div>

            <div className="glass rounded-2xl border border-white/10 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Backend</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiNodedotjs className="w-4 h-4 text-emerald-300" /> Node.js
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiExpress className="w-4 h-4 text-slate-100" /> Express
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiSocketdotio className="w-4 h-4 text-tracel-accent-purple" /> Socket.IO
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiMongodb className="w-4 h-4 text-emerald-300" /> MongoDB
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiMongoose className="w-4 h-4 text-tracel-accent-purple" /> Mongoose
                </div>
              </div>
            </div>

            <div className="glass rounded-2xl border border-white/10 p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wider">AI</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiPython className="w-4 h-4 text-amber-300" /> Python
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiFlask className="w-4 h-4 text-slate-100" /> Flask
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <SiScikitlearn className="w-4 h-4 text-amber-300" /> scikit-learn
                </div>
                <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 glass px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition">
                  <Package className="w-4 h-4 text-amber-300" /> joblib
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
