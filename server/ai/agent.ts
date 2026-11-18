/**
 * Boucle conversationnelle de NEXUS AI.
 *
 * Fonctionnement d'un tour :
 *  1. on enregistre le message de l'utilisateur (+ contexte) ;
 *  2. on envoie tout l'historique à Claude en streaming ;
 *  3. si Claude demande des outils, on les exécute localement, on enregistre
 *     les résultats et on relance — jusqu'à une réponse finale ;
 *  4. chaque étape est diffusée à l'interface sous forme d'événements.
 *
 * Règle importante : l'historique est en AJOUT SEUL. Les blocs renvoyés par
 * l'API (y compris la réflexion) sont stockés et rejoués à l'identique ; on ne
 * réécrit jamais un message passé. C'est ce qui permet au modèle de réutiliser
 * son raisonnement d'un tour à l'autre et au cache de prompt de fonctionner.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getClient, baseParams, toAppError, type AIDeps } from './client';
import { SYSTEM_PROMPT, initialContext, turnContext } from './prompts';
import { toolDefinitions, executeTool, type ToolEffect } from './tools';
import { getSettings } from '../repos/settings';
import { appendMessage, createConversation, getConversation, listMessages, renameConversation, type StoredMessage } from '../repos/conversations';

type BetaParam = Anthropic.Beta.BetaMessageParam;

export type ChatEvent =
  | { type: 'start'; conversationId: string; title: string }
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; effect?: ToolEffect }
  | { type: 'refusal'; message: string }
  | { type: 'done'; usage: Usage; stopReason: string | null }
  | { type: 'error'; code: string; message: string };

export interface Usage { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const MAX_TOOL_ROUNDS = 12;
const MAX_TOKENS = 32000;

function toApiMessages(stored: StoredMessage[]): BetaParam[] {
  return stored.map((m) => ({ role: m.role, content: m.content }) as BetaParam);
}

/**
 * Si un tour précédent s'est interrompu entre une demande d'outil et sa
 * réponse, on AJOUTE un résultat d'erreur (on ne supprime rien) pour que
 * l'historique reste valide.
 */
function repairDanglingToolUse(deps: AIDeps, conversationId: string, stored: StoredMessage[]): StoredMessage[] {
  const last = stored[stored.length - 1];
  if (!last || last.role !== 'assistant') return stored;
  const pending = (last.content as { type: string; id?: string }[]).filter((b) => b.type === 'tool_use');
  if (pending.length === 0) return stored;
  const fix = appendMessage(deps.db, {
    conversation_id: conversationId,
    role: 'user',
    kind: 'tool_results',
    content: pending.map((b) => ({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: "Exécution interrompue avant d'aboutir." })),
    text: '',
    meta: { repaired: true },
  });
  return [...stored, fix];
}

const titleFrom = (message: string) => {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
};

export async function* runChat(
  deps: AIDeps,
  input: { conversationId?: string | null; message: string },
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  let client: Anthropic;
  try {
    client = getClient(deps);
  } catch (err) {
    const e = toAppError(err);
    yield { type: 'error', code: e.code, message: e.message };
    return;
  }

  const settings = getSettings(deps.db);
  const conversation = input.conversationId ? getConversation(deps.db, input.conversationId) : createConversation(deps.db, settings.ai_model, titleFrom(input.message));
  yield { type: 'start', conversationId: conversation.id, title: conversation.title };

  let history = repairDanglingToolUse(deps, conversation.id, listMessages(deps.db, conversation.id));
  const isFirst = !history.some((m) => m.kind === 'user');
  const userMsg = appendMessage(deps.db, {
    conversation_id: conversation.id,
    role: 'user',
    kind: 'user',
    content: [
      { type: 'text', text: isFirst ? initialContext(deps.db) : turnContext(deps.db) },
      { type: 'text', text: input.message },
    ],
    text: input.message,
    meta: {},
  });
  history = [...history, userMsg];

  const tools = toolDefinitions();
  const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let stopReason: string | null = null;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const params = baseParams(deps);
      const stream = client.beta.messages.stream(
        {
          ...params,
          max_tokens: MAX_TOKENS,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools,
          messages: toApiMessages(history),
          cache_control: { type: 'ephemeral' },
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text };
          else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: event.delta.thinking };
        }
      }
      const message = await stream.finalMessage();
      stopReason = message.stop_reason;
      usage.input_tokens += message.usage.input_tokens ?? 0;
      usage.output_tokens += message.usage.output_tokens ?? 0;
      usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cache_creation_input_tokens += message.usage.cache_creation_input_tokens ?? 0;

      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      const assistant = appendMessage(deps.db, {
        conversation_id: conversation.id,
        role: 'assistant',
        kind: 'assistant',
        content: message.content,
        text,
        meta: { model: message.model, stop_reason: message.stop_reason, usage: message.usage, tools: toolUses.map((t) => ({ id: t.id, name: t.name, input: t.input })) },
      });
      history.push(assistant);

      if (message.stop_reason === 'refusal') {
        yield { type: 'refusal', message: 'Le modèle a refusé de poursuivre cette demande.' };
        break;
      }
      if (message.stop_reason === 'pause_turn') continue;
      if (toolUses.length === 0) break;
      if (message.stop_reason === 'max_tokens') {
        // Entrée d'outil potentiellement tronquée : on ne l'exécute pas.
        history.push(
          appendMessage(deps.db, {
            conversation_id: conversation.id,
            role: 'user',
            kind: 'tool_results',
            content: toolUses.map((t) => ({ type: 'tool_result', tool_use_id: t.id, is_error: true, content: 'Entrée tronquée (limite de longueur atteinte) : non exécuté.' })),
            text: '',
            meta: {},
          }),
        );
        yield { type: 'error', code: 'max_tokens', message: 'Réponse trop longue : interrompue.' };
        break;
      }
      if (round === MAX_TOOL_ROUNDS) {
        history.push(
          appendMessage(deps.db, {
            conversation_id: conversation.id,
            role: 'user',
            kind: 'tool_results',
            content: toolUses.map((t) => ({ type: 'tool_result', tool_use_id: t.id, is_error: true, content: "Limite d'actions par tour atteinte." })),
            text: '',
            meta: {},
          }),
        );
        yield { type: 'error', code: 'too_many_steps', message: "Trop d'actions enchaînées dans un seul tour : arrêt par sécurité." };
        break;
      }

      const allowWrites = getSettings(deps.db).ai_allow_writes;
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      const resultMeta: unknown[] = [];
      for (const t of toolUses) {
        yield { type: 'tool_start', id: t.id, name: t.name, input: t.input };
        const outcome = executeTool(t.name, t.input, { db: deps.db, allowWrites });
        results.push({ type: 'tool_result', tool_use_id: t.id, content: outcome.content, ...(outcome.ok ? {} : { is_error: true }) });
        resultMeta.push({ id: t.id, name: t.name, ok: outcome.ok, summary: outcome.summary, effect: outcome.effect });
        yield { type: 'tool_result', id: t.id, name: t.name, ok: outcome.ok, summary: outcome.summary, effect: outcome.effect };
      }
      history.push(
        appendMessage(deps.db, {
          conversation_id: conversation.id,
          role: 'user',
          kind: 'tool_results',
          content: results,
          text: '',
          meta: { results: resultMeta },
        }),
      );
    }
    if (isFirst && conversation.title === 'Nouvelle conversation') renameConversation(deps.db, conversation.id, titleFrom(input.message));
    yield { type: 'done', usage, stopReason };
  } catch (err) {
    const e = toAppError(err);
    yield { type: 'error', code: e.code, message: e.message };
  }
}

/** Historique formaté pour l'interface (texte visible + traces d'outils). */
export function conversationView(deps: AIDeps, conversationId: string) {
  const conversation = getConversation(deps.db, conversationId);
  const stored = listMessages(deps.db, conversationId);
  const results = new Map<string, { ok: boolean; summary: string; effect?: ToolEffect }>();
  for (const m of stored) {
    if (m.kind === 'tool_results') for (const r of (m.meta.results as { id: string; ok: boolean; summary: string; effect?: ToolEffect }[]) ?? []) results.set(r.id, r);
  }
  // Un « tour » visible de l'assistant regroupe plusieurs messages API consécutifs.
  const turns: { id: string; role: 'user' | 'assistant'; created_at: string; parts: ({ type: 'text'; text: string } | { type: 'thinking'; text: string } | { type: 'tool'; id: string; name: string; input: unknown; ok?: boolean; summary?: string; effect?: ToolEffect })[]; usage?: unknown }[] = [];
  for (const m of stored) {
    if (m.kind === 'user') {
      turns.push({ id: m.id, role: 'user', created_at: m.created_at, parts: [{ type: 'text', text: m.text }] });
      continue;
    }
    if (m.kind !== 'assistant') continue;
    let turn = turns[turns.length - 1];
    if (!turn || turn.role !== 'assistant') {
      turn = { id: m.id, role: 'assistant', created_at: m.created_at, parts: [] };
      turns.push(turn);
    }
    for (const b of m.content as { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }[]) {
      if (b.type === 'text' && b.text) turn.parts.push({ type: 'text', text: b.text });
      else if (b.type === 'thinking' && b.thinking) turn.parts.push({ type: 'thinking', text: b.thinking });
      else if (b.type === 'tool_use') turn.parts.push({ type: 'tool', id: b.id!, name: b.name!, input: b.input, ...results.get(b.id!) });
    }
  }
  return { conversation, turns };
}
