/**
 * Application HTTP (API REST + flux SSE pour le chat).
 * `createApp` reçoit ses dépendances : les tests peuvent ainsi utiliser une
 * base en mémoire et un faux client IA.
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import QRCode from 'qrcode';
import { streamSSE } from 'hono/streaming';
import { z, ZodError } from 'zod';
import type { DB } from './db/client';
import { todayISO } from './db/client';
import type { SecretStore } from './ai/secrets';
import type { AIDeps } from './ai/client';
import { getClient, toAppError } from './ai/client';
import { AppError } from './lib/errors';
import { localOnly, remoteGuard } from './security';
import { PairingManager, pairDevice, verifySession, listDevices, revokeDevice, readCookie, sessionCookie, clearSessionCookie, SESSION_COOKIE } from './auth';
import { enableTailscaleServe, type RemoteServer } from './remote';
import { aiReadiness } from './ai/providers';
import { ollamaPull, type OllamaDeps } from './ai/ollama';
import * as S from '../shared/schemas';
import * as tasks from './repos/tasks';
import * as projects from './repos/projects';
import * as goals from './repos/goals';
import * as ideas from './repos/ideas';
import * as notes from './repos/notes';
import * as links from './repos/links';
import * as analytics from './repos/analytics';
import * as conversations from './repos/conversations';
import { getOverview } from './repos/overview';
import { buildGraph } from './repos/graph';
import { search } from './repos/search';
import { listActivity } from './repos/activity';
import { getSettings, updateSettings } from './repos/settings';
import { runChat, conversationView } from './ai/agent';
import { analyzeIdea, analyzeProject, generateBriefing, getCachedBriefing } from './ai/structured';
import * as automations from './automations/engine';
import { stepCatalog } from './automations/steps';
import { INTEGRATIONS } from './integrations';
import { loadDemoData, isEmpty } from './db/seed';
import { exportAll, backupDatabase, wipeData } from './db/export';

export interface AppDeps {
  db: DB;
  /**
   * « local » : servi sur 127.0.0.1 au Mac lui-même (pas d'authentification).
   * « remote » : servi aux appareils distants (iPhone) — appairage obligatoire.
   */
  mode?: 'local' | 'remote';
  /** Gestionnaire de codes d'appairage, partagé entre les deux portes. */
  pairing?: PairingManager;
  /** Porte distante, pilotable depuis les Réglages du Mac. */
  remote?: RemoteServer;
  /** Accès à Ollama (IA locale) ; injectable pour les tests. */
  ollama?: OllamaDeps;
  /** Dossier des sauvegardes (data/backups). */
  backupDir?: string;
  secrets: SecretStore;
  makeClient?: AIDeps['makeClient'];
  fetch?: typeof fetch;
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown = {};
  try {
    const text = await c.req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError(400, 'invalid_json', 'Corps JSON invalide');
  }
  return schema.parse(raw);
}

export function createApp(deps: AppDeps) {
  const { db } = deps;
  const ai: AIDeps = { db, secrets: deps.secrets, makeClient: deps.makeClient, ollama: deps.ollama };
  const engine = { db, ai, fetch: deps.fetch };
  const mode = deps.mode ?? 'local';
  const pairing = deps.pairing ?? new PairingManager();
  const app = new Hono();

  app.use('/api/*', mode === 'remote' ? remoteGuard((token) => verifySession(db, token)) : localOnly);

  /** Routes sensibles réservées au Mac (clé API, réinitialisation, gestion des appareils…). */
  const macOnly: MiddlewareHandler = async (c, next) => {
    if (mode !== 'local') return c.json({ error: { code: 'local_only', message: 'Action disponible uniquement depuis le Mac.' } }, 403);
    await next();
  };

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json({ error: { code: 'validation', message: err.issues.map((i) => `${i.path.join('.') || 'valeur'} : ${i.message}`).join(' · '), details: err.issues } }, 422);
    }
    const e = err instanceof AppError ? err : toAppError(err);
    if (e.status >= 500) console.error('[api]', err);
    return c.json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
  });

  const api = new Hono();

  // ── Authentification des appareils distants ────────────────────────────────
  api.get('/auth/status', (c) => {
    if (mode === 'local') return c.json({ mode, authenticated: true, device: null });
    const device = verifySession(db, readCookie(c.req.header('cookie'), SESSION_COOKIE));
    return c.json({ mode, authenticated: Boolean(device), device });
  });
  api.post('/auth/pair', async (c) => {
    if (mode === 'local') return c.json({ ok: true });
    const { code, name } = await body(c, S.pairInput);
    const { token, device } = pairDevice(db, pairing, code, name, c.req.header('user-agent') ?? '');
    const secure = c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
    c.header('Set-Cookie', sessionCookie(token, secure));
    return c.json({ ok: true, device });
  });
  api.post('/auth/logout', (c) => {
    const device = verifySession(db, readCookie(c.req.header('cookie'), SESSION_COOKIE));
    if (device) revokeDevice(db, device.id);
    c.header('Set-Cookie', clearSessionCookie());
    return c.json({ ok: true });
  });

  // ── Accès distant (piloté depuis le Mac uniquement) ────────────────────────
  api.use('/remote/*', macOnly);
  api.use('/remote', macOnly);
  const remoteInfo = async () => {
    const status = deps.remote ? await deps.remote.status() : null;
    const base = status?.mode === 'tailscale' ? status.tailscale.url : status?.mode === 'lan' ? status.lanUrls[0] ?? null : null;
    return { mode: getSettings(db).remote_mode, status, baseUrl: base, devices: listDevices(db), pairing: pairing.activeCode() };
  };
  api.get('/remote', async (c) => c.json(await remoteInfo()));
  api.patch('/remote', async (c) => {
    const { mode: next } = await body(c, S.remotePatch);
    if (!deps.remote) throw new AppError(400, 'remote_unavailable', 'Accès distant indisponible dans ce contexte');
    updateSettings(db, { remote_mode: next });
    await deps.remote.apply(next);
    return c.json(await remoteInfo());
  });
  api.post('/remote/pairing', async (c) => {
    const info = await remoteInfo();
    const { code, expiresAt } = pairing.createCode();
    const url = info.baseUrl ? `${info.baseUrl}/?pair=${code}` : null;
    const qr = url ? await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#060708', light: '#ffffff' } }) : null;
    return c.json({ code, expiresAt, url, qr });
  });
  api.delete('/remote/devices/:id', (c) => (revokeDevice(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/remote/tailscale', async (c) => {
    if (!deps.remote) throw new AppError(400, 'remote_unavailable', 'Accès distant indisponible dans ce contexte');
    const r = await enableTailscaleServe(deps.remote.port);
    return c.json({ ...r, info: await remoteInfo() });
  });

  // ── Système ────────────────────────────────────────────────────────────────
  api.get('/health', (c) => c.json({ ok: true, date: todayISO() }));
  api.get('/overview', (c) => c.json(getOverview(db)));
  api.get('/activity', (c) => c.json(listActivity(db, Number(c.req.query('limit') ?? 50))));
  api.get('/search', (c) => {
    const q = c.req.query('q') ?? '';
    return c.json(q.trim().length < 2 ? [] : search(db, q, { limit: 25 }));
  });
  api.get('/settings', (c) => c.json(getSettings(db)));
  api.patch('/settings', async (c) => c.json(updateSettings(db, await body(c, S.settingsPatch))));
  api.get('/export', macOnly, (c) => {
    c.header('Content-Disposition', `attachment; filename="nexus-export-${todayISO()}.json"`);
    return c.json(exportAll(db));
  });
  api.post('/backup', macOnly, (c) => {
    if (!deps.backupDir) throw new AppError(400, 'no_backup_dir', 'Sauvegarde indisponible');
    return c.json({ file: backupDatabase(db, deps.backupDir) });
  });
  api.post('/reset', macOnly, async (c) => {
    const { confirm } = await body(c, z.object({ confirm: z.literal('EFFACER', { message: 'Tape EFFACER pour confirmer' }) }));
    void confirm;
    if (!deps.backupDir) throw new AppError(400, 'no_backup_dir', 'Sauvegarde indisponible : réinitialisation refusée');
    const file = backupDatabase(db, deps.backupDir);
    wipeData(db);
    return c.json({ ok: true, backup: file });
  });
  api.get('/demo', (c) => c.json({ empty: isEmpty(db) }));
  api.post('/demo', macOnly, (c) => {
    if (!isEmpty(db)) throw new AppError(409, 'not_empty', 'Les données de démonstration ne peuvent être chargées que dans un espace vide.');
    loadDemoData(db);
    updateSettings(db, { onboarded: true });
    return c.json({ ok: true });
  });

  // ── Tâches ─────────────────────────────────────────────────────────────────
  api.get('/tasks', (c) => c.json(tasks.listTasks(db, { status: c.req.query('status') as tasks.TaskFilters['status'], project_id: c.req.query('project_id') })));
  api.post('/tasks', async (c) => c.json(tasks.createTask(db, await body(c, S.taskInput)), 201));
  api.patch('/tasks/:id', async (c) => c.json(tasks.updateTask(db, c.req.param('id'), await body(c, S.taskPatch))));
  api.delete('/tasks/:id', (c) => (tasks.deleteTask(db, c.req.param('id')), c.json({ ok: true })));

  // ── Projets ────────────────────────────────────────────────────────────────
  api.get('/projects', (c) => c.json(projects.listProjects(db, { includeArchived: c.req.query('archived') === '1' })));
  api.post('/projects', async (c) => c.json(projects.createProject(db, await body(c, S.projectInput)), 201));
  api.get('/projects/:id', (c) => c.json(projects.getProject(db, c.req.param('id'))));
  api.patch('/projects/:id', async (c) => c.json(projects.updateProject(db, c.req.param('id'), await body(c, S.projectPatch))));
  api.delete('/projects/:id', (c) => (projects.deleteProject(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/projects/:id/milestones', async (c) => c.json(projects.addMilestone(db, c.req.param('id'), await body(c, S.milestoneInput)), 201));
  api.patch('/milestones/:id', async (c) => c.json(projects.updateMilestone(db, c.req.param('id'), await body(c, S.milestonePatch))));
  api.delete('/milestones/:id', (c) => (projects.deleteMilestone(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/projects/:id/risks', async (c) => c.json(projects.addRisk(db, c.req.param('id'), await body(c, S.riskInput)), 201));
  api.patch('/risks/:id', async (c) => c.json(projects.updateRisk(db, c.req.param('id'), await body(c, S.riskPatch))));
  api.delete('/risks/:id', (c) => (projects.deleteRisk(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/projects/:id/expenses', async (c) => c.json(projects.addExpense(db, c.req.param('id'), await body(c, S.expenseInput)), 201));
  api.delete('/expenses/:id', (c) => (projects.deleteExpense(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/projects/:id/analyze', async (c) => c.json(await analyzeProject(ai, c.req.param('id'))));
  /** Applique des suggestions de l'analyse (tâches et risques) choisies par l'utilisateur. */
  api.post('/projects/:id/apply', async (c) => {
    const id = c.req.param('id');
    const d = await body(c, z.object({
      tasks: z.array(z.object({ title: z.string().min(1).max(200), priority: S.priority.default(2) })).max(20).default([]),
      risks: z.array(S.riskInput).max(20).default([]),
    }));
    projects.getProjectSummary(db, id);
    d.tasks.forEach((t) => tasks.createTask(db, { ...t, project_id: id }));
    d.risks.forEach((r) => projects.addRisk(db, id, r));
    return c.json(projects.getProject(db, id));
  });

  // ── Objectifs ──────────────────────────────────────────────────────────────
  api.get('/goals', (c) => c.json(goals.listGoals(db, { includeInactive: c.req.query('all') === '1' })));
  api.post('/goals', async (c) => c.json(goals.createGoal(db, await body(c, S.goalInput)), 201));
  api.patch('/goals/:id', async (c) => c.json(goals.updateGoal(db, c.req.param('id'), await body(c, S.goalPatch))));
  api.delete('/goals/:id', (c) => (goals.deleteGoal(db, c.req.param('id')), c.json({ ok: true })));

  // ── Idées ──────────────────────────────────────────────────────────────────
  api.get('/ideas', (c) => c.json(ideas.listIdeas(db, { status: c.req.query('status') })));
  api.post('/ideas', async (c) => c.json(ideas.createIdea(db, await body(c, S.ideaInput)), 201));
  api.get('/ideas/:id', (c) => c.json(ideas.getIdea(db, c.req.param('id'))));
  api.patch('/ideas/:id', async (c) => c.json(ideas.updateIdea(db, c.req.param('id'), await body(c, S.ideaPatch))));
  api.delete('/ideas/:id', (c) => (ideas.deleteIdea(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/ideas/:id/analyze', async (c) => c.json(await analyzeIdea(ai, c.req.param('id'))));
  api.post('/ideas/:id/convert', (c) => c.json(ideas.convertIdeaToProject(db, c.req.param('id')), 201));

  // ── Notes, mémoire, liens, graphe ──────────────────────────────────────────
  api.get('/notes', (c) => c.json(notes.listNotes(db)));
  api.post('/notes', async (c) => c.json(notes.createNote(db, await body(c, S.noteInput)), 201));
  api.get('/notes/:id', (c) => c.json(notes.getNote(db, c.req.param('id'))));
  api.patch('/notes/:id', async (c) => c.json(notes.updateNote(db, c.req.param('id'), await body(c, S.notePatch))));
  api.delete('/notes/:id', (c) => (notes.deleteNote(db, c.req.param('id')), c.json({ ok: true })));
  api.get('/memories', (c) => c.json(notes.listMemories(db)));
  api.post('/memories', async (c) => c.json(notes.createMemory(db, await body(c, S.memoryInput)), 201));
  api.patch('/memories/:id', async (c) => c.json(notes.updateMemory(db, c.req.param('id'), await body(c, S.memoryPatch))));
  api.delete('/memories/:id', (c) => (notes.deleteMemory(db, c.req.param('id')), c.json({ ok: true })));
  api.get('/links', (c) => {
    const ref = S.entityRef.parse({ kind: c.req.query('kind'), id: c.req.query('id') });
    return c.json(links.linksFor(db, ref.kind, ref.id));
  });
  api.post('/links', async (c) => c.json(links.createLink(db, await body(c, S.linkInput)), 201));
  api.delete('/links/:id', (c) => (links.deleteLink(db, c.req.param('id')), c.json({ ok: true })));
  api.get('/graph', (c) => c.json(buildGraph(db, { includeTasks: c.req.query('tasks') === '1', includeDone: c.req.query('done') === '1' })));

  // ── Analytics ──────────────────────────────────────────────────────────────
  api.get('/analytics', (c) => c.json(analytics.analyticsDashboard(db)));
  api.get('/integrations', (c) => c.json(INTEGRATIONS));
  api.get('/transactions', (c) => c.json(analytics.listTransactions(db, { from: c.req.query('from'), to: c.req.query('to'), limit: 200 })));
  api.post('/transactions', async (c) => c.json(analytics.createTransaction(db, await body(c, S.transactionInput)), 201));
  api.delete('/transactions/:id', (c) => (analytics.deleteTransaction(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/transactions/import', async (c) => c.json(analytics.importTransactionsCSV(db, await body(c, S.csvImportInput))));
  api.post('/transactions/preview', async (c) => {
    const d = await body(c, z.object({ csv: z.string().max(2_000_000), delimiter: z.enum([',', ';', '\t']).optional() }));
    const rows = analytics.parseCSV(d.csv, d.delimiter);
    return c.json({ header: rows[0] ?? [], sample: rows.slice(1, 6), total: Math.max(0, rows.length - 1) });
  });
  api.get('/workouts', (c) => c.json(analytics.listWorkouts(db, { limit: 100 })));
  api.post('/workouts', async (c) => c.json(analytics.createWorkout(db, await body(c, S.workoutInput)), 201));
  api.delete('/workouts/:id', (c) => (analytics.deleteWorkout(db, c.req.param('id')), c.json({ ok: true })));
  api.get('/habits', (c) => c.json(analytics.listHabits(db)));
  api.post('/habits', async (c) => c.json(analytics.createHabit(db, await body(c, S.habitInput)), 201));
  api.patch('/habits/:id', async (c) => c.json(analytics.updateHabit(db, c.req.param('id'), await body(c, S.habitPatch))));
  api.delete('/habits/:id', (c) => (analytics.deleteHabit(db, c.req.param('id')), c.json({ ok: true })));
  api.put('/habits/:id/checks/:date', async (c) => {
    const date = S.isoDate.parse(c.req.param('date'));
    const { done } = await body(c, z.object({ done: z.boolean() }));
    return c.json({ done: analytics.setHabitCheck(db, c.req.param('id'), date, done) });
  });
  api.get('/metrics', (c) => c.json(analytics.listMetrics(db)));
  api.post('/metrics', async (c) => c.json(analytics.createMetric(db, await body(c, S.metricInput)), 201));
  api.delete('/metrics/:id', (c) => (analytics.deleteMetric(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/metrics/:id/entries', async (c) => c.json(analytics.addMetricEntry(db, c.req.param('id'), await body(c, S.metricEntryInput)), 201));
  api.delete('/metric-entries/:id', (c) => (analytics.deleteMetricEntry(db, c.req.param('id')), c.json({ ok: true })));

  // ── IA ─────────────────────────────────────────────────────────────────────
  api.get('/ai/status', async (c) => {
    const s = getSettings(db);
    const key = deps.secrets.status();
    const ready = await aiReadiness(ai);
    return c.json({
      provider: ready.provider,
      online: ready.online,
      reason: ready.reason,
      model: ready.model,
      ollama: ready.ollama,
      // Depuis un appareil distant, on n'expose même pas la version masquée de la clé.
      key: mode === 'local' ? key : { ...key, masked: null },
      effort: s.ai_effort,
      allowWrites: s.ai_allow_writes,
      mode,
    });
  });
  /** Télécharge un modèle dans Ollama, avec la progression en direct (SSE). */
  api.post('/ai/ollama/pull', macOnly, async (c) => {
    const { model } = await body(c, z.object({ model: S.settingsPatch.shape.ollama_model.unwrap() }));
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      try {
        for await (const p of ollamaPull(ai.ollama ?? {}, model, controller.signal)) await stream.writeSSE({ event: 'progress', data: JSON.stringify(p) });
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ ok: true }) });
      } catch (err) {
        const e = err instanceof AppError ? err : toAppError(err);
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: e.code, message: e.message }) });
      }
    });
  });
  api.post('/ai/key', macOnly, async (c) => {
    const { apiKey } = await body(c, S.apiKeyInput);
    deps.secrets.setApiKey(apiKey);
    return c.json(deps.secrets.status());
  });
  api.delete('/ai/key', macOnly, (c) => (deps.secrets.clearApiKey(), c.json(deps.secrets.status())));
  /** Vérifie l'IA : Ollama + modèle présents, ou clé Claude via l'API Models (aucun token consommé). */
  api.post('/ai/verify', async (c) => {
    const ready = await aiReadiness(ai);
    if (ready.provider === 'ollama') {
      if (!ready.online) throw new AppError(400, 'ai_offline', ready.reason ?? 'IA locale indisponible');
      return c.json({ ok: true, model: ready.model, name: `${ready.model} (local, Ollama ${ready.ollama?.version ?? ''})`.trim() });
    }
    const client = getClient(ai);
    const model = getSettings(db).ai_model;
    try {
      const info = await client.models.retrieve(model);
      return c.json({ ok: true, model: info.id, name: info.display_name });
    } catch (err) {
      throw toAppError(err);
    }
  });
  api.get('/ai/briefing', (c) => c.json(getCachedBriefing(ai)));
  api.post('/ai/briefing', async (c) => {
    const { force } = await body(c, z.object({ force: z.boolean().default(false) }));
    return c.json(await generateBriefing(ai, force));
  });
  api.post('/ai/chat', async (c) => {
    const input = await body(c, S.chatInput);
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      for await (const event of runChat(ai, input, controller.signal)) {
        if (controller.signal.aborted) break;
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    });
  });
  api.get('/conversations', (c) => c.json(conversations.listConversations(db)));
  api.get('/conversations/:id', (c) => c.json(conversationView(ai, c.req.param('id'))));
  api.patch('/conversations/:id', async (c) => {
    const { title } = await body(c, z.object({ title: z.string().trim().min(1).max(120) }));
    conversations.getConversation(db, c.req.param('id'));
    conversations.renameConversation(db, c.req.param('id'), title);
    return c.json({ ok: true });
  });
  api.delete('/conversations/:id', (c) => (conversations.deleteConversation(db, c.req.param('id')), c.json({ ok: true })));

  // ── Automatisations ────────────────────────────────────────────────────────
  api.get('/automations', (c) => c.json(automations.listAutomations(db)));
  api.get('/automations/catalog', (c) => c.json({ steps: stepCatalog(), events: S.AUTOMATION_EVENTS }));
  api.post('/automations', async (c) => c.json(automations.createAutomation(db, await body(c, S.automationInput)), 201));
  api.get('/automations/:id', (c) => c.json({ ...automations.getAutomation(db, c.req.param('id')), runs: automations.listRuns(db, c.req.param('id')) }));
  api.patch('/automations/:id', async (c) => c.json(automations.updateAutomation(db, c.req.param('id'), await body(c, S.automationPatch))));
  api.delete('/automations/:id', (c) => (automations.deleteAutomation(db, c.req.param('id')), c.json({ ok: true })));
  api.post('/automations/:id/run', async (c) => {
    const d = await body(c, z.object({ dryRun: z.boolean().default(false), payload: z.record(z.string(), z.unknown()).default({}) }));
    return c.json(await automations.executeAutomation(engine, c.req.param('id'), { manual: true, ...d.payload }, { dryRun: d.dryRun }));
  });

  app.route('/api', api);
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Route inconnue' } }, 404));
  return app;
}
