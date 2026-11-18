/**
 * Moteur d'automatisations : stockage, exécution (réelle ou simulée),
 * planification et déclenchement sur événement.
 */
import { z } from 'zod';
import { type DB, all, get, run, newId, nowISO, todayISO, parseJSON, buildUpdate } from '../db/client';
import { automationInput, automationPatch, type AutomationStep, type AutomationTrigger } from '../../shared/schemas';
import { AppError, notFound } from '../lib/errors';
import { automationScope, onEvent, type BusEvent } from '../events';
import { logActivity } from '../repos/activity';
import { renderDeep, SIMULATED, type TemplateScope } from './template';
import { STEP_BY_TYPE, type StepContext } from './steps';
import type { AIDeps } from '../ai/client';

export interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  last_status?: string | null;
  run_count?: number;
}

export interface StepLog {
  step_id: string;
  type: string;
  name: string;
  status: 'success' | 'error' | 'skipped' | 'simulated' | 'stopped';
  started_at: string;
  duration_ms: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  note?: string;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  status: 'running' | 'success' | 'error' | 'stopped';
  dry_run: boolean;
  trigger_payload: unknown;
  log: StepLog[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const hydrate = (r: Record<string, unknown>): Automation => ({
  ...(r as unknown as Automation),
  enabled: r.enabled === 1,
  trigger: parseJSON<AutomationTrigger>(r.trigger, { type: 'manual' }),
  steps: parseJSON<AutomationStep[]>(r.steps, []),
});

const hydrateRun = (r: Record<string, unknown>): AutomationRun => ({
  ...(r as unknown as AutomationRun),
  dry_run: r.dry_run === 1,
  trigger_payload: parseJSON(r.trigger_payload, {}),
  log: parseJSON<StepLog[]>(r.log, []),
});

// ─── Planification ───────────────────────────────────────────────────────────

/** Prochaine exécution d'un déclencheur planifié, à partir de `from`. */
export function computeNextRun(trigger: AutomationTrigger, from: Date = new Date()): string | null {
  if (trigger.type !== 'schedule') return null;
  const unitMs = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[trigger.unit];
  if (trigger.unit === 'days' && trigger.at) {
    const [h, m] = trigger.at.split(':').map(Number);
    const next = new Date(from);
    next.setHours(h, m, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    // Tous les N jours : on ajoute (N-1) jours supplémentaires après la première occurrence.
    if (trigger.every > 1) next.setDate(next.getDate() + (trigger.every - 1));
    return next.toISOString();
  }
  return new Date(from.getTime() + trigger.every * unitMs).toISOString();
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

function validateSteps(steps: AutomationStep[]) {
  const ids = new Set<string>();
  for (const s of steps) {
    if (!STEP_BY_TYPE.has(s.type)) throw new AppError(422, 'unknown_step', `Type d'étape inconnu : ${s.type}`);
    if (ids.has(s.id)) throw new AppError(422, 'duplicate_step', `Identifiant d'étape dupliqué : ${s.id}`);
    ids.add(s.id);
  }
}

export function listAutomations(db: DB): Automation[] {
  return all(
    db,
    `SELECT a.*, (SELECT status FROM automation_runs r WHERE r.automation_id = a.id AND r.dry_run = 0 ORDER BY started_at DESC LIMIT 1) AS last_status,
            (SELECT count(*) FROM automation_runs r WHERE r.automation_id = a.id AND r.dry_run = 0) AS run_count
     FROM automations a ORDER BY a.created_at DESC`,
  ).map(hydrate);
}

export function getAutomation(db: DB, id: string): Automation {
  const r = get(db, 'SELECT * FROM automations WHERE id = :id', { id });
  if (!r) throw notFound('Automatisation');
  return hydrate(r);
}

export function createAutomation(db: DB, input: z.input<typeof automationInput>): Automation {
  const d = automationInput.parse(input);
  validateSteps(d.steps);
  const id = newId('aut');
  const now = nowISO();
  run(db, 'INSERT INTO automations (id, name, description, enabled, trigger, steps, next_run_at, created_at, updated_at) VALUES (:id, :name, :description, :enabled, :trigger, :steps, :next, :now, :now)', {
    id,
    name: d.name,
    description: d.description,
    enabled: d.enabled,
    trigger: JSON.stringify(d.trigger),
    steps: JSON.stringify(d.steps),
    next: d.enabled ? computeNextRun(d.trigger) : null,
    now,
  });
  logActivity(db, { kind: 'automation.created', title: `Automatisation créée : ${d.name}`, actor: 'user' });
  return getAutomation(db, id);
}

export function updateAutomation(db: DB, id: string, patch: z.input<typeof automationPatch>): Automation {
  const before = getAutomation(db, id);
  const d = automationPatch.parse(patch) as Record<string, unknown>;
  if (d.steps) validateSteps(d.steps as AutomationStep[]);
  const trigger = (d.trigger as AutomationTrigger | undefined) ?? before.trigger;
  const enabled = (d.enabled as boolean | undefined) ?? before.enabled;
  if (d.trigger) d.trigger = JSON.stringify(d.trigger);
  if (d.steps) d.steps = JSON.stringify(d.steps);
  if (patch.trigger !== undefined || patch.enabled !== undefined) d.next_run_at = enabled ? computeNextRun(trigger) : null;
  const q = buildUpdate('automations', id, d, ['name', 'description', 'enabled', 'trigger', 'steps', 'next_run_at']);
  if (q) run(db, q.sql, q.params);
  return getAutomation(db, id);
}

export function deleteAutomation(db: DB, id: string) {
  getAutomation(db, id);
  run(db, 'DELETE FROM automations WHERE id = :id', { id });
}

export function listRuns(db: DB, automationId: string, limit = 20): AutomationRun[] {
  return all(db, 'SELECT * FROM automation_runs WHERE automation_id = :id ORDER BY started_at DESC LIMIT :limit', { id: automationId, limit }).map(hydrateRun);
}

// ─── Exécution ───────────────────────────────────────────────────────────────

export interface EngineDeps {
  db: DB;
  ai: AIDeps;
  fetch?: typeof fetch;
}

const truncate = (v: unknown, max = 4000): unknown => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return v;
  return s.length > max ? `${s.slice(0, max)}… (tronqué)` : v;
};

/**
 * Exécute une automatisation. En mode `dryRun`, les gabarits sont résolus et
 * les configurations validées, mais aucune étape à effet de bord n'est lancée.
 */
export async function executeAutomation(deps: EngineDeps, automationId: string, triggerPayload: Record<string, unknown> = {}, opts: { dryRun?: boolean } = {}): Promise<AutomationRun> {
  const automation = getAutomation(deps.db, automationId);
  const dryRun = Boolean(opts.dryRun);
  const runId = newId('run');
  const startedAt = nowISO();
  run(deps.db, "INSERT INTO automation_runs (id, automation_id, status, dry_run, trigger_payload, started_at) VALUES (:id, :aid, 'running', :dry, :payload, :now)", {
    id: runId,
    aid: automationId,
    dry: dryRun,
    payload: JSON.stringify(triggerPayload),
    now: startedAt,
  });

  const scope: TemplateScope & { steps: Record<string, { output: unknown }> } = {
    trigger: triggerPayload,
    steps: {},
    today: todayISO(),
    now: new Date().toLocaleString('fr-FR'),
    automation: { id: automation.id, name: automation.name },
  };
  const ctx: StepContext = { db: deps.db, ai: deps.ai, dryRun, fetch: deps.fetch ?? fetch };
  const log: StepLog[] = [];
  let status = 'success' as AutomationRun['status'];
  let error: string | null = null;

  await automationScope.run({ automationId }, async () => {
    for (const step of automation.steps) {
      const def = STEP_BY_TYPE.get(step.type)!;
      const t0 = Date.now();
      const entry: StepLog = { step_id: step.id, type: step.type, name: step.name || def.label, status: 'success', started_at: nowISO(), duration_ms: 0 };
      log.push(entry);
      try {
        const rendered = renderDeep(step.config, scope);
        entry.input = truncate(rendered, 2000);
        const parsed = def.config.safeParse(rendered);
        if (!parsed.success) throw new Error(`Configuration invalide — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; ')}`);
        if (dryRun && def.sideEffect) {
          entry.status = 'simulated';
          entry.note = 'Simulation : étape non exécutée';
          scope.steps[step.id] = { output: { [SIMULATED]: true } };
        } else {
          const result = await def.run(parsed.data, ctx);
          entry.output = truncate(result.output);
          entry.note = result.note;
          scope.steps[step.id] = { output: result.output };
          if (result.continue === false) {
            entry.status = 'stopped';
            status = 'stopped';
            break;
          }
        }
      } catch (err) {
        entry.status = 'error';
        entry.error = err instanceof Error ? err.message : String(err);
        status = 'error';
        error = `Étape « ${entry.name} » : ${entry.error}`;
        break;
      } finally {
        entry.duration_ms = Date.now() - t0;
      }
    }
  });

  const finishedAt = nowISO();
  run(deps.db, 'UPDATE automation_runs SET status = :status, log = :log, error = :error, finished_at = :now WHERE id = :id', {
    id: runId,
    status,
    log: JSON.stringify(log),
    error,
    now: finishedAt,
  });
  if (!dryRun) {
    run(deps.db, 'UPDATE automations SET last_run_at = :now WHERE id = :id', { id: automationId, now: finishedAt });
    if (status === 'error') logActivity(deps.db, { kind: 'automation.error', title: `Échec d'automatisation : ${automation.name}`, detail: error ?? '', actor: 'automation' });
  }
  return hydrateRun(get(deps.db, 'SELECT * FROM automation_runs WHERE id = :id', { id: runId })!);
}

/** Exécute les automatisations planifiées arrivées à échéance. */
export async function runDueSchedules(deps: EngineDeps, now = new Date()): Promise<number> {
  const due = all(deps.db, "SELECT * FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= :now", { now: now.toISOString() }).map(hydrate);
  for (const a of due) {
    // On planifie la suivante AVANT d'exécuter : une exécution longue ou en échec ne bloque pas le rythme.
    run(deps.db, 'UPDATE automations SET next_run_at = :next WHERE id = :id', { id: a.id, next: computeNextRun(a.trigger, now) });
    await executeAutomation(deps, a.id, { scheduled_at: now.toISOString() }).catch((err) => console.error('[automations]', err));
  }
  return due.length;
}

/** Réagit aux événements métier. Les événements émis par une automatisation sont ignorés (anti-boucle). */
export async function handleEvent(deps: EngineDeps, event: BusEvent): Promise<void> {
  if (event.originAutomationId) return;
  const matching = listAutomations(deps.db).filter((a) => a.enabled && a.trigger.type === 'event' && a.trigger.event === event.type);
  for (const a of matching) {
    await executeAutomation(deps, a.id, { event: event.type, ...event.payload }).catch((err) => console.error('[automations]', err));
  }
}

/** Démarre le planificateur et l'écoute des événements. Renvoie une fonction d'arrêt. */
export function startAutomationEngine(deps: EngineDeps, intervalMs = 30_000): () => void {
  const unsubscribe = onEvent((e) => void handleEvent(deps, e));
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runDueSchedules(deps);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
