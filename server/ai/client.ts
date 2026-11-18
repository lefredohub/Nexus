/**
 * Fabrique du client Claude + traduction des erreurs API en messages clairs.
 *
 * NEXUS héberge lui-même sa boucle d'agent (API Messages + outils locaux) :
 * les outils lisent/écrivent ta base SQLite locale, ils doivent donc s'exécuter
 * sur ta machine. Aucune donnée n'est envoyée ailleurs qu'à l'API Anthropic,
 * et uniquement au moment où tu utilises une fonction IA.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { DB } from '../db/client';
import type { SecretStore } from './secrets';
import { AppError } from '../lib/errors';
import { getSettings } from '../repos/settings';

export interface AIDeps {
  db: DB;
  secrets: SecretStore;
  /** Injectable pour les tests (client simulé). */
  makeClient?: (apiKey: string) => Anthropic;
}

export function getClient(deps: AIDeps): Anthropic {
  const key = deps.secrets.getApiKey();
  if (!key) throw new AppError(400, 'no_api_key', 'Aucune clé API Anthropic configurée. Ajoute-la dans Réglages.');
  return deps.makeClient ? deps.makeClient(key) : new Anthropic({ apiKey: key, maxRetries: 3, timeout: 10 * 60 * 1000 });
}

/** Modèles qui acceptent le repli automatique côté serveur en cas de refus. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']);

/**
 * Paramètres communs à toutes les requêtes :
 * - réflexion adaptative (le modèle décide quand réfléchir), résumé visible ;
 * - niveau d'effort réglable dans les Réglages ;
 * - repli serveur (`fallbacks: "default"`) : si un classifieur de sécurité refuse
 *   à tort, l'API relance la même requête sur un modèle de repli adapté.
 */
export function baseParams(deps: AIDeps, opts: { effort?: string } = {}) {
  const s = getSettings(deps.db);
  const model = s.ai_model;
  const withFallback = FALLBACK_MODELS.has(model);
  return {
    model,
    thinking: { type: 'adaptive' as const, display: 'summarized' as const },
    output_config: { effort: (opts.effort ?? s.ai_effort) as 'low' | 'medium' | 'high' | 'xhigh' | 'max' },
    ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const } : {}),
  };
}

/** Traduit une erreur du SDK en AppError lisible (du plus spécifique au plus général). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AppError(400, 'aborted', 'Requête interrompue.');
  if (err instanceof Anthropic.AuthenticationError) return new AppError(401, 'invalid_api_key', 'Clé API refusée par Anthropic. Vérifie-la dans Réglages.');
  if (err instanceof Anthropic.PermissionDeniedError) return new AppError(403, 'permission_denied', "Ta clé n'a pas accès à ce modèle ou à cette fonctionnalité.");
  if (err instanceof Anthropic.NotFoundError) return new AppError(400, 'model_not_found', 'Modèle introuvable pour ce compte. Choisis-en un autre dans Réglages.');
  if (err instanceof Anthropic.RateLimitError) {
    const retry = err.headers?.get?.('retry-after');
    return new AppError(429, 'rate_limited', `Limite de requêtes atteinte${retry ? ` — réessaie dans ${retry} s` : ', réessaie dans un instant'}.`);
  }
  if (err instanceof Anthropic.BadRequestError) return new AppError(400, 'bad_request', `Requête refusée par l'API : ${err.message}`);
  if (err instanceof Anthropic.InternalServerError) return new AppError(503, 'overloaded', "L'API Anthropic est momentanément surchargée. Réessaie dans quelques secondes.");
  if (err instanceof Anthropic.APIConnectionError) return new AppError(502, 'network', "Impossible de joindre l'API Anthropic (connexion réseau ?).");
  if (err instanceof Anthropic.APIError) return new AppError(502, 'api_error', `Erreur API (${err.status ?? '?'}) : ${err.message}`);
  return new AppError(500, 'internal', err instanceof Error ? err.message : 'Erreur inattendue');
}
