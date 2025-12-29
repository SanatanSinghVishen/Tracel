import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Bot, Sparkles, User, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { buildAuthHeaders, getOrCreateAnonId } from '../lib/authClient.js';
import { getServerUrl } from '../lib/socket.js';

const MotionButton = motion.button;
const MotionDiv = motion.div;
const MotionSpan = motion.span;

function uid() {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatAssistantText(raw) {
  let t = String(raw || '').replace(/\r\n/g, '\n');

  // Trim trailing spaces on lines + collapse excessive blank lines.
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');

  // If the model echoes our internal prompt labels, normalize to user-friendly headings.
  t = t.replace(/\bSECTION\s*1\s*\(Project Info\)\s*:\s*/gi, 'Project Info:\n');
  t = t.replace(/\bSECTION\s*2\s*\(Live Status\)\s*:\s*/gi, 'Live Status:\n');
  t = t.replace(/\bSECTION\s*2\s*\(Platform Knowledge\)\s*:\s*/gi, 'Platform Knowledge:\n');
  t = t.replace(/\bSECTION\s*3\s*\(Live Status\)\s*:\s*/gi, 'Live Status:\n');
  t = t.replace(/\bSECTION\s*4\s*\(Client Context, if provided\)\s*:\s*/gi, 'Client Context:\n');

  // Ensure headings are separated from previous content.
  t = t.replace(/(^|\n)(Project Info:)/g, '$1$2');
  t = t.replace(/(^|\n)(Live Status:)/g, '$1$2');
  t = t.replace(/(^|\n)(Platform Knowledge:)/g, '$1$2');
  t = t.replace(/(^|\n)(Client Context:)/g, '$1$2');

  // Strip common Markdown asterisk formatting.
  // Bold/italic: **text** or *text* -> text
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');

  // Bullet lists: "* item" -> "- item" (keep structure, remove asterisks)
  t = t.replace(/^\s*\*\s+/gm, '- ');

  // Remove leftover runs of asterisks used as separators.
  t = t.replace(/\*{2,}/g, '');

  return t.trim() || '—';
}

function getChatStorageKey(anonId) {
  const safe = String(anonId || '').trim() || 'anon';
  return `tracel_chat_history:${safe}`;
}

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return;
  } catch {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }
}

function ScanningWave() {
  const bars = useMemo(() => Array.from({ length: 18 }, (_, i) => i), []);
  return (
    <div className="flex items-center gap-2 text-xs text-slate-300">
      <span className="font-medium tracking-wider uppercase">Scanning...</span>
      <div className="flex items-end gap-1 h-4">
        {bars.map((i) => (
          <MotionSpan
            key={i}
            className="w-[3px] rounded-full bg-cyan-400/80 shadow-[0_0_12px_rgba(34,211,238,0.45)]"
            initial={false}
            animate={{
              height: [6, 16, 8, 14, 6],
              opacity: [0.55, 1, 0.7, 0.95, 0.55],
            }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.03,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function ChatAssistant({
  connection,
  stats,
  currentPacket,
  trafficView,
} = {}) {
  const { isLoaded, getToken } = useAuth();
  const anonId = useMemo(() => getOrCreateAnonId(), []);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');

  const initialMessages = useMemo(() => {
    const greeting = [
      {
        id: uid(),
        role: 'assistant',
        content:
          "Tracel AI online. Ask about the project stack, or request a live briefing (top attacker IP, country, traffic volume).",
        ts: Date.now(),
      },
    ];

    const key = getChatStorageKey(anonId);
    const raw = safeStorageGet(key);
    if (!raw) return greeting;

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return greeting;

      const normalized = parsed
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({
          id: typeof m.id === 'string' && m.id ? m.id : uid(),
          role: m.role === 'user' ? 'user' : 'assistant',
          content: typeof m.content === 'string' ? m.content : '',
          ts: typeof m.ts === 'number' ? m.ts : Date.now(),
          tone: m.tone === 'error' ? 'error' : undefined,
        }))
        .slice(-80);

      return normalized.length ? normalized : greeting;
    } catch {
      return greeting;
    }
  }, [anonId]);

  const [messages, setMessages] = useState(() => initialMessages);

  const [loading, setLoading] = useState(false);

  // Typewriter control
  const typingTimerRef = useRef(null);
  const typingStateRef = useRef({ targetId: null, fullText: '', idx: 0, speedMs: 12 });

  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Persist history so navigation doesn't wipe the conversation.
  const persistTimerRef = useRef(null);
  useEffect(() => {
    const key = getChatStorageKey(anonId);
    if (!key) return;

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      try {
        safeStorageSet(key, JSON.stringify(messages.slice(-80)));
      } catch {
        // ignore
      }
    }, 150);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [messages, anonId]);

  function scrollToBottom(behavior = 'smooth') {
    try {
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!open) return;
    scrollToBottom('auto');
    const t = setTimeout(() => inputRef.current?.focus?.(), 180);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    scrollToBottom('smooth');
  }, [messages, open, loading]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function stopTyping() {
    if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    typingTimerRef.current = null;
    typingStateRef.current = { targetId: null, fullText: '', idx: 0, speedMs: 12 };
  }

  function startTypewriter(targetId, fullText) {
    stopTyping();

    const clean = formatAssistantText(fullText);
    const baseSpeed = 10;
    const speedMs = clamp(baseSpeed + Math.floor(clean.length / 120), 10, 22);

    typingStateRef.current = { targetId, fullText: clean, idx: 0, speedMs };

    typingTimerRef.current = setInterval(() => {
      const st = typingStateRef.current;
      if (!st.targetId) return;

      st.idx += 1;
      const nextChunk = st.fullText.slice(0, st.idx);

      setMessages((prev) => prev.map((m) => (m.id === st.targetId ? { ...m, content: nextChunk } : m)));

      if (st.idx >= st.fullText.length) {
        stopTyping();
      }
    }, speedMs);
  }

  useEffect(() => {
    return () => stopTyping();
  }, []);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    stopTyping();

    const userMsg = { id: uid(), role: 'user', content: text, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const base = getServerUrl();
      const u = new URL('/api/chat', base);

      const baseHeaders = await buildAuthHeaders(isLoaded ? getToken : null, anonId);
      const headers = new Headers(baseHeaders);
      headers.set('Content-Type', 'application/json');

              const res = await fetch(u.toString(), {
                method: 'POST',
                headers,
                credentials: 'include',
                cache: 'no-store',
                body: JSON.stringify({
                  message: text,
                  history: messages
                    .slice(-12)
                    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
                    .filter((m) => m.content.trim()),
                  clientContext: {
                    pathname: typeof window !== 'undefined' ? window.location?.pathname : null,
                    timezone: (() => {
                      try {
                        return Intl.DateTimeFormat().resolvedOptions().timeZone;
                      } catch {
                        return null;
                      }
                    })(),
                    trafficView: (() => {
                      try {
                        return window.localStorage.getItem('tracel_default_traffic_view');
                      } catch {
                        return null;
                      }
                    })(),
                    ui: {
                      connection: connection
                        ? {
                            connected: !!connection.connected,
                          }
                        : null,
                      trafficView: typeof trafficView === 'string' ? trafficView : null,
                      stats: stats && typeof stats === 'object'
                        ? {
                            packets: typeof stats.packets === 'number' ? stats.packets : null,
                            threats: typeof stats.threats === 'number' ? stats.threats : null,
                            uptime: typeof stats.uptime === 'number' ? stats.uptime : null,
                          }
                        : null,
                      currentPacket: currentPacket && typeof currentPacket === 'object'
                        ? {
                            timestamp: currentPacket.timestamp || null,
                            source_ip: currentPacket.source_ip || null,
                            destination_ip: currentPacket.destination_ip || null,
                            method: currentPacket.method || null,
                            bytes: typeof currentPacket.bytes === 'number' ? currentPacket.bytes : null,
                            is_anomaly: !!currentPacket.is_anomaly,
                            anomaly_score: typeof currentPacket.anomaly_score === 'number' ? currentPacket.anomaly_score : null,
                          }
                        : null,
                    },
                  },
                }),
              });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Chat failed (${res.status})`);
      }

      const fullAnswer = formatAssistantText(data?.text);

      const botId = uid();
      setMessages((prev) => [...prev, { id: botId, role: 'assistant', content: '', ts: Date.now() }]);
      setTimeout(() => startTypewriter(botId, fullAnswer), 20);
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e);
      const botId = uid();
      setMessages((prev) => [
        ...prev,
        {
          id: botId,
          role: 'assistant',
          content: `Error: ${errText}`,
          ts: Date.now(),
          tone: 'error',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const panelVariants = {
    hidden: { opacity: 0, scale: 0.92, y: 18, filter: 'blur(6px)' },
    show: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, scale: 0.96, y: 12, filter: 'blur(6px)' },
  };

  return (
    <>
      {/* Floating Orb Trigger */}
      <div className="fixed bottom-6 right-6 z-[60]">
        <AnimatePresence>
          {!open ? (
            <MotionButton
              type="button"
              onClick={() => setOpen(true)}
              className={[
                'relative grid place-items-center h-14 w-14 rounded-full',
                'bg-slate-950/70 border border-white/10 backdrop-blur-xl',
                'shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_0_28px_rgba(34,211,238,0.22)]',
                'hover:shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_0_40px_rgba(34,211,238,0.30)]',
                'transition-shadow',
              ].join(' ')}
              initial={{ opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 12 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              <MotionSpan
                className="absolute inset-0 rounded-full"
                animate={{
                  boxShadow: [
                    '0 0 0 0 rgba(34,211,238,0.22)',
                    '0 0 0 12px rgba(34,211,238,0.06)',
                    '0 0 0 0 rgba(34,211,238,0.18)',
                  ],
                }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <MotionSpan
                className="absolute -inset-2 rounded-full bg-cyan-400/10 blur-xl"
                animate={{ opacity: [0.35, 0.65, 0.35], scale: [0.96, 1.05, 0.96] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              />

              <MotionDiv
                className="relative"
                animate={{ y: [0, -1.5, 0], rotate: [0, 2, 0] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkles className="h-6 w-6 text-cyan-400 drop-shadow-[0_0_14px_rgba(34,211,238,0.6)]" />
              </MotionDiv>

              <span className="sr-only">Open Tracel AI assistant</span>
            </MotionButton>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Expanded Chat Window */}
      <AnimatePresence>
        {open ? (
          <MotionDiv
            className="fixed bottom-6 right-6 z-[70] w-[min(92vw,420px)]"
            variants={panelVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <div
              className={[
                'relative overflow-hidden rounded-3xl',
                'bg-slate-950/90 border border-white/10 backdrop-blur-xl',
                'shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_0_60px_rgba(34,211,238,0.14)]',
              ].join(' ')}
            >
              <div className="pointer-events-none absolute inset-0 opacity-[0.07]">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[size:18px_18px]" />
                <div className="absolute inset-0 bg-gradient-to-b from-cyan-400/8 via-transparent to-transparent" />
              </div>

              {/* Header */}
              <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="grid place-items-center h-9 w-9 rounded-2xl bg-white/5 border border-white/10">
                    <Bot className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div className="leading-tight">
                    <div className="text-sm font-semibold text-slate-100 tracking-tight">TRACER</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-300">
                      <MotionSpan
                        className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.55)]"
                        animate={{ opacity: [0.25, 1, 0.25] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <span className="uppercase tracking-[0.22em]">Your AI Assistant</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-2xl p-2 text-slate-300 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 transition"
                  aria-label="Close chat"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Messages */}
              <div className="relative px-4 py-4 max-h-[min(62vh,520px)] overflow-y-auto scroll-hidden space-y-3 bg-slate-950/25">
                {messages.map((m) => {
                  const isUser = m.role === 'user';
                  const isError = m.tone === 'error';

                  return (
                    <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[86%] ${isUser ? 'items-end' : 'items-start'} flex gap-2`}>
                        {!isUser ? (
                          <div className="mt-1 grid place-items-center h-8 w-8 rounded-2xl bg-white/5 border border-white/10 shrink-0">
                            <Bot className="h-4 w-4 text-cyan-400" />
                          </div>
                        ) : null}

                        <div
                          className={[
                            'rounded-2xl px-4 py-3',
                            'text-sm leading-relaxed',
                            isUser
                              ? 'text-white bg-gradient-to-r from-blue-600 to-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.24)]'
                              : isError
                              ? 'text-rose-200 bg-rose-500/10 border border-rose-500/20'
                              : 'text-slate-200 bg-slate-950/55 border border-white/10',
                          ].join(' ')}
                        >
                          <div className="whitespace-pre-wrap">{m.content || '...'}</div>
                          {!isUser ? (
                            <div className="mt-2 text-[10px] text-slate-400 font-mono tracking-wide">
                              {new Date(m.ts).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: true,
                              })}
                            </div>
                          ) : null}
                        </div>

                        {isUser ? (
                          <div className="mt-1 grid place-items-center h-8 w-8 rounded-2xl bg-white/5 border border-white/10 shrink-0">
                            <User className="h-4 w-4 text-slate-200" />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {loading ? (
                  <div className="flex justify-start">
                    <div className="max-w-[86%] flex gap-2">
                      <div className="mt-1 grid place-items-center h-8 w-8 rounded-2xl bg-white/5 border border-white/10 shrink-0">
                        <Bot className="h-4 w-4 text-cyan-400" />
                      </div>
                      <div className="rounded-2xl px-4 py-3 bg-slate-950/55 border border-white/10">
                        <ScanningWave />
                      </div>
                    </div>
                  </div>
                ) : null}

                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="relative px-4 pb-4">
                <div
                  className={[
                    'flex items-end gap-3 rounded-2xl px-3 py-3',
                    'bg-slate-950/40 border border-white/10 backdrop-blur-xl',
                    'shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_0_24px_rgba(34,211,238,0.10)]',
                  ].join(' ')}
                >
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    rows={1}
                    placeholder="Ask Tracel AI…"
                    className={[
                      'flex-1 resize-none bg-transparent outline-none',
                      'text-sm text-slate-100 placeholder:text-slate-500',
                      'leading-relaxed max-h-24',
                      'font-sans',
                    ].join(' ')}
                  />

                  <MotionButton
                    type="button"
                    onClick={sendMessage}
                    disabled={!input.trim() || loading}
                    className={[
                      'grid place-items-center h-10 w-10 rounded-2xl',
                      'bg-cyan-400/10 border border-cyan-400/20',
                      'text-cyan-300 hover:text-cyan-200',
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                      'shadow-[0_0_18px_rgba(34,211,238,0.18)] hover:shadow-[0_0_26px_rgba(34,211,238,0.28)]',
                      'transition-shadow',
                    ].join(' ')}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.98 }}
                    aria-label="Send"
                  >
                    <ArrowUpRight className="h-5 w-5" />
                  </MotionButton>
                </div>

                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span className="tracking-wide">Tip: try “Give me a live briefing”.</span>
                  <span className="tracking-wide">{loading ? 'LINK: BUSY' : 'IDLE'}</span>
                </div>
              </div>
            </div>
          </MotionDiv>
        ) : null}
      </AnimatePresence>
    </>
  );
}
