/**
 * Aiguillage entre les deux « cerveaux » possibles de NEXUS :
 *  - Ollama : IA locale, gratuite et privée, qui tourne sur le Mac ;
 *  - Claude (Anthropic) : plus intelligent, payant à l'usage, clé API requise.
 *
 * Le reste de l'application (agent, outils, mémoire, Jarvis, analyses) appelle
 * uniquement les fonctions de ce fichier : changer d'IA se fait dans les Réglages,
 * sans toucher au code.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { getClient, baseParams, toAppError, type AIDeps } from './client';
import { ollamaComplete, ollamaStatus, ollamaTurn, isInstalled, RECOMMENDED_OLLAMA_MODEL, type TurnResult, type OllamaModel } from './ollama';
import { AppError } from '../lib/errors';
import { getSettings } from '../repos/settings';
import type { StoredMessage } from '../repos/conversations';

export type { TurnResult };
export type Provider = 'anthropic' | 'ollama';

const MAX_TOKENS = 32000;

export function activeProvider(deps: AIDeps): Provider {
  return getSettings(deps.db).ai_provider;
}

export function activeModel(deps: AIDeps): string {
  const s = getSettings(deps.db);
  return s.ai_provider === 'ollama' ? s.ollama_model : s.ai_model;
}

/** Effort « élevé » ou plus : on laisse un modèle local réfléchir (plus lent, plus juste). */
const localThinking = (effort: string) => ['high', 'xhigh', 'max'].includes(effort);

/** Blocs propres à NEXUS qu'on ne doit jamais envoyer à Claude. */
const LOCAL_ONLY_BLOCKS = new Set(['local_thinking']);

export function toAnthropicMessages(stored: StoredMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return stored.map((m) => ({ role: m.role, content: (m.content as { type: string }[]).filter((b) => !LOCAL_ONLY_BLOCKS.has(b.type)) }) as Anthropic.Beta.BetaMessageParam);
}

/**
 * Un tour de modèle : diffuse le texte/la réflexion, puis renvoie le message complet
 * (au format de blocs de Claude, quel que soit le fournisseur).
 */
export async function* modelTurn(
  deps: AIDeps,
  o: { system: string; history: StoredMessage[]; tools: Anthropic.Beta.BetaTool[]; signal?: AbortSignal },
): AsyncGenerator<{ type: 'text' | 'thinking'; delta: string }, TurnResult & { usage: Record<string, number> }> {
  const s = getSettings(deps.db);
  if (s.ai_provider === 'ollama') {
    return yield* ollamaTurn(deps.ollama ?? {}, {
      model: s.ollama_model,
      system: o.system,
      history: o.history,
      tools: o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      think: localThinking(s.ai_effort),
      signal: o.signal,
    });
  }

  const client = getClient(deps);
  const stream = client.beta.messages.stream(
    {
      ...baseParams(deps),
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
      tools: o.tools,
      messages: toAnthropicMessages(o.history),
      cache_control: { type: 'ephemeral' },
    },
    { signal: o.signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text };
      else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: event.delta.thinking };
    }
  }
  const message = await stream.finalMessage();
  return {
    content: message.content as unknown as Record<string, unknown>[],
    stop_reason: message.stop_reason,
    model: message.model,
    usage: {
      input_tokens: message.usage.input_tokens ?? 0,
      output_tokens: message.usage.output_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/** Réponse structurée (JSON validé par un schéma Zod). */
export async function completeStructured<S extends z.ZodType>(deps: AIDeps, schema: S, system: string, prompt: string, effort?: string): Promise<{ data: z.infer<S>; model: string }> {
  const s = getSettings(deps.db);
  if (s.ai_provider === 'ollama') {
    const format = z.toJSONSchema(schema);
    const instruction = `${prompt}\n\nRéponds UNIQUEMENT avec un objet JSON conforme au schéma demandé, en français.`;
    // Les petits modèles se trompent parfois de format : un second essai suffit en général.
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await ollamaComplete(deps.ollama ?? {}, { model: s.ollama_model, system, prompt: instruction, format, think: localThinking(effort ?? s.ai_effort) });
      try {
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) return { data: parsed.data, model: s.ollama_model };
        lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; ');
      } catch {
        lastError = 'JSON illisible';
      }
    }
    throw new AppError(502, 'invalid_output', `Le modèle local n’a pas produit une réponse exploitable (${lastError}). Réessaie, ou choisis un modèle plus grand.`);
  }

  const client = getClient(deps);
  try {
    const res = await client.beta.messages.parse({
      ...baseParams(deps, { effort }),
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { ...baseParams(deps, { effort }).output_config, format: betaZodOutputFormat(schema) },
    });
    if (res.stop_reason === 'refusal') throw new AppError(422, 'refusal', 'Le modèle a refusé cette demande.');
    if (res.stop_reason === 'max_tokens') throw new AppError(502, 'truncated', 'Réponse tronquée : réessaie.');
    if (!res.parsed_output) throw new AppError(502, 'invalid_output', "La réponse de l'IA n'a pas pu être interprétée.");
    return { data: res.parsed_output as z.infer<S>, model: res.model };
  } catch (err) {
    throw toAppError(err);
  }
}

/** Réponse texte simple (étape « Demander à l'IA » des automatisations). */
export async function completeText(deps: AIDeps, prompt: string, effort: string): Promise<string> {
  const s = getSettings(deps.db);
  if (s.ai_provider === 'ollama') return (await ollamaComplete(deps.ollama ?? {}, { model: s.ollama_model, prompt, think: localThinking(effort) })).trim();
  const client = getClient(deps);
  try {
    const res = await client.beta.messages.create({ ...baseParams(deps, { effort }), max_tokens: 8000, messages: [{ role: 'user', content: prompt }] });
    if (res.stop_reason === 'refusal') throw new Error('Le modèle a refusé la consigne.');
    return res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
  } catch (err) {
    throw toAppError(err);
  }
}

export interface AIReadiness {
  provider: Provider;
  model: string;
  online: boolean;
  /** Pourquoi l'IA n'est pas disponible (affiché tel quel). */
  reason: string | null;
  ollama: { reachable: boolean; version: string | null; models: OllamaModel[]; modelInstalled: boolean; recommended: string } | null;
}

/** L'IA est-elle prête ? (clé présente pour Claude ; Ollama lancé et modèle installé sinon) */
export async function aiReadiness(deps: AIDeps): Promise<AIReadiness> {
  const s = getSettings(deps.db);
  if (s.ai_provider === 'ollama') {
    const st = await ollamaStatus(deps.ollama ?? {});
    const installed = isInstalled(st.models, s.ollama_model);
    return {
      provider: 'ollama',
      model: s.ollama_model,
      online: st.reachable && installed,
      reason: !st.reachable ? 'Ollama n’est pas lancé sur ce Mac.' : !installed ? `Le modèle ${s.ollama_model} n’est pas encore téléchargé.` : null,
      ollama: { ...st, modelInstalled: installed, recommended: RECOMMENDED_OLLAMA_MODEL },
    };
  }
  const configured = deps.secrets.status().configured;
  return { provider: 'anthropic', model: s.ai_model, online: configured, reason: configured ? null : 'Aucune clé API Anthropic configurée.', ollama: null };
}
