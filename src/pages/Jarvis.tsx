/**
 * JARVIS — l'interface vocale de NEXUS.
 * Tu touches le noyau, tu parles ; NEXUS consulte tes données, agit si besoin,
 * et te répond à voix haute. En mode « conversation », il se remet à
 * l'écoute dès qu'il a fini de parler.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Keyboard, Mic, MicOff, MessagesSquare, RotateCcw, Send, Square, Volume2, VolumeX, X, Settings2 } from 'lucide-react';
import { ApiError, queryClient, streamChat, useApi } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { cx, greeting } from '../lib/format';
import { Listener, SentenceChunker, Speaker, frenchVoices, micAvailability, stripForSpeech } from '../lib/speech';
import type { AIStatus, ChatEvent, Settings, ToolEffect } from '../lib/types';
import { Button, Drawer, IconButton, Select, Toggle } from '../components/ui';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

const CONV_KEY = 'nexus.jarvis.conversation';
const PREFS_KEY = 'nexus.jarvis.prefs';

interface Prefs { voiceOn: boolean; continuous: boolean; voiceURI: string | null; rate: number }
const DEFAULT_PREFS: Prefs = { voiceOn: true, continuous: true, voiceURI: null, rate: 1.04 };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée) : sans conséquence */
  }
}

const TOOL_VERB: Record<string, string> = {
  create_task: 'Tâche créée',
  update_task: 'Tâche mise à jour',
  create_project: 'Projet créé',
  update_project: 'Projet mis à jour',
  add_project_items: 'Projet enrichi',
  create_goal: 'Objectif créé',
  update_goal: 'Objectif mis à jour',
  capture_idea: 'Idée capturée',
  create_note: 'Note créée',
  remember: 'Mémorisé',
  forget: 'Oublié',
  link_items: 'Éléments reliés',
  log_transaction: 'Opération enregistrée',
  log_workout: 'Séance enregistrée',
  check_habit: 'Habitude cochée',
  log_metric: 'Métrique enregistrée',
};

const STATUS: Record<Phase, string> = {
  idle: 'Touche le noyau pour parler',
  listening: 'Je t’écoute…',
  thinking: 'Je réfléchis…',
  speaking: 'Touche pour m’interrompre',
};

export function Jarvis() {
  const { data: ai } = useApi<AIStatus>(['ai-status'], '/ai/status');
  const { data: settings } = useApi<Settings>(['settings'], '/settings');
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [actions, setActions] = useState<{ id: string; label: string; ok: boolean; effect?: ToolEffect }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => load(PREFS_KEY, DEFAULT_PREFS));
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CONV_KEY);
    } catch {
      return null;
    }
  });

  const listener = useRef(new Listener());
  const speaker = useRef(new Speaker());
  const abortRef = useRef<AbortController | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const relisten = useRef(false);
  const mic = micAvailability();
  const online = ai?.online;

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  useEffect(() => save(PREFS_KEY, prefs), [prefs]);
  useEffect(() => {
    speaker.current.voiceURI = prefs.voiceURI;
    speaker.current.rate = prefs.rate;
  }, [prefs.voiceURI, prefs.rate]);

  // Quand Jarvis a fini de parler : retour au repos, ou nouvelle écoute en mode conversation.
  useEffect(() => {
    const sp = speaker.current;
    sp.onStart = () => {
      if (phaseRef.current === 'thinking') go('speaking');
    };
    sp.onIdle = () => {
      if (phaseRef.current !== 'speaking') return;
      go('idle');
      // startRef pointe toujours vers la version la plus récente (état à jour).
      if (relisten.current && mic === 'ok') setTimeout(() => startRef.current(), 350);
    };
    return () => {
      sp.onIdle = null;
      sp.onStart = null;
      sp.cancel();
      listener.current.abort();
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListening = () => {
    if (!online) return;
    setError(null);
    setHeard('');
    go('listening');
    listener.current.start({
      onInterim: setHeard,
      onFinal: (text) => {
        if (phaseRef.current !== 'listening') return;
        if (text) void ask(text);
        else go('idle');
      },
      onError: (msg) => {
        setError(msg);
        go('idle');
      },
    });
  };

  const startRef = useRef(startListening);
  startRef.current = startListening;

  const ask = async (text: string) => {
    const message = text.trim();
    if (!message) return;
    setHeard(message);
    setReply('');
    setActions([]);
    setError(null);
    go('thinking');
    relisten.current = prefs.continuous;
    const chunker = new SentenceChunker();
    const say = (s: string) => prefs.voiceOn && speaker.current.speak(s);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let convId = conversationId;
    let full = '';

    const onEvent = (e: ChatEvent) => {
      if (e.type === 'start') {
        convId = e.conversationId;
        setConversationId(e.conversationId);
        save(CONV_KEY, e.conversationId);
      } else if (e.type === 'text') {
        full += e.delta;
        setReply(stripForSpeech(full));
        chunker.push(e.delta).forEach(say);
      } else if (e.type === 'tool_result') {
        const label = e.ok ? (TOOL_VERB[e.name] ?? null) : null;
        if (label) setActions((a) => [...a, { id: e.id, label: e.effect?.title ? `${label} : ${e.effect.title}` : label, ok: e.ok, effect: e.effect }]);
        if (e.effect) void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'conversation' });
      } else if (e.type === 'error' || e.type === 'refusal') {
        setError(e.message);
      }
    };

    try {
      await streamChat({ conversationId: convId, message, voice: true }, onEvent, ctrl.signal);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof ApiError ? err.message : 'Connexion interrompue.');
    } finally {
      abortRef.current = null;
      const rest = chunker.flush();
      if (rest) say(rest);
      // Rien à dire (voix coupée, erreur, réponse vide) : retour au repos.
      if (!speaker.current.speaking) go('idle');
      else if (phaseRef.current === 'thinking') go('speaking');
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  };

  /** Geste principal : toucher le noyau. */
  const onCore = () => {
    speaker.current.unlock();
    if (phase === 'listening') return listener.current.stop();
    if (phase === 'speaking') {
      relisten.current = false;
      speaker.current.cancel();
      return go('idle');
    }
    if (phase === 'thinking') {
      relisten.current = false;
      abortRef.current?.abort();
      speaker.current.cancel();
      return go('idle');
    }
    if (mic !== 'ok') return setTyping(true);
    startListening();
  };

  const newSession = () => {
    abortRef.current?.abort();
    speaker.current.cancel();
    listener.current.abort();
    setConversationId(null);
    try {
      localStorage.removeItem(CONV_KEY);
    } catch {
      /* ignoré */
    }
    setHeard('');
    setReply('');
    setActions([]);
    setError(null);
    go('idle');
  };

  const name = settings?.user_name?.trim();
  const micHint =
    mic === 'insecure'
      ? 'Micro indisponible : la page n’est pas en HTTPS. Utilise l’adresse Tailscale, ou la dictée du clavier ci-dessous.'
      : mic === 'unsupported'
        ? 'Reconnaissance vocale indisponible ici : utilise la dictée du clavier (icône micro du clavier).'
        : null;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Halo d'ambiance qui suit l'état */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-[38%] h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        animate={{
          background: phase === 'listening' ? 'radial-gradient(circle, rgb(143 180 255 / 0.20), transparent 60%)' : phase === 'idle' ? 'radial-gradient(circle, rgb(255 107 44 / 0.08), transparent 60%)' : 'radial-gradient(circle, rgb(255 107 44 / 0.20), transparent 60%)',
        }}
        transition={{ duration: 0.8 }}
      />

      <header className="relative z-10 flex items-center gap-2 px-4 pt-4 md:px-8 md:pt-6">
        <div className="flex-1">
          <div className="label flex items-center gap-2">
            <span className={cx('h-1.5 w-1.5 rounded-full', online ? 'bg-signal shadow-[0_0_10px_#ff6b2c]' : 'bg-ink-3')} />
            Jarvis
          </div>
        </div>
        {conversationId && (
          <IconButton label="Voir la conversation complète" onClick={() => navigate(`/ai/${conversationId}`)}>
            <MessagesSquare size={16} />
          </IconButton>
        )}
        <IconButton label="Nouvelle session" onClick={newSession}>
          <RotateCcw size={16} />
        </IconButton>
        <IconButton label="Réglages de la voix" onClick={() => setPrefsOpen(true)}>
          <Settings2 size={16} />
        </IconButton>
      </header>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5">
        <button onClick={onCore} disabled={!online} aria-label={STATUS[phase]} className="focus-ring rounded-full disabled:opacity-40">
          <Orb phase={online ? phase : 'idle'} compact={Boolean(heard || reply || typing)} />
        </button>

        <div className="mt-5 h-6 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">{online ? STATUS[phase] : 'IA hors ligne'}</div>

        <div className="mt-4 w-full max-w-[560px] space-y-4 text-center">
          {!online ? (
            <p className="text-[15px] text-ink-2">
              {ai?.reason ?? 'L’IA est hors ligne.'}{' '}
              {ai?.mode === 'remote' ? 'À régler sur le Mac : Réglages → Intelligence artificielle.' : <Link to="/settings" className="text-signal">Configurer →</Link>}
            </p>
          ) : !heard && !reply ? (
            <p className="text-[19px] font-medium leading-snug tracking-[-0.01em] text-ink">
              {greeting()}
              {name ? `, ${name}` : ''}. <span className="text-ink-2">Que puis-je faire pour toi&nbsp;?</span>
            </p>
          ) : (
            <>
              {heard && <p className={cx('text-[14px] leading-relaxed', phase === 'listening' ? 'text-ion' : 'text-ink-3')}>« {heard} »</p>}
              {reply && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: phase === 'listening' ? 0.4 : 1 }} className="max-h-[32vh] overflow-y-auto text-[18px] leading-relaxed tracking-[-0.005em] text-ink">
                  {reply}
                </motion.p>
              )}
            </>
          )}
          <AnimatePresence>
            {actions.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap justify-center gap-1.5">
                {actions.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-signal/30 bg-signal/10 px-2.5 py-1 text-[12px] text-ink">
                    <Check size={12} className="text-signal" />
                    {a.label}
                  </span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {online && micHint && !error && !reply && <p className="text-[12.5px] text-ink-3">{micHint}</p>}
        </div>
      </div>

      {/* Commandes */}
      <div className="relative z-10 px-4 pb-6 md:pb-10">
        <AnimatePresence>
          {typing && (
            <motion.form
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="panel mx-auto mb-4 flex max-w-[560px] items-center gap-2 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                speaker.current.unlock();
                if (draft.trim()) {
                  void ask(draft);
                  setDraft('');
                }
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Écris ou dicte avec le clavier…"
                enterKeyHint="send"
                className="h-10 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-ink-3"
              />
              <Button type="submit" variant="primary" className="!h-10 !w-10 !p-0" aria-label="Envoyer" disabled={!draft.trim() || !online}>
                <Send size={16} />
              </Button>
              <IconButton label="Fermer le clavier" type="button" onClick={() => setTyping(false)}>
                <X size={15} />
              </IconButton>
            </motion.form>
          )}
        </AnimatePresence>
        <div className="mx-auto flex max-w-[360px] items-center justify-between">
          <RoundToggle on={prefs.voiceOn} label={prefs.voiceOn ? 'Voix activée' : 'Voix coupée'} onClick={() => (speaker.current.cancel(), setPrefs((p) => ({ ...p, voiceOn: !p.voiceOn })))}>
            {prefs.voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </RoundToggle>
          <button
            onClick={onCore}
            disabled={!online}
            aria-label={phase === 'idle' ? 'Parler' : 'Arrêter'}
            className={cx(
              'focus-ring flex h-[68px] w-[68px] items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-40',
              phase === 'listening' ? 'bg-ion text-[#06122b] shadow-[0_0_40px_rgb(143_180_255/0.6)]' : phase === 'idle' ? 'bg-signal text-[#1a0a02] shadow-[0_0_40px_rgb(255_107_44/0.45)]' : 'border border-line-strong bg-white/[0.06] text-ink',
            )}
          >
            {phase === 'idle' ? mic === 'ok' ? <Mic size={26} /> : <Keyboard size={24} /> : phase === 'listening' ? <MicOff size={24} /> : <Square size={20} fill="currentColor" />}
          </button>
          <RoundToggle on={typing} label="Clavier" onClick={() => setTyping((v) => !v)}>
            <Keyboard size={18} />
          </RoundToggle>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-ink-3">
          <Toggle checked={prefs.continuous} onChange={(v) => setPrefs((p) => ({ ...p, continuous: v }))} label="Mode conversation" />
          Mode conversation <span className="hidden sm:inline">— je me remets à l’écoute après chaque réponse</span>
        </div>
      </div>

      <VoicePrefs open={prefsOpen} onClose={() => setPrefsOpen(false)} prefs={prefs} setPrefs={setPrefs} speaker={speaker.current} />
    </div>
  );
}

function RoundToggle({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cx('focus-ring flex h-12 w-12 items-center justify-center rounded-full border transition-colors', on ? 'border-line-strong bg-white/[0.07] text-ink' : 'border-line text-ink-3')}>
      {children}
    </button>
  );
}

/** Le noyau de Jarvis : anneaux qui réagissent à l'état (écoute en bleu, réflexion/parole en orange). */
function Orb({ phase, compact }: { phase: Phase; compact: boolean }) {
  const color = phase === 'listening' ? '#8fb4ff' : '#ff6b2c';
  const fast = phase === 'thinking';
  // Plus petit quand une réponse s'affiche, pour laisser la place au texte sur iPhone.
  const size = compact ? 'min(38vw, 150px)' : 'min(62vw, 260px)';
  return (
    <div className="relative transition-[width,height] duration-500 ease-out-expo" style={{ width: size, height: size }}>
      {(phase === 'listening' || phase === 'speaking') &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={`${phase}-${i}`}
            className="absolute inset-[18%] rounded-full border"
            style={{ borderColor: color }}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ duration: phase === 'speaking' ? 1.8 : 1.4, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
          />
        ))}
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="orb-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff6f0" />
            <stop offset="30%" stopColor={color} />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="none" stroke={color} strokeOpacity="0.14" />
        <g style={{ transformOrigin: '100px 100px', animation: `spin-slow ${fast ? 2.4 : 18}s linear infinite` }}>
          <circle cx="100" cy="100" r="80" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="1.4" strokeDasharray="120 380" strokeLinecap="round" />
          <circle cx="100" cy="100" r="80" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 10" />
        </g>
        <g style={{ transformOrigin: '100px 100px', animation: `spin-slow ${fast ? 3.6 : 28}s linear infinite reverse` }}>
          <circle cx="100" cy="100" r="62" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1" strokeDasharray="60 30 10 30" />
        </g>
        <g style={{ transformOrigin: '100px 100px', animation: `spin-slow ${fast ? 1.8 : 12}s linear infinite` }}>
          <circle cx="100" cy="100" r="46" fill="none" stroke={color} strokeOpacity="0.8" strokeWidth="2" strokeDasharray="40 250" strokeLinecap="round" />
        </g>
        <motion.circle
          cx="100"
          cy="100"
          fill="url(#orb-core)"
          animate={{ r: phase === 'idle' ? [24, 27, 24] : phase === 'listening' ? [26, 34, 26] : phase === 'speaking' ? [28, 36, 30, 34, 28] : [30, 32, 30] }}
          transition={{ duration: phase === 'idle' ? 4 : phase === 'speaking' ? 1.2 : 1, repeat: Infinity, ease: 'easeInOut' }}
        />
        <circle cx="100" cy="100" r="5" fill="#fff8f3" />
      </svg>
    </div>
  );
}

function VoicePrefs({ open, onClose, prefs, setPrefs, speaker }: { open: boolean; onClose: () => void; prefs: Prefs; setPrefs: (fn: (p: Prefs) => Prefs) => void; speaker: Speaker }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!open || typeof speechSynthesis === 'undefined') return;
    const refresh = () => setVoices(frenchVoices());
    refresh();
    speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, [open]);
  return (
    <Drawer open={open} onClose={onClose} width={420}>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <span className="font-medium">Voix de Jarvis</span>
        <IconButton label="Fermer" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="space-y-5 p-5">
        <label className="block space-y-1.5">
          <span className="label block">Voix</span>
          <Select value={prefs.voiceURI ?? ''} onChange={(e) => setPrefs((p) => ({ ...p, voiceURI: e.target.value || null }))}>
            <option value="">Automatique (meilleure voix française)</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </Select>
          <span className="block text-[12px] text-ink-3">Sur iPhone, les voix « Améliorée » ou « Premium » sont bien plus naturelles : Réglages → Accessibilité → Contenu énoncé → Voix → Français.</span>
        </label>
        <label className="block space-y-1.5">
          <span className="label block">Débit · {prefs.rate.toFixed(2)}×</span>
          <input type="range" min={0.8} max={1.4} step={0.02} value={prefs.rate} onChange={(e) => setPrefs((p) => ({ ...p, rate: Number(e.target.value) }))} className="w-full accent-[#ff6b2c]" />
        </label>
        <Button
          onClick={() => {
            speaker.voiceURI = prefs.voiceURI;
            speaker.rate = prefs.rate;
            speaker.cancel();
            speaker.speak('Bonjour. Je suis Jarvis, ton système NEXUS. Tout est opérationnel.');
          }}
        >
          Tester la voix
        </Button>
      </div>
    </Drawer>
  );
}
