/**
 * Catalogue des étapes d'automatisation.
 *
 * Pour ajouter une étape (ex. « envoyer sur Slack ») :
 *  1. déclare un objet StepDefinition ci-dessous (schéma de config + `run`) ;
 *  2. ajoute-le à STEP_TYPES.
 * L'interface (Automation Lab) génère automatiquement le formulaire à partir de `fields`.
 */
import { z } from 'zod';
import type { DB } from '../db/client';
import { todayISO, addDays } from '../db/client';
import { createTask } from '../repos/tasks';
import { createNote, createMemory } from '../repos/notes';
import { addMetricEntry } from '../repos/analytics';
import { logActivity } from '../repos/activity';
import { getClient, baseParams, toAppError, type AIDeps } from '../ai/client';

export interface StepContext {
  db: DB;
  ai: AIDeps;
  dryRun: boolean;
  fetch: typeof fetch;
}

export interface StepField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select';
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
}

export interface StepResult {
  output: unknown;
  /** `false` = arrêter l'automatisation proprement (ex. condition non remplie). */
  continue?: boolean;
  note?: string;
}

export interface StepDefinition<C extends z.ZodType = z.ZodType> {
  type: string;
  label: string;
  description: string;
  category: 'nexus' | 'ai' | 'logic' | 'external';
  /** `true` si l'étape modifie des données ou contacte l'extérieur (sautée en simulation). */
  sideEffect: boolean;
  config: C;
  fields: StepField[];
  run: (config: z.output<C>, ctx: StepContext) => Promise<StepResult>;
}

const define = <C extends z.ZodType>(s: StepDefinition<C>) => s as unknown as StepDefinition;
const num = z.coerce.number();

const createTaskStep = define({
  type: 'create_task',
  label: 'Créer une tâche',
  description: 'Ajoute une tâche dans NEXUS.',
  category: 'nexus',
  sideEffect: true,
  config: z.object({ title: z.string().min(1), priority: num.int().min(1).max(3).default(2), due_in_days: num.int().min(0).max(365).optional(), project_id: z.string().optional() }),
  fields: [
    { key: 'title', label: 'Titre', type: 'text', placeholder: 'Revue hebdo — {{today}}' },
    { key: 'priority', label: 'Priorité', type: 'select', options: [{ value: '1', label: 'Haute' }, { value: '2', label: 'Normale' }, { value: '3', label: 'Basse' }] },
    { key: 'due_in_days', label: 'Échéance (jours)', type: 'number', placeholder: '0 = aujourd’hui' },
    { key: 'project_id', label: 'Projet (id, optionnel)', type: 'text' },
  ],
  run: async (c, { db }) => {
    const t = createTask(
      db,
      { title: c.title.slice(0, 200), priority: c.priority as 1 | 2 | 3, due_date: c.due_in_days !== undefined ? addDays(todayISO(), c.due_in_days) : null, project_id: c.project_id || null },
      'automation',
    );
    return { output: { id: t.id, title: t.title } };
  },
});

const createNoteStep = define({
  type: 'create_note',
  label: 'Créer une note',
  description: 'Enregistre une note dans le Memory Graph.',
  category: 'nexus',
  sideEffect: true,
  config: z.object({ title: z.string().min(1), content: z.string().default('') }),
  fields: [
    { key: 'title', label: 'Titre', type: 'text' },
    { key: 'content', label: 'Contenu', type: 'textarea', placeholder: '{{steps.ia.output}}' },
  ],
  run: async (c, { db }) => {
    const n = createNote(db, { title: c.title.slice(0, 200), content: c.content }, 'automation');
    return { output: { id: n.id } };
  },
});

const rememberStep = define({
  type: 'remember',
  label: 'Mémoriser',
  description: 'Ajoute une information à la mémoire long terme de NEXUS AI.',
  category: 'nexus',
  sideEffect: true,
  config: z.object({ content: z.string().min(3), importance: num.int().min(1).max(5).default(3) }),
  fields: [
    { key: 'content', label: 'Information', type: 'textarea' },
    { key: 'importance', label: 'Importance (1-5)', type: 'number' },
  ],
  run: async (c, { db }) => {
    const m = createMemory(db, { content: c.content.slice(0, 2000), kind: 'context', importance: c.importance }, 'automation');
    return { output: { id: m.id } };
  },
});

const logMetricStep = define({
  type: 'log_metric',
  label: 'Enregistrer une métrique',
  description: 'Ajoute une valeur à une métrique suivie.',
  category: 'nexus',
  sideEffect: true,
  config: z.object({ metric_id: z.string().min(1), value: num }),
  fields: [
    { key: 'metric_id', label: 'Métrique (id)', type: 'text' },
    { key: 'value', label: 'Valeur', type: 'text', placeholder: '42 ou {{steps.x.output}}' },
  ],
  run: async (c, { db }) => {
    const e = addMetricEntry(db, c.metric_id, { date: todayISO(), value: c.value }, 'automation', 'automation');
    return { output: { id: e.id, value: e.value } };
  },
});

const notifyStep = define({
  type: 'notify',
  label: 'Notifier',
  description: 'Publie un message dans le flux d’activité du Command Center.',
  category: 'nexus',
  sideEffect: true,
  config: z.object({ title: z.string().min(1), message: z.string().default('') }),
  fields: [
    { key: 'title', label: 'Titre', type: 'text' },
    { key: 'message', label: 'Message', type: 'textarea' },
  ],
  run: async (c, { db }) => {
    logActivity(db, { kind: 'automation.notify', title: c.title.slice(0, 200), detail: c.message.slice(0, 2000), actor: 'automation' });
    return { output: { title: c.title } };
  },
});

const aiPromptStep = define({
  type: 'ai_prompt',
  label: 'Demander à Claude',
  description: 'Envoie une consigne à Claude et récupère sa réponse texte (utilisable par les étapes suivantes).',
  category: 'ai',
  sideEffect: true,
  config: z.object({ prompt: z.string().min(1), effort: z.enum(['low', 'medium', 'high']).default('low') }),
  fields: [
    { key: 'prompt', label: 'Consigne', type: 'textarea', placeholder: 'Résume en 3 points : {{trigger.idea.content}}' },
    { key: 'effort', label: 'Effort', type: 'select', options: [{ value: 'low', label: 'Rapide' }, { value: 'medium', label: 'Équilibré' }, { value: 'high', label: 'Approfondi' }] },
  ],
  run: async (c, { ai }) => {
    const client = getClient(ai);
    try {
      const res = await client.beta.messages.create({ ...baseParams(ai, { effort: c.effort }), max_tokens: 8000, messages: [{ role: 'user', content: c.prompt }] });
      if (res.stop_reason === 'refusal') throw new Error('Le modèle a refusé la consigne.');
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
      return { output: text };
    } catch (err) {
      throw toAppError(err);
    }
  },
});

const httpStep = define({
  type: 'http_request',
  label: 'Requête HTTP',
  description: 'Appelle une API externe (webhook, service tiers). Prépare l’intégration d’outils et d’agents externes.',
  category: 'external',
  sideEffect: true,
  config: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    url: z.string().url().refine((u) => /^https?:\/\//.test(u), 'URL http(s) requise'),
    headers: z.string().default(''),
    body: z.string().default(''),
  }),
  fields: [
    { key: 'method', label: 'Méthode', type: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m })) },
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://hooks.example.com/…' },
    { key: 'headers', label: 'En-têtes (une par ligne, Nom: valeur)', type: 'textarea' },
    { key: 'body', label: 'Corps (JSON ou texte)', type: 'textarea', placeholder: '{"text": "{{trigger.task.title}}"}' },
  ],
  run: async (c, { fetch }) => {
    const headers: Record<string, string> = {};
    for (const line of c.headers.split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    if (c.body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = c.body.trim().startsWith('{') || c.body.trim().startsWith('[') ? 'application/json' : 'text/plain';
    }
    const res = await fetch(c.url, { method: c.method, headers, body: c.method === 'GET' ? undefined : c.body || undefined, signal: AbortSignal.timeout(20_000) });
    const text = (await res.text()).slice(0, 20_000);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* réponse non JSON */
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
    return { output: { status: res.status, body: json ?? text } };
  },
});

const conditionStep = define({
  type: 'condition',
  label: 'Condition',
  description: 'Continue seulement si la condition est vraie ; sinon arrête proprement.',
  category: 'logic',
  sideEffect: false,
  config: z.object({ left: z.string().default(''), operator: z.enum(['equals', 'not_equals', 'contains', 'gt', 'lt', 'not_empty']), right: z.string().default('') }),
  fields: [
    { key: 'left', label: 'Valeur', type: 'text', placeholder: '{{trigger.task.priority}}' },
    { key: 'operator', label: 'Opérateur', type: 'select', options: [
      { value: 'equals', label: 'est égal à' }, { value: 'not_equals', label: 'est différent de' }, { value: 'contains', label: 'contient' },
      { value: 'gt', label: 'est supérieur à' }, { value: 'lt', label: 'est inférieur à' }, { value: 'not_empty', label: "n'est pas vide" },
    ] },
    { key: 'right', label: 'Comparé à', type: 'text' },
  ],
  run: async (c) => {
    const l = c.left.trim();
    const r = c.right.trim();
    const ok =
      c.operator === 'equals' ? l === r :
      c.operator === 'not_equals' ? l !== r :
      c.operator === 'contains' ? l.toLowerCase().includes(r.toLowerCase()) :
      c.operator === 'gt' ? Number(l) > Number(r) :
      c.operator === 'lt' ? Number(l) < Number(r) :
      l !== '';
    return { output: ok, continue: ok, note: ok ? 'Condition vraie' : 'Condition fausse : arrêt' };
  },
});

export const STEP_TYPES: StepDefinition[] = [createTaskStep, createNoteStep, notifyStep, rememberStep, logMetricStep, aiPromptStep, httpStep, conditionStep];
export const STEP_BY_TYPE = new Map(STEP_TYPES.map((s) => [s.type, s]));

/** Catalogue exposé à l'interface (sans les fonctions). */
export function stepCatalog() {
  return STEP_TYPES.map(({ type, label, description, category, sideEffect, fields }) => ({ type, label, description, category, sideEffect, fields }));
}
