/**
 * Tests de la couche IA — avec un client Claude SIMULÉ (aucun appel réseau, aucun coût).
 * On vérifie la mécanique : boucle d'outils, persistance, historique en ajout seul,
 * contrôle d'accès, gestion des erreurs.
 */
import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { testDb, testSecrets } from './helpers';
import { runChat, conversationView, type ChatEvent } from '../server/ai/agent';
import { executeTool, toolDefinitions, TOOLS } from '../server/ai/tools';
import { toAppError } from '../server/ai/client';
import { listTasks } from '../server/repos/tasks';
import { listMessages, appendMessage, createConversation } from '../server/repos/conversations';
import { updateSettings } from '../server/repos/settings';
import { listMemories } from '../server/repos/notes';
import { SYSTEM_PROMPT } from '../server/ai/prompts';

type Block = Record<string, unknown>;
interface Scripted { content: Block[]; stop_reason: string }

/** Faux client : rejoue un scénario de réponses et enregistre les requêtes reçues. */
function fakeClient(script: Scripted[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: Record<string, unknown>) => {
          requests.push(JSON.parse(JSON.stringify(params)));
          const msg = script.shift();
          if (!msg) throw new Error('scénario épuisé');
          return {
            async *[Symbol.asyncIterator]() {
              for (const b of msg.content) {
                if (b.type === 'thinking') yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: b.thinking } };
                if (b.type === 'text') yield { type: 'content_block_delta', delta: { type: 'text_delta', text: b.text } };
              }
            },
            finalMessage: async () => ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-test', content: msg.content, stop_reason: msg.stop_reason, usage: { input_tokens: 10, output_tokens: 5 } }),
          };
        },
      },
    },
  };
  return { requests, makeClient: () => client as unknown as Anthropic };
}

async function collect(gen: AsyncGenerator<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('outils IA', () => {
  it('produit des définitions JSON Schema valides et uniques', () => {
    const defs = toolDefinitions();
    expect(new Set(defs.map((d) => d.name)).size).toBe(TOOLS.length);
    for (const d of defs) {
      expect(d.input_schema.type).toBe('object');
      expect(d.input_schema).not.toHaveProperty('$schema');
      expect(d.description!.length).toBeGreaterThan(10);
    }
    // Ordre et contenu stables (indispensable pour le cache et l'historique en ajout seul)
    expect(JSON.stringify(toolDefinitions())).toBe(JSON.stringify(defs));
  });

  it('valide les paramètres et renvoie une erreur exploitable', () => {
    const db = testDb();
    const r = executeTool('create_task', { title: '' }, { db, allowWrites: true });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Paramètres invalides/);
    expect(executeTool('outil_inconnu', {}, { db, allowWrites: true }).ok).toBe(false);
  });

  it('bloque les écritures en mode lecture seule, mais pas les lectures', () => {
    const db = testDb();
    const blocked = executeTool('create_task', { title: 'X' }, { db, allowWrites: false });
    expect(blocked.ok).toBe(false);
    expect(listTasks(db)).toHaveLength(0);
    expect(executeTool('get_overview', {}, { db, allowWrites: false }).ok).toBe(true);
    const ok = executeTool('create_task', { title: 'X', priority: 1 }, { db, allowWrites: true });
    expect(ok.ok).toBe(true);
    expect(ok.effect).toMatchObject({ kind: 'task', action: 'created' });
    expect(listTasks(db)[0].source).toBe('ai');
  });

  it('remonte les erreurs métier sans planter', () => {
    const db = testDb();
    const r = executeTool('get_project', { project_id: 'prj_inexistant' }, { db, allowWrites: true });
    expect(r).toMatchObject({ ok: false });
    expect(r.content).toMatch(/introuvable/);
  });
});

describe('boucle conversationnelle', () => {
  it('refuse proprement sans clé API', async () => {
    const db = testDb();
    const events = await collect(runChat({ db, secrets: testSecrets(false) }, { message: 'Salut' }));
    expect(events).toEqual([{ type: 'error', code: 'no_api_key', message: expect.any(String) }]);
  });

  it('exécute les outils demandés, persiste tout et diffuse les événements', async () => {
    const db = testDb();
    const { requests, makeClient } = fakeClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: 'Je crée la tâche.', signature: 'sig' },
          { type: 'tool_use', id: 'tu_1', name: 'create_task', input: { title: 'Appeler Paul', priority: 1 } },
          { type: 'tool_use', id: 'tu_2', name: 'remember', input: { content: 'Paul est son associé', kind: 'fact', importance: 4 } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'C’est fait : tâche créée.' }] },
    ]);
    const deps = { db, secrets: testSecrets(true), makeClient };
    const events = await collect(runChat(deps, { message: 'Rappelle-moi d’appeler Paul, mon associé' }));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('start');
    expect(types).toContain('thinking');
    expect(types.filter((t) => t === 'tool_result')).toHaveLength(2);
    expect(types.at(-1)).toBe('done');
    expect(listTasks(db)[0].title).toBe('Appeler Paul');
    expect(listMemories(db)[0].content).toBe('Paul est son associé');

    // Deuxième requête : contient la demande d'outil ET les deux résultats dans UN seul message.
    const second = requests[1].messages as { role: string; content: Block[] }[];
    const last = second[second.length - 1];
    expect(last.role).toBe('user');
    expect(last.content.map((b) => b.tool_use_id)).toEqual(['tu_1', 'tu_2']);
    // Le système est statique et mis en cache ; les outils sont toujours tous déclarés.
    expect((requests[0].system as Block[])[0]).toMatchObject({ text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } });
    expect((requests[0].tools as unknown[]).length).toBe(TOOLS.length);

    const start = events[0] as Extract<ChatEvent, { type: 'start' }>;
    const view = conversationView(deps, start.conversationId);
    expect(view.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(view.turns[1].parts.filter((p) => p.type === 'tool')).toHaveLength(2);
  });

  it('garde un historique strictement en ajout seul d’un tour à l’autre', async () => {
    const db = testDb();
    const { requests, makeClient } = fakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'a', signature: 's1' }, { type: 'text', text: 'Réponse 1' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Réponse 2' }] },
    ]);
    const deps = { db, secrets: testSecrets(true), makeClient };
    const first = await collect(runChat(deps, { message: 'Un' }));
    const convId = (first[0] as Extract<ChatEvent, { type: 'start' }>).conversationId;
    await collect(runChat(deps, { conversationId: convId, message: 'Deux' }));
    const m1 = requests[0].messages as unknown[];
    const m2 = requests[1].messages as unknown[];
    // Le préfixe envoyé au 2e tour est identique, octet pour octet, à ce qui a été envoyé et reçu au 1er.
    expect(JSON.stringify(m2.slice(0, m1.length))).toBe(JSON.stringify(m1));
    expect(JSON.stringify(m2[m1.length])).toContain('signature'); // la réflexion est rejouée intacte
    expect(requests[1].system).toEqual(requests[0].system);
    expect(requests[1].tools).toEqual(requests[0].tools);
  });

  it('les outils d’écriture restent déclarés en lecture seule (blocage à l’exécution)', async () => {
    const db = testDb();
    updateSettings(db, { ai_allow_writes: false });
    const { requests, makeClient } = fakeClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'create_task', input: { title: 'X' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Je ne peux pas.' }] },
    ]);
    const events = await collect(runChat({ db, secrets: testSecrets(true), makeClient }, { message: 'Crée X' }));
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false });
    expect(listTasks(db)).toHaveLength(0);
    expect((requests[0].tools as unknown[]).length).toBe(TOOLS.length);
  });

  it('répare un tour interrompu en AJOUTANT un résultat d’erreur', async () => {
    const db = testDb();
    const conv = createConversation(db, 'claude-opus-5-5');
    appendMessage(db, { conversation_id: conv.id, role: 'user', kind: 'user', content: [{ type: 'text', text: 'hey' }], text: 'hey', meta: {} });
    appendMessage(db, { conversation_id: conv.id, role: 'assistant', kind: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'get_overview', input: {} }], text: '', meta: {} });
    const { requests, makeClient } = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]);
    await collect(runChat({ db, secrets: testSecrets(true), makeClient }, { conversationId: conv.id, message: 'Tu es là ?' }));
    const sent = requests[0].messages as { role: string; content: Block[] }[];
    expect(sent[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_x', is_error: true });
    expect(listMessages(db, conv.id)).toHaveLength(5);
  });

  it('n’exécute pas un outil dont l’entrée a été tronquée', async () => {
    const db = testDb();
    const { makeClient } = fakeClient([{ stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 'tu_1', name: 'create_task', input: { title: 'Trun' } }] }]);
    const events = await collect(runChat({ db, secrets: testSecrets(true), makeClient }, { message: 'x' }));
    expect(events.some((e) => e.type === 'error' && e.code === 'max_tokens')).toBe(true);
    expect(listTasks(db)).toHaveLength(0);
  });

  it('signale un refus du modèle', async () => {
    const db = testDb();
    const { makeClient } = fakeClient([{ stop_reason: 'refusal', content: [] }]);
    const events = await collect(runChat({ db, secrets: testSecrets(true), makeClient }, { message: 'x' }));
    expect(events.some((e) => e.type === 'refusal')).toBe(true);
  });
});

describe('erreurs API', () => {
  it('traduit les erreurs du SDK en messages clairs', () => {
    const h = new Headers({ 'retry-after': '12' });
    expect(toAppError(new Anthropic.AuthenticationError(401, {}, 'bad', h)).code).toBe('invalid_api_key');
    const rl = toAppError(new Anthropic.RateLimitError(429, {}, 'slow', h));
    expect(rl.code).toBe('rate_limited');
    expect(rl.message).toContain('12');
    expect(toAppError(new Anthropic.InternalServerError(529, {}, 'overloaded', h)).code).toBe('overloaded');
    expect(toAppError(new Anthropic.APIConnectionError({ message: 'down' })).code).toBe('network');
    expect(toAppError(new Error('boom')).code).toBe('internal');
  });
});
