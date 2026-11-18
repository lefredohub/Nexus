import { describe, expect, it } from 'vitest';
import { testDb, testSecrets, flush } from './helpers';
import { render, renderDeep } from '../server/automations/template';
import { createAutomation, executeAutomation, computeNextRun, runDueSchedules, startAutomationEngine, listRuns, updateAutomation } from '../server/automations/engine';
import { createTask, listTasks, updateTask } from '../server/repos/tasks';
import { listActivity } from '../server/repos/activity';
import { all } from '../server/db/client';

const deps = (db = testDb(), fetchImpl?: typeof fetch) => ({ db, ai: { db, secrets: testSecrets(false) }, fetch: fetchImpl });

describe('gabarits', () => {
  it('résout les chemins sans évaluer de code', () => {
    const scope = { trigger: { task: { title: 'Écrire', n: 3 } }, steps: { a: { output: { id: 'x' } } } };
    expect(render('Tâche {{trigger.task.title}} ({{ trigger.task.n }}) → {{steps.a.output.id}}', scope)).toBe('Tâche Écrire (3) → x');
    expect(render('{{inconnu.chemin}}|{{constructor}}', scope)).toBe('|');
    expect(renderDeep({ a: ['{{trigger.task.title}}'], b: 2 }, scope)).toEqual({ a: ['Écrire'], b: 2 });
  });
});

describe('exécution', () => {
  it('la simulation ne produit aucun effet, l’exécution réelle si', async () => {
    const d = deps();
    const a = createAutomation(d.db, {
      name: 'Test',
      steps: [
        { id: 't', type: 'create_task', config: { title: 'Revue {{today}}', priority: '1' } },
        { id: 'n', type: 'notify', config: { title: 'Créée : {{steps.t.output.title}}' } },
      ],
    });
    const dry = await executeAutomation(d, a.id, {}, { dryRun: true });
    expect(dry.status).toBe('success');
    expect(dry.log.map((l) => l.status)).toEqual(['simulated', 'simulated']);
    expect((dry.log[1].input as { title: string }).title).toBe('Créée : ‹steps.t.output.title›');
    expect(listTasks(d.db)).toHaveLength(0);

    const real = await executeAutomation(d, a.id);
    expect(real.status).toBe('success');
    expect(listTasks(d.db)[0]).toMatchObject({ priority: 1, source: 'automation' });
    expect(listActivity(d.db).some((x) => x.title === `Créée : ${listTasks(d.db)[0].title}`)).toBe(true);
  });

  it('une condition fausse arrête proprement', async () => {
    const d = deps();
    const a = createAutomation(d.db, {
      name: 'Cond',
      steps: [
        { id: 'c', type: 'condition', config: { left: '{{trigger.priority}}', operator: 'equals', right: '1' } },
        { id: 't', type: 'create_task', config: { title: 'Urgent' } },
      ],
    });
    expect((await executeAutomation(d, a.id, { priority: 2 })).status).toBe('stopped');
    expect(listTasks(d.db)).toHaveLength(0);
    expect((await executeAutomation(d, a.id, { priority: 1 })).status).toBe('success');
    expect(listTasks(d.db)).toHaveLength(1);
  });

  it('une erreur d’étape est consignée sans exécuter la suite', async () => {
    const d = deps();
    const a = createAutomation(d.db, {
      name: 'Err',
      steps: [
        { id: 'm', type: 'log_metric', config: { metric_id: 'met_absent', value: '3' } },
        { id: 't', type: 'create_task', config: { title: 'Ne doit pas exister' } },
      ],
    });
    const r = await executeAutomation(d, a.id);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/introuvable/);
    expect(listTasks(d.db)).toHaveLength(0);
  });

  it('appelle une API externe avec le corps rendu', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const d = deps(testDb(), fakeFetch);
    const a = createAutomation(d.db, { name: 'Hook', steps: [{ id: 'h', type: 'http_request', config: { method: 'POST', url: 'https://example.com/hook', body: '{"t":"{{trigger.x}}"}' } }] });
    const r = await executeAutomation(d, a.id, { x: 'bonjour' });
    expect(r.status).toBe('success');
    expect(calls[0].init.body).toBe('{"t":"bonjour"}');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('refuse un type d’étape inconnu', () => {
    const db = testDb();
    expect(() => createAutomation(db, { name: 'X', steps: [{ id: 'a', type: 'rm_rf', config: {} }] })).toThrow(/inconnu/);
  });
});

describe('déclencheurs', () => {
  it('calcule la prochaine exécution planifiée', () => {
    const from = new Date(2026, 10, 18, 9, 30);
    expect(new Date(computeNextRun({ type: 'schedule', every: 15, unit: 'minutes' }, from)!).getTime() - from.getTime()).toBe(15 * 60_000);
    const daily = new Date(computeNextRun({ type: 'schedule', every: 1, unit: 'days', at: '08:00' }, from)!);
    expect([daily.getDate(), daily.getHours()]).toEqual([19, 8]);
    const later = new Date(computeNextRun({ type: 'schedule', every: 1, unit: 'days', at: '18:00' }, from)!);
    expect([later.getDate(), later.getHours()]).toEqual([18, 18]);
    expect(computeNextRun({ type: 'manual' })).toBeNull();
  });

  it('exécute les automatisations planifiées arrivées à échéance', async () => {
    const d = deps();
    const a = createAutomation(d.db, { name: 'Sched', trigger: { type: 'schedule', every: 1, unit: 'hours' }, steps: [{ id: 't', type: 'create_task', config: { title: 'Tick' } }] });
    expect(await runDueSchedules(d)).toBe(0);
    expect(await runDueSchedules(d, new Date(Date.now() + 2 * 3_600_000))).toBe(1);
    expect(listTasks(d.db)).toHaveLength(1);
    updateAutomation(d.db, a.id, { enabled: false });
    expect(await runDueSchedules(d, new Date(Date.now() + 10 * 3_600_000))).toBe(0);
  });

  it('réagit aux événements, sans boucle infinie', async () => {
    const d = deps();
    const a = createAutomation(d.db, {
      name: 'Écho',
      trigger: { type: 'event', event: 'task.created' },
      steps: [{ id: 't', type: 'create_task', config: { title: 'Suivi de {{trigger.task.title}}' } }],
    });
    const stop = startAutomationEngine(d, 60_000);
    createTask(d.db, { title: 'Original' });
    await flush();
    await flush();
    stop();
    // La tâche créée PAR l'automatisation ne redéclenche pas l'automatisation.
    expect(listTasks(d.db).map((t) => t.title).sort()).toEqual(['Original', 'Suivi de Original']);
    expect(listRuns(d.db, a.id)).toHaveLength(1);
  });

  it('se déclenche quand une tâche est terminée', async () => {
    const d = deps();
    createAutomation(d.db, { name: 'Bravo', trigger: { type: 'event', event: 'task.completed' }, steps: [{ id: 'n', type: 'notify', config: { title: 'Bravo pour {{trigger.task.title}}' } }] });
    const t = createTask(d.db, { title: 'Courir' });
    const stop = startAutomationEngine(d, 60_000);
    updateTask(d.db, t.id, { status: 'done' });
    await flush();
    stop();
    expect(all<{ title: string }>(d.db, "SELECT title FROM activity WHERE kind = 'automation.notify'")[0].title).toBe('Bravo pour Courir');
  });
});
