/**
 * IA locale (Ollama) — testée contre un faux serveur Ollama qui reproduit son API
 * (/api/version, /api/tags, /api/show, /api/chat en NDJSON, /api/pull).
 */
import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { testDb, testSecrets } from './helpers';
import { runChat, conversationView, type ChatEvent } from '../server/ai/agent';
import { aiReadiness, completeStructured, toAnthropicMessages } from '../server/ai/providers';
import { toOllamaMessages, clearCapabilitiesCache, ollamaPull } from '../server/ai/ollama';
import { updateSettings } from '../server/repos/settings';
import { listTasks } from '../server/repos/tasks';
import { listMessages } from '../server/repos/conversations';
import { ideaAnalysis } from '../shared/schemas';

type Json = Record<string, unknown>;
const ndjson = (lines: Json[]) => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });

/** Faux Ollama : `chats` = réponses successives de /api/chat ; enregistre les requêtes. */
function fakeOllama(opts: { models?: string[]; caps?: string[] | null; chats?: (Json[] | Json)[]; down?: boolean } = {}) {
  const requests: { path: string; body: Json }[] = [];
  const chats = [...(opts.chats ?? [])];
  const f = (async (url: string, init?: RequestInit) => {
    if (opts.down) throw new TypeError('fetch failed');
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, body });
    if (path === '/api/version') return Response.json({ version: '0.12.0' });
    if (path === '/api/tags') return Response.json({ models: (opts.models ?? ['qwen3:8b']).map((name) => ({ name, size: 5_200_000_000, details: { parameter_size: '8.2B' } })) });
    if (path === '/api/show') {
      if (!(opts.models ?? ['qwen3:8b']).includes(body.model)) return Response.json({ error: `model "${body.model}" not found, try pulling it first` }, { status: 404 });
      return Response.json(opts.caps === null ? {} : { capabilities: opts.caps ?? ['completion', 'tools', 'thinking'] });
    }
    if (path === '/api/pull') return ndjson([{ status: 'pulling manifest' }, { status: 'downloading', total: 100, completed: 50 }, { status: 'success' }]);
    if (path === '/api/chat') {
      const next = chats.shift();
      if (!next) throw new Error('scénario épuisé');
      return Array.isArray(next) ? ndjson(next) : Response.json(next);
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }) as unknown as typeof fetch;
  return { requests, fetch: f };
}

function setup(fake: ReturnType<typeof fakeOllama>) {
  clearCapabilitiesCache();
  const db = testDb();
  updateSettings(db, { ai_provider: 'ollama', ollama_model: 'qwen3:8b' });
  return { db, deps: { db, secrets: testSecrets(false), ollama: { fetch: fake.fetch, baseUrl: 'http://127.0.0.1:11434' } } };
}

async function collect(gen: AsyncGenerator<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('état de l’IA locale', () => {
  it('signale Ollama absent, modèle manquant, puis prêt', async () => {
    let r = await aiReadiness(setup(fakeOllama({ down: true })).deps);
    expect(r).toMatchObject({ provider: 'ollama', online: false });
    expect(r.reason).toMatch(/pas lancé/);
    r = await aiReadiness(setup(fakeOllama({ models: ['llama3.1:8b'] })).deps);
    expect(r).toMatchObject({ online: false, ollama: { reachable: true, modelInstalled: false } });
    expect(r.reason).toMatch(/pas encore téléchargé/);
    r = await aiReadiness(setup(fakeOllama()).deps);
    expect(r).toMatchObject({ online: true, model: 'qwen3:8b', ollama: { version: '0.12.0' } });
  });

  it('sans Ollama, le chat répond par une erreur claire, sans clé API demandée', async () => {
    const { deps } = setup(fakeOllama({ down: true }));
    const events = await collect(runChat(deps, { message: 'Salut' }));
    expect(events).toEqual([{ type: 'error', code: 'ai_offline', message: expect.stringMatching(/Ollama/) }]);
  });
});

describe('conversation avec un modèle local', () => {
  it('exécute les outils, persiste, et renvoie l’historique au bon format', async () => {
    const fake = fakeOllama({
      chats: [
        [
          { message: { role: 'assistant', content: '', thinking: 'Je dois créer une tâche.' }, done: false },
          { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_task', arguments: { title: 'Appeler Paul', priority: 1 } } }] }, done: false },
          { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 900, eval_count: 40 },
        ],
        [
          { message: { role: 'assistant', content: 'C’est noté, ' }, done: false },
          { message: { role: 'assistant', content: 'la tâche est créée.' }, done: false },
          { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 1000, eval_count: 12 },
        ],
      ],
    });
    const { db, deps } = setup(fake);
    const events = await collect(runChat(deps, { message: 'Rappelle-moi d’appeler Paul' }));
    expect(events.map((e) => e.type)).toEqual(['start', 'thinking', 'tool_start', 'tool_result', 'text', 'text', 'done']);
    expect(listTasks(db)[0]).toMatchObject({ title: 'Appeler Paul', source: 'ai' });

    const chats = fake.requests.filter((r) => r.path === '/api/chat');
    const first = chats[0].body as { messages: { role: string }[]; tools: unknown[]; options: { num_ctx: number }; think: boolean; keep_alive: string };
    expect(first.messages[0].role).toBe('system');
    expect(first.tools.length).toBeGreaterThan(20);
    expect(first.options.num_ctx).toBeGreaterThanOrEqual(16384); // contexte suffisant pour nos outils
    expect(first.think).toBe(false); // effort « medium » par défaut : réponse rapide
    const second = chats[1].body as { messages: { role: string; tool_calls?: unknown[]; tool_name?: string; content: string }[] };
    const last = second.messages.slice(-2);
    expect(last[0]).toMatchObject({ role: 'assistant', tool_calls: [{ function: { name: 'create_task' } }] });
    expect(last[1]).toMatchObject({ role: 'tool', tool_name: 'create_task' });

    const convId = (events[0] as Extract<ChatEvent, { type: 'start' }>).conversationId;
    const view = conversationView(deps, convId);
    expect(view.conversation.model).toBe('qwen3:8b');
    expect(view.turns[1].parts.map((p) => p.type)).toEqual(['thinking', 'tool', 'text']);
  });

  it('n’envoie ni outils ni réflexion à un modèle qui ne les gère pas', async () => {
    const fake = fakeOllama({ caps: ['completion'], chats: [[{ message: { role: 'assistant', content: 'Bonjour.' }, done: true, done_reason: 'stop' }]] });
    await collect(runChat(setup(fake).deps, { message: 'Salut' }));
    const body = fake.requests.find((r) => r.path === '/api/chat')!.body;
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('think');
  });

  it('permet de passer à Claude au milieu d’une conversation', async () => {
    const fake = fakeOllama({ chats: [[{ message: { role: 'assistant', content: 'Réponse locale', thinking: 'hmm' }, done: true, done_reason: 'stop' }]] });
    const { db, deps } = setup(fake);
    const events = await collect(runChat(deps, { message: 'Un' }));
    const convId = (events[0] as Extract<ChatEvent, { type: 'start' }>).conversationId;
    const sent = toAnthropicMessages(listMessages(db, convId));
    // La réflexion locale n'est jamais transmise à Claude (qui la refuserait).
    expect(JSON.stringify(sent)).not.toContain('local_thinking');
    expect(JSON.stringify(sent)).toContain('Réponse locale');
    expect(() => new Anthropic({ apiKey: 'x' })).not.toThrow();
  });
});

describe('sorties structurées et conversions', () => {
  it('impose le schéma JSON et réessaie une fois si la réponse est invalide', async () => {
    const good = {
      title: 'T', summary: 'S', category: 'tech', tags: ['a'], feasibility: { score: 7, rationale: 'r' }, potential: { score: 5, rationale: 'r' },
      effort: 'low', risks: [], open_questions: [], plan: [{ title: 'p', description: 'd' }], first_action: 'f', verdict: 'explore', verdict_reason: 'v',
    };
    const fake = fakeOllama({ chats: [{ message: { content: '{"oups": true}' } }, { message: { content: JSON.stringify(good) } }] });
    const { deps } = setup(fake);
    const r = await completeStructured(deps, ideaAnalysis, 'sys', 'Analyse');
    expect(r).toMatchObject({ model: 'qwen3:8b', data: { verdict: 'explore' } });
    const req = fake.requests.filter((x) => x.path === '/api/chat');
    expect(req).toHaveLength(2);
    expect(req[0].body.format).toMatchObject({ type: 'object' });
    expect(req[0].body.stream).toBe(false);
  });

  it('abandonne proprement après deux réponses invalides', async () => {
    const fake = fakeOllama({ chats: [{ message: { content: 'pas du json' } }, { message: { content: '{}' } }] });
    await expect(completeStructured(setup(fake).deps, ideaAnalysis, 's', 'p')).rejects.toThrow(/exploitable/);
  });

  it('traduit l’historique (blocs Claude) en messages Ollama', () => {
    const msgs = toOllamaMessages('SYS', [
      { id: '1', conversation_id: 'c', role: 'user', kind: 'user', content: [{ type: 'text', text: 'ctx' }, { type: 'text', text: 'Q' }], text: 'Q', meta: {}, created_at: '' },
      { id: '2', conversation_id: 'c', role: 'assistant', kind: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'text', text: 'Je regarde' }, { type: 'tool_use', id: 'tu1', name: 'get_overview', input: {} }], text: '', meta: {}, created_at: '' },
      { id: '3', conversation_id: 'c', role: 'user', kind: 'tool_results', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: true }], text: '', meta: {}, created_at: '' },
    ]);
    expect(msgs).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'ctx\n\nQ' },
      { role: 'assistant', content: 'Je regarde', tool_calls: [{ function: { name: 'get_overview', arguments: {} } }] },
      { role: 'tool', content: 'ERREUR : ok', tool_name: 'get_overview' },
    ]);
  });

  it('suit la progression d’un téléchargement de modèle', async () => {
    const steps = [];
    for await (const p of ollamaPull({ fetch: fakeOllama().fetch, baseUrl: 'http://x' }, 'qwen3:8b')) steps.push(p.status);
    expect(steps).toEqual(['pulling manifest', 'downloading', 'success']);
  });

  it('modèle absent : message qui explique comment le télécharger', async () => {
    const fake = fakeOllama({ models: [], chats: [] });
    const { deps } = setup(fake);
    await expect(completeStructured(deps, ideaAnalysis, 's', 'p')).rejects.toThrow(/n’est pas installé/);
  });
});
