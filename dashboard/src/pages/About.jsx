import {
  Activity,
  ArrowRight,
  Brain,
  Globe,
  Github,
  Info,
  Linkedin,
  Mail,
  MessageCircle,
  Package,
  BarChart3,
  Route,
  Server,
  ShieldAlert,
  Twitter,
  Webhook,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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

function FlowNode({ title, subtitle, icon, tone, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "group nav-tile w-full h-full min-h-[92px] text-left glass rounded-2xl border border-white/10 p-4 transition hover-lift hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-tracel-accent-blue/60 " +
        (selected ? "bg-white/10 ring-1 ring-tracel-accent-blue/35" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={
              "h-10 w-10 rounded-xl border border-white/10 flex items-center justify-center " +
              (tone || "bg-white/5")
            }
          >
            {icon}
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-tight">{title}</div>
            <div className="text-xs text-slate-400">{subtitle}</div>
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-end gap-1">
          <span
            className={
              "inline-flex items-center gap-2 text-[10px] uppercase tracking-wider " +
              (selected ? "text-slate-300" : "text-gray-500")
            }
          >
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (selected
                  ? "bg-tracel-accent-blue/60"
                  : "bg-white/20 group-hover:bg-tracel-accent-blue/40")
              }
            />
            <span className="sr-only">{selected ? "Focused" : "Select"}</span>
          </span>
        </div>
      </div>
    </button>
  );
}

function FlowConnector({ active }) {
  return (
    <div className="hidden md:flex items-center justify-center px-1">
      <div className="flex items-center gap-2">
        <span
          className={
            "h-px w-8 rounded-full " +
            (active
              ? "bg-gradient-to-r from-tracel-accent-blue/50 to-tracel-accent-purple/40"
              : "bg-white/10")
          }
        />
        <ArrowRight
          className={
            "w-4 h-4 " +
            (active ? "text-tracel-accent-blue/70" : "text-gray-600")
          }
        />
      </div>
    </div>
  );
}

function DataFlow() {
  const nodes = useMemo(
    () =>
      [
        {
          id: 'simulator',
          title: 'Simulator',
          subtitle: 'Creates sample traffic',
          icon: <Activity className="w-5 h-5 text-emerald-300" />,
          tone: 'bg-emerald-400/10',
          summary: 'Makes a steady stream of normal activity, and can also create sudden “attack-like” bursts for testing.',
          inputs: ['Traffic settings', 'Attack mode on/off'],
          outputs: ['Live activity events', 'Attack bursts for demos'],
        },
        {
          id: 'traffic',
          title: 'Traffic Server',
          subtitle: 'Live traffic hub',
          icon: <Webhook className="w-5 h-5 text-slate-200" />,
          tone: 'bg-tracel-accent-blue/10',
          summary:
            'Collects the live activity, adds useful info (like risk), and sends it to your dashboard instantly.',
          inputs: ['Live activity from the simulator', 'Optional “risk score” from AI', 'Who is viewing (signed-in user or guest)'],
          outputs: ['Live stream for the dashboard', 'History/search data (when storage is on)', 'Threat snapshot (last 24 hours)'],
        },
        {
          id: 'dashboard',
          title: 'Dashboard',
          subtitle: 'What you see in the app',
          icon: <Globe className="w-5 h-5 text-tracel-accent-blue" />,
          tone: 'bg-white/5',
          summary:
            'Shows live charts, alerts, and locations. You can also review past activity and get quick help from the assistant.',
          inputs: ['Live activity updates', 'Saved history (optional)', 'Threat snapshot'],
          outputs: ['Live monitoring screens', 'Investigation tools', 'Assistant answers'],
        },
        {
          id: 'ai',
          title: 'AI Scoring',
          subtitle: 'Smart risk detection',
          icon: <Brain className="w-5 h-5 text-amber-300" />,
          tone: 'bg-amber-400/10',
          summary:
            'Looks at patterns in the activity and flags unusual behavior so you can spot possible threats faster.',
          inputs: ['Activity details'],
          outputs: ['Risk score', 'Unusual/normal decision'],
        },
        {
          id: 'chat',
          title: 'Chat Assistant',
          subtitle: 'Ask questions anytime',
          icon: <MessageCircle className="w-5 h-5 text-tracel-accent-purple" />,
          tone: 'bg-tracel-accent-purple/10',
          summary:
            'Lets you ask simple questions about what you’re seeing and get quick guidance during investigations.',
          inputs: ['Your question', 'Recent activity context (when available)'],
          outputs: ['Helpful answers', 'Suggested next steps'],
        },
      ],
    []
  );

  const [activeId, setActiveId] = useState('traffic');
  const active = nodes.find((n) => n.id === activeId) || nodes[1];

  const isMainPath = (id) => id === 'simulator' || id === 'traffic' || id === 'dashboard';
  const connectorActive = (leftId, rightId) => {
    if (!isMainPath(leftId) || !isMainPath(rightId)) return false;
    if (activeId === leftId || activeId === rightId) return true;
    if (activeId === 'traffic') return true;
    return false;
  };

  return (
    <div className="mt-4 glass rounded-2xl border border-white/10 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400 uppercase tracking-wider">Data flow</div>
          <div className="mt-1 text-sm text-slate-200">
            Click a node to inspect inputs, outputs, and behavior.
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-tracel-accent-blue/50" />
            Streaming
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/40" />
            Processing
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-tracel-accent-purple/40" />
            Storage
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Diagram */}
        <div className="lg:col-span-7 lg:h-[360px] lg:flex lg:flex-col">
          {/* Main path */}
          <div className="flex flex-col md:flex-row md:items-stretch gap-3 lg:flex-none">
            <div className="md:basis-[28%] md:flex-none">
              <FlowNode
                {...nodes[0]}
                selected={activeId === 'simulator'}
                onSelect={() => setActiveId('simulator')}
              />
            </div>
            <FlowConnector active={connectorActive('simulator', 'traffic')} />
            <div className="flex-1">
              <FlowNode
                {...nodes[1]}
                selected={activeId === 'traffic'}
                onSelect={() => setActiveId('traffic')}
              />
            </div>
            <FlowConnector active={connectorActive('traffic', 'dashboard')} />
            <div className="flex-1">
              <FlowNode
                {...nodes[2]}
                selected={activeId === 'dashboard'}
                onSelect={() => setActiveId('dashboard')}
              />
            </div>
          </div>

          {/* Side channels */}
          <div className="mt-4 glass rounded-2xl border border-white/10 p-4 lg:mt-4 lg:flex-1 lg:min-h-0 lg:overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 flex-none">
              <div className="text-xs text-slate-400 uppercase tracking-wider">Side channels</div>
              <div className="text-[10px] text-gray-500">Attached to the server during processing</div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2 gap-3 flex-1 min-h-0">
              <FlowNode
                title={nodes[3].title}
                subtitle={nodes[3].subtitle}
                icon={nodes[3].icon}
                tone={nodes[3].tone}
                selected={activeId === 'ai'}
                onSelect={() => setActiveId('ai')}
              />
              <FlowNode
                title={nodes[4].title}
                subtitle={nodes[4].subtitle}
                icon={nodes[4].icon}
                tone={nodes[4].tone}
                selected={activeId === 'chat'}
                onSelect={() => setActiveId('chat')}
              />
            </div>
          </div>
        </div>

        {/* Details panel */}
        <div className="lg:col-span-5">
          <div className="glass rounded-2xl border border-white/10 p-4 h-[320px] sm:h-[340px] lg:h-[360px] overflow-hidden">
            <div className="h-full flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white">{active.title}</div>
                  <div className="text-xs text-slate-400">{active.subtitle}</div>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl border border-white/10 bg-black/40 flex items-center justify-center">
                    {active.icon}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex-1 overflow-y-auto pr-1">
                <p className="text-sm text-slate-200 leading-relaxed">{active.summary}</p>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Inputs</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {active.inputs.map((it) => (
                        <span
                          key={it}
                          className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200"
                        >
                          {it}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Outputs</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {active.outputs.map((it) => (
                        <span
                          key={it}
                          className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200"
                        >
                          {it}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Tip: Use <span className="text-slate-300">Tab</span> to focus nodes and <span className="text-slate-300">Enter</span> to select.
              </div>
            </div>
          </div>
        </div>
      </div>
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

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="glass-card glow-hover p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl border border-white/10 bg-gradient-to-br from-tracel-accent-blue/20 to-tracel-accent-purple/20 flex items-center justify-center">
              <Info className="w-5 h-5 text-slate-100" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white tracking-tight">About</h2>
              <p className="mt-1 text-xs text-slate-400">A simple overview of what Tracel does.</p>
            </div>
          </div>

          {(creator.links.website ||
            creator.links.github ||
            creator.links.linkedin ||
            creator.links.x ||
            creator.links.email) ? (
            <div className="hidden sm:flex items-center gap-3">
              <div className="hidden md:block text-right">
                <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Connect</div>
                <div className="text-xs text-slate-200">
                  {creator.name ? creator.name : 'Creator'}
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
                    className="nav-tile h-10 w-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
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
                    className="nav-tile h-10 w-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
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
                    className="nav-tile h-10 w-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
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
                    className="nav-tile h-10 w-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
                  >
                    <Twitter className="w-5 h-5 text-slate-100" />
                  </a>
                ) : null}

                {creator.links.email ? (
                  <a
                    href={`mailto:${creator.links.email}`}
                    aria-label="Email"
                    title="Email"
                    className="nav-tile h-10 w-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition grid place-items-center"
                  >
                    <Mail className="w-5 h-5 text-slate-100" />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="glass-card glow-hover p-6 sm:p-7 hover-lift interactive animate-fade-up">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Tracel — Real‑Time Threat Monitoring</h3>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              Tracel is a real-time monitoring app that helps you see what’s happening on a network and spot
              suspicious activity early. It shows live activity, highlights unusual behavior, and gives you tools
              to review and understand incidents.
              <span className="text-slate-300"> It works for both signed-in users and guests, includes a “last 24 hours” threat snapshot, and has a built-in assistant to help you investigate faster.</span>
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-slate-200" />
            </div>
            <div className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center">
              <Webhook className="w-5 h-5 text-slate-200" />
            </div>
            <div className="h-10 w-10 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center">
              <Brain className="w-5 h-5 text-gray-200" />
            </div>
          </div>
        </div>

        {/* Data flow */}
        <DataFlow />
      </div>

      {/* Tech stack (brand icons) */}
      <div className="glass-card glow-hover p-6 sm:p-7 hover-lift interactive animate-fade-up">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Tech stack</h3>
            <p className="mt-1 text-xs text-slate-400">Core libraries and services used in this project.</p>
          </div>
        </div>

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
  );
}
