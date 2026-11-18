/**
 * Bus d'événements interne.
 *
 * Les dépôts émettent des événements métier (« tâche terminée », « idée créée »…)
 * et le moteur d'automatisations s'y abonne. `AsyncLocalStorage` permet de savoir
 * si un événement est émis PENDANT l'exécution d'une automatisation : on évite
 * ainsi les boucles infinies (une automatisation qui se déclencherait elle-même).
 */
import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AutomationEvent } from '../shared/schemas';

export interface BusEvent {
  type: AutomationEvent;
  payload: Record<string, unknown>;
  /** Identifiant de l'automatisation en cours, si l'événement vient d'elle. */
  originAutomationId: string | null;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);
export const automationScope = new AsyncLocalStorage<{ automationId: string }>();

export function emitEvent(type: AutomationEvent, payload: Record<string, unknown>): void {
  const scope = automationScope.getStore();
  const event: BusEvent = { type, payload, originAutomationId: scope?.automationId ?? null };
  // Différé : l'écriture en base qui a déclenché l'événement est terminée avant le traitement.
  setImmediate(() => emitter.emit('event', event));
}

export function onEvent(listener: (event: BusEvent) => void): () => void {
  emitter.on('event', listener);
  return () => emitter.off('event', listener);
}
