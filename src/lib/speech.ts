/**
 * Voix de Jarvis : reconnaissance vocale (tu parles) et synthèse vocale (il répond).
 *
 * Tout passe par les API intégrées au navigateur (Web Speech) : aucune donnée
 * audio n'est envoyée à NEXUS ni à Anthropic. Sur iPhone, Safari s'appuie sur la
 * dictée d'Apple. Limites connues :
 *  - le micro exige une connexion sécurisée (HTTPS) : d'où Tailscale ;
 *  - selon la version d'iOS, la reconnaissance peut être indisponible dans
 *    l'app ajoutée à l'écran d'accueil : la dictée du clavier reste possible.
 */

// ─── Fonctions pures (testées) ───────────────────────────────────────────────

/** Transforme une réponse Markdown en texte agréable à écouter. */
export function stripForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b(prj|tsk|gol|ide|nte|mem|cnv|aut|lnk|hab|met|trx|wkt)_[A-Za-z0-9_-]+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(\S.*?)\1/g, '$2')
    .replace(/\|/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Découpe un texte qui arrive au fil de l'eau en phrases complètes, pour que
 * Jarvis commence à parler sans attendre la fin de la réponse.
 */
export class SentenceChunker {
  private buffer = '';
  constructor(private minLength = 24) {}

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    const re = /[.!?…:;](?=\s)|\n+/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(this.buffer))) {
      const end = m.index + m[0].length;
      const piece = this.buffer.slice(last, end);
      if (stripForSpeech(piece).length >= this.minLength) {
        out.push(piece);
        last = end;
      }
    }
    this.buffer = this.buffer.slice(last);
    return out.map(stripForSpeech).filter(Boolean);
  }

  flush(): string | null {
    const rest = stripForSpeech(this.buffer);
    this.buffer = '';
    return rest || null;
  }
}

// ─── Reconnaissance vocale ───────────────────────────────────────────────────

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type MicAvailability = 'ok' | 'insecure' | 'unsupported';

export function micAvailability(): MicAvailability {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return recognitionCtor() ? 'ok' : 'unsupported';
}

const RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': 'Micro refusé. Autorise-le pour ce site dans les réglages de Safari.',
  'service-not-allowed': 'La reconnaissance vocale est indisponible ici. Utilise la dictée du clavier.',
  'no-speech': 'Je n’ai rien entendu.',
  'audio-capture': 'Aucun micro détecté.',
  network: 'La reconnaissance vocale a besoin d’Internet.',
  aborted: '',
};

export class Listener {
  private rec: Recognition | null = null;

  /** Écoute une phrase. `onFinal` reçoit le texte reconnu (vide si rien). */
  start(handlers: { onInterim: (text: string) => void; onFinal: (text: string) => void; onError: (message: string) => void }) {
    const Ctor = recognitionCtor();
    if (!Ctor) return handlers.onError('La reconnaissance vocale n’est pas disponible dans ce navigateur.');
    this.stop();
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      handlers.onInterim((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      const msg = RECOGNITION_ERRORS[e.error] ?? `Erreur de reconnaissance (${e.error}).`;
      if (msg) handlers.onError(msg);
    };
    rec.onend = () => {
      this.rec = null;
      handlers.onFinal(finalText.trim());
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      handlers.onError('Impossible de démarrer le micro.');
    }
  }

  /** Arrête l'écoute en gardant ce qui a été dit. */
  stop() {
    this.rec?.stop();
  }

  abort() {
    if (this.rec) {
      this.rec.onend = null;
      this.rec.abort();
      this.rec = null;
    }
  }
}

// ─── Synthèse vocale ─────────────────────────────────────────────────────────

export function frenchVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('fr'));
}

/** Choisit la meilleure voix française disponible (les voix « Premium/Améliorée » d'Apple d'abord). */
export function bestVoice(preferred?: string | null): SpeechSynthesisVoice | null {
  const voices = frenchVoices();
  if (preferred) {
    const v = voices.find((x) => x.voiceURI === preferred);
    if (v) return v;
  }
  const score = (v: SpeechSynthesisVoice) =>
    (/premium|enhanced|améliorée|neural|natural/i.test(v.name) ? 10 : 0) + (v.lang === 'fr-FR' ? 3 : 0) + (/thomas|amélie|audrey|aurélie/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
  return voices.sort((a, b) => score(b) - score(a))[0] ?? null;
}

export class Speaker {
  private pending = 0;
  /** Incrémenté à chaque annulation : les fins d'énoncés annulés sont ignorées. */
  private generation = 0;
  voiceURI: string | null = null;
  rate = 1.04;
  onIdle: (() => void) | null = null;
  onStart: (() => void) | null = null;

  get available() {
    return typeof speechSynthesis !== 'undefined';
  }

  get speaking() {
    return this.pending > 0;
  }

  /** iOS n'autorise la parole qu'après un geste : on « débloque » avec un énoncé vide. */
  unlock() {
    if (!this.available) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  speak(text: string) {
    if (!this.available || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    const voice = bestVoice(this.voiceURI);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'fr-FR';
    u.rate = this.rate;
    this.pending++;
    if (this.pending === 1) this.onStart?.();
    let finished = false;
    const generation = this.generation;
    const done = () => {
      if (finished || generation !== this.generation) return;
      finished = true;
      clearTimeout(watchdog);
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) this.onIdle?.();
    };
    // Filet de sécurité : certains navigateurs (iOS notamment) oublient parfois de
    // signaler la fin d'une phrase. Durée max estimée : ~12 caractères/s + 4 s.
    const watchdog = setTimeout(done, (text.length / 12 / this.rate) * 1000 * 1.6 + 4000);
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  cancel() {
    if (!this.available) return;
    const wasSpeaking = this.pending > 0;
    this.generation++;
    this.pending = 0;
    speechSynthesis.cancel();
    if (wasSpeaking) this.onIdle?.();
  }
}
