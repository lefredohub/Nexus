/**
 * Client Ollama : IA locale, gratuite, qui tourne sur ton Mac.
 *
 * Ollama est une application (ollama.com) qui fait tourner des modèles open source
 * sur la machine et les expose sur http://127.0.0.1:11434. Rien ne sort du Mac.
 *
 * On parle à son API native (`/api/chat`, `/api/tags`, `/api/show`, `/api/pull`)
 * avec `fetch`, sans dépendance. Les réponses sont converties dans le même format
 * de blocs que Claude (texte, tool_use, tool_result) : l'historique des conversations
 * reste unique, et on peut passer d'une IA à l'autre au milieu d'une conversation.
 */
import { randomBytes } from 'node:crypto';
import { AppError } from '../lib/errors';
import type { StoredMessage } from '../repos/conversations';

export const OLLAMA_URL = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
/** Modèle conseillé pour un Mac M1/M2/M3 avec 16 Go : bon en français, sait utiliser des outils. */
export const RECOMMENDED_OLLAMA_MODEL = 'qwen3:8b';
/** Taille de contexte demandée : nos instructions + 26 outils + l'historique dépassent les 4 096 par défaut. */
const NUM_CTX = 16384;

export interface OllamaDeps {
  fetch?: typeof fetch;
  baseUrl?: string;
}

type Block = Record<string, unknown>;
export interface TurnResult {
  content: Block[];
  stop_reason: string | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

const base = (d: OllamaDeps) => d.baseUrl ?? OLLAMA_URL;

/** Appel HTTP vers Ollama avec des erreurs compréhensibles. */
async function call(d: OllamaDeps, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const f = d.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${base(d)}${path}`, { ...init, signal: init.signal ?? (init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined) });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError' && init.signal?.aborted) throw new AppError(400, 'aborted', 'Requête interrompue.');
    throw new AppError(503, 'ollama_unreachable', 'Ollama ne répond pas. Ouvre l’application Ollama sur ton Mac (ou installe-la depuis ollama.com).');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      /* réponse non JSON */
    }
    if (res.status === 404 && /not found/i.test(message)) throw new AppError(400, 'model_missing', `Le modèle n’est pas installé dans Ollama. Télécharge-le dans Réglages → Intelligence artificielle. (${message})`);
    throw new AppError(502, 'ollama_error', `Ollama a renvoyé une erreur : ${message || res.status}`);
  }
  return res;
}

// ─── État, modèles installés, capacités ──────────────────────────────────────

export interface OllamaModel {
  name: string;
  size: number;
  parameter_size: string | null;
}

export async function ollamaStatus(d: OllamaDeps = {}): Promise<{ reachable: boolean; version: string | null; models: OllamaModel[] }> {
  try {
    const [v, tags] = await Promise.all([
      call(d, '/api/version', { timeoutMs: 1500 }).then((r) => r.json() as Promise<{ version?: string }>),
      call(d, '/api/tags', { timeoutMs: 1500 }).then((r) => r.json() as Promise<{ models?: { name: string; size: number; details?: { parameter_size?: string } }[] }>),
    ]);
    return {
      reachable: true,
      version: v.version ?? null,
      models: (tags.models ?? []).map((m) => ({ name: m.name, size: m.size, parameter_size: m.details?.parameter_size ?? null })),
    };
  } catch {
    return { reachable: false, version: null, models: [] };
  }
}

/** « qwen3:8b » et « qwen3:8b » installé sous un autre alias (« qwen3:latest »…) : comparaison souple. */
export function isInstalled(models: OllamaModel[], name: string): boolean {
  const n = name.includes(':') ? name : `${name}:latest`;
  return models.some((m) => m.name === n || m.name === name);
}

const capsCache = new Map<string, string[] | null>();

/** Capacités d'un modèle (« tools », « thinking »…). `null` si la version d'Ollama ne les indique pas. */
export async function modelCapabilities(d: OllamaDeps, model: string): Promise<string[] | null> {
  if (capsCache.has(model)) return capsCache.get(model)!;
  const r = await call(d, '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), timeoutMs: 5000 });
  const info = (await r.json()) as { capabilities?: string[] };
  const caps = Array.isArray(info.capabilities) ? info.capabilities : null;
  capsCache.set(model, caps);
  return caps;
}

export function clearCapabilitiesCache() {
  capsCache.clear();
}

// ─── Conversion de l'historique (format Claude → format Ollama) ──────────────

/**
 * L'historique est stocké au format de blocs de Claude. On le traduit pour Ollama :
 * texte → content, tool_use → tool_calls, tool_result → message « tool ».
 * La réflexion de Claude (signée, propre à Claude) n'est pas transmise.
 */
export function toOllamaMessages(system: string, history: StoredMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: 'system', content: system }];
  const toolNames = new Map<string, string>();
  for (const m of history) {
    const blocks = m.content as Block[];
    if (m.kind === 'user') {
      out.push({ role: 'user', content: blocks.flatMap((b) => (b.type === 'text' ? [String(b.text)] : [])).join('\n\n') });
    } else if (m.kind === 'assistant') {
      const text = blocks.flatMap((b) => (b.type === 'text' ? [String(b.text)] : [])).join('');
      const calls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => {
          toolNames.set(String(b.id), String(b.name));
          return { function: { name: String(b.name), arguments: (b.input ?? {}) as Record<string, unknown> } };
        });
      out.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (m.kind === 'tool_results') {
      for (const b of blocks) {
        if (b.type !== 'tool_result') continue;
        const content = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        out.push({ role: 'tool', content: b.is_error ? `ERREUR : ${content}` : content, tool_name: toolNames.get(String(b.tool_use_id)) });
      }
    }
  }
  return out;
}

const toolId = () => `toolu_local_${randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')}`;

/** Lit un flux NDJSON (une ligne JSON par événement), tel que le renvoie Ollama. */
async function* ndjson(res: Response): AsyncGenerator<Record<string, unknown>> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

export interface OllamaTurnOptions {
  model: string;
  system: string;
  history: StoredMessage[];
  tools: { name: string; description?: string; input_schema: unknown }[];
  think: boolean;
  signal?: AbortSignal;
}

/**
 * Un tour de modèle en streaming. Diffuse le texte et la réflexion au fil de
 * l'eau, puis renvoie le message complet au format de blocs de Claude.
 */
export async function* ollamaTurn(d: OllamaDeps, o: OllamaTurnOptions): AsyncGenerator<{ type: 'text' | 'thinking'; delta: string }, TurnResult> {
  const caps = await modelCapabilities(d, o.model);
  const canUseTools = caps === null || caps.includes('tools');
  const canThink = caps?.includes('thinking') ?? false;
  const body = {
    model: o.model,
    messages: toOllamaMessages(o.system, o.history),
    stream: true,
    keep_alive: '30m', // garde le modèle en mémoire : Jarvis répond plus vite au message suivant
    options: { num_ctx: NUM_CTX },
    ...(canUseTools && o.tools.length ? { tools: o.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } })) } : {}),
    ...(canThink ? { think: o.think } : {}),
  };
  const res = await call(d, '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: o.signal });

  let text = '';
  let thinking = '';
  const calls: Block[] = [];
  let doneReason: string | null = null;
  const usage = { input_tokens: 0, output_tokens: 0 };
  for await (const chunk of ndjson(res)) {
    if (chunk.error) throw new AppError(502, 'ollama_error', `Ollama : ${String(chunk.error)}`);
    const msg = (chunk.message ?? {}) as { content?: string; thinking?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
    if (msg.thinking) {
      thinking += msg.thinking;
      yield { type: 'thinking', delta: msg.thinking };
    }
    if (msg.content) {
      text += msg.content;
      yield { type: 'text', delta: msg.content };
    }
    for (const c of msg.tool_calls ?? []) {
      let args = c.function?.arguments ?? {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      calls.push({ type: 'tool_use', id: toolId(), name: c.function?.name ?? 'inconnu', input: args });
    }
    if (chunk.done) {
      doneReason = (chunk.done_reason as string | undefined) ?? 'stop';
      usage.input_tokens = Number(chunk.prompt_eval_count ?? 0);
      usage.output_tokens = Number(chunk.eval_count ?? 0);
    }
  }

  const content: Block[] = [];
  // La réflexion d'un modèle local est gardée pour l'affichage, sous un type propre à NEXUS
  // (elle n'est jamais renvoyée à Claude, qui ne la reconnaîtrait pas).
  if (thinking.trim()) content.push({ type: 'local_thinking', text: thinking });
  if (text) content.push({ type: 'text', text });
  content.push(...calls);
  return {
    content,
    stop_reason: calls.length ? 'tool_use' : doneReason === 'length' ? 'max_tokens' : 'end_turn',
    model: o.model,
    usage,
  };
}

/** Réponse complète (non streamée), éventuellement contrainte par un schéma JSON. */
export async function ollamaComplete(d: OllamaDeps, o: { model: string; system?: string; prompt: string; format?: unknown; think?: boolean }): Promise<string> {
  const caps = await modelCapabilities(d, o.model);
  const canThink = caps?.includes('thinking') ?? false;
  const res = await call(d, '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: o.model,
      messages: [...(o.system ? [{ role: 'system', content: o.system }] : []), { role: 'user', content: o.prompt }],
      stream: false,
      keep_alive: '30m',
      options: { num_ctx: NUM_CTX },
      ...(o.format ? { format: o.format } : {}),
      ...(canThink ? { think: o.think ?? false } : {}),
    }),
    timeoutMs: 10 * 60 * 1000,
  });
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

/** Téléchargement d'un modèle, avec progression (`/api/pull`). */
export async function* ollamaPull(d: OllamaDeps, model: string, signal?: AbortSignal): AsyncGenerator<{ status: string; completed?: number; total?: number }> {
  const res = await call(d, '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal });
  for await (const chunk of ndjson(res)) {
    if (chunk.error) throw new AppError(502, 'ollama_error', `Ollama : ${String(chunk.error)}`);
    yield { status: String(chunk.status ?? ''), completed: chunk.completed as number | undefined, total: chunk.total as number | undefined };
  }
  clearCapabilitiesCache();
}
