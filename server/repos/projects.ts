import { z } from 'zod';
import { type DB, all, get, run, tx, newId, nowISO, todayISO, buildUpdate, parseJSON } from '../db/client';
import { projectInput, projectPatch, milestoneInput, milestonePatch, riskInput, riskPatch, expenseInput, type ProjectAnalysis } from '../../shared/schemas';
import { notFound } from '../lib/errors';
import { emitEvent } from '../events';
import { logActivity, type Actor } from './activity';
import { listTasks, type Task } from './tasks';

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  objective: string;
  status: string;
  priority: number;
  color: string;
  budget_planned: number | null;
  currency: string;
  start_date: string | null;
  due_date: string | null;
  notes: string;
  goal_id: string | null;
  created_at: string;
  updated_at: string;
  // calculés
  budget_spent: number;
  milestones_total: number;
  milestones_done: number;
  tasks_open: number;
  tasks_done: number;
  tasks_overdue: number;
  risks_open_high: number;
  progress: number; // 0..1
  health: 'good' | 'watch' | 'critical';
  goal_title: string | null;
}

export interface Milestone { id: string; project_id: string; title: string; done: number; position: number; due_date: string | null }
export interface Risk { id: string; project_id: string; title: string; severity: 'low' | 'medium' | 'high'; mitigation: string; status: 'open' | 'mitigated' }
export interface Expense { id: string; project_id: string; label: string; amount: number; date: string }

export interface ProjectDetail extends ProjectSummary {
  milestones: Milestone[];
  risks: Risk[];
  expenses: Expense[];
  tasks: Task[];
  analysis: { id: string; model: string; created_at: string; analysis: ProjectAnalysis } | null;
}

const SELECT = `SELECT p.*,
  g.title AS goal_title,
  coalesce((SELECT sum(amount) FROM expenses e WHERE e.project_id = p.id), 0) AS budget_spent,
  (SELECT count(*) FROM milestones m WHERE m.project_id = p.id) AS milestones_total,
  (SELECT count(*) FROM milestones m WHERE m.project_id = p.id AND m.done = 1) AS milestones_done,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') AS tasks_open,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS tasks_done,
  (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < :today) AS tasks_overdue,
  (SELECT count(*) FROM risks r WHERE r.project_id = p.id AND r.status = 'open' AND r.severity = 'high') AS risks_open_high
  FROM projects p LEFT JOIN goals g ON g.id = p.goal_id`;

type RawProject = Omit<ProjectSummary, 'progress' | 'health'>;

/**
 * Progression : étapes terminées / étapes totales. Sans étapes, on se rabat
 * sur les tâches. Un projet « done » est à 100 %.
 */
export function computeProgress(p: Pick<RawProject, 'status' | 'milestones_total' | 'milestones_done' | 'tasks_open' | 'tasks_done'>): number {
  if (p.status === 'done') return 1;
  if (p.milestones_total > 0) return p.milestones_done / p.milestones_total;
  const total = p.tasks_open + p.tasks_done;
  return total > 0 ? p.tasks_done / total : 0;
}

/** Santé : signaux factuels uniquement (retards, risques élevés, budget, échéance). */
export function computeHealth(p: RawProject & { progress: number }): ProjectSummary['health'] {
  if (p.status === 'done' || p.status === 'archived') return 'good';
  let score = 0;
  if (p.tasks_overdue > 0) score += p.tasks_overdue > 2 ? 2 : 1;
  if (p.risks_open_high > 0) score += 1;
  if (p.budget_planned && p.budget_spent > p.budget_planned) score += 2;
  else if (p.budget_planned && p.budget_spent > p.budget_planned * 0.9) score += 1;
  if (p.due_date && p.due_date < todayISO() && p.progress < 1) score += 2;
  return score >= 3 ? 'critical' : score >= 1 ? 'watch' : 'good';
}

function enrich(p: RawProject): ProjectSummary {
  const progress = computeProgress(p);
  return { ...p, progress, health: computeHealth({ ...p, progress }) };
}

export function listProjects(db: DB, opts: { status?: string; includeArchived?: boolean } = {}): ProjectSummary[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { today: todayISO() };
  if (opts.status) (where.push('p.status = :status'), (params.status = opts.status));
  else if (!opts.includeArchived) where.push("p.status != 'archived'");
  const rows = all<RawProject>(
    db,
    `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'paused' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
              p.priority ASC, p.updated_at DESC`,
    params,
  );
  return rows.map(enrich);
}

export function getProjectSummary(db: DB, id: string): ProjectSummary {
  const row = get<RawProject>(db, `${SELECT} WHERE p.id = :id`, { id, today: todayISO() });
  if (!row) throw notFound('Projet');
  return enrich(row);
}

export function getProject(db: DB, id: string): ProjectDetail {
  const summary = getProjectSummary(db, id);
  const analysisRow = get<{ id: string; model: string; created_at: string; analysis: string }>(
    db,
    'SELECT * FROM project_analyses WHERE project_id = :id ORDER BY created_at DESC LIMIT 1',
    { id },
  );
  return {
    ...summary,
    milestones: all<Milestone>(db, 'SELECT * FROM milestones WHERE project_id = :id ORDER BY position, created_at', { id }),
    risks: all<Risk>(db, "SELECT * FROM risks WHERE project_id = :id ORDER BY status, CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END", { id }),
    expenses: all<Expense>(db, 'SELECT * FROM expenses WHERE project_id = :id ORDER BY date DESC', { id }),
    tasks: listTasks(db, { project_id: id }),
    analysis: analysisRow ? { ...analysisRow, analysis: parseJSON<ProjectAnalysis>(analysisRow.analysis, null as never) } : null,
  };
}

export interface CreateProjectExtras {
  milestones?: string[];
  risks?: { title: string; severity?: 'low' | 'medium' | 'high'; mitigation?: string }[];
}

export function createProject(db: DB, input: z.input<typeof projectInput>, actor: Actor = 'user', extras: CreateProjectExtras = {}): ProjectDetail {
  const d = projectInput.parse(input);
  const id = newId('prj');
  const now = nowISO();
  tx(db, () => {
    run(
      db,
      `INSERT INTO projects (id, title, description, objective, status, priority, color, budget_planned, currency, start_date, due_date, notes, goal_id, created_at, updated_at)
       VALUES (:id, :title, :description, :objective, :status, :priority, :color, :budget_planned, :currency, :start_date, :due_date, :notes, :goal_id, :now, :now)`,
      {
        id,
        ...d,
        budget_planned: d.budget_planned ?? null,
        start_date: d.start_date ?? null,
        due_date: d.due_date ?? null,
        goal_id: d.goal_id ?? null,
        now,
      },
    );
    extras.milestones?.forEach((title) => addMilestone(db, id, { title }));
    extras.risks?.forEach((r) => addRisk(db, id, r));
    logActivity(db, { kind: 'project.created', title: `Projet lancé : ${d.title}`, entity_kind: 'project', entity_id: id, actor });
  });
  const project = getProject(db, id);
  emitEvent('project.created', { project: getProjectSummary(db, id) });
  return project;
}

export function updateProject(db: DB, id: string, patch: z.input<typeof projectPatch>, actor: Actor = 'user'): ProjectDetail {
  const before = getProjectSummary(db, id);
  const d = projectPatch.parse(patch);
  const q = buildUpdate('projects', id, d, ['title', 'description', 'objective', 'status', 'priority', 'color', 'budget_planned', 'currency', 'start_date', 'due_date', 'notes', 'goal_id']);
  if (q) run(db, q.sql, q.params);
  if (d.status && d.status !== before.status) {
    const labels: Record<string, string> = { active: 'activé', paused: 'mis en pause', done: 'terminé', archived: 'archivé', planning: 'replanifié' };
    logActivity(db, { kind: 'project.status', title: `Projet ${labels[d.status] ?? d.status} : ${before.title}`, entity_kind: 'project', entity_id: id, actor });
  }
  return getProject(db, id);
}

export function deleteProject(db: DB, id: string) {
  getProjectSummary(db, id);
  tx(db, () => {
    run(db, 'DELETE FROM projects WHERE id = :id', { id });
    run(db, "DELETE FROM links WHERE (source_kind = 'project' AND source_id = :id) OR (target_kind = 'project' AND target_id = :id)", { id });
  });
}

// ─── Étapes ──────────────────────────────────────────────────────────────────

export function addMilestone(db: DB, projectId: string, input: z.input<typeof milestoneInput>): Milestone {
  const d = milestoneInput.parse(input);
  const { n } = get<{ n: number }>(db, 'SELECT coalesce(max(position), -1) + 1 AS n FROM milestones WHERE project_id = :projectId', { projectId })!;
  const id = newId('mst');
  const now = nowISO();
  run(db, 'INSERT INTO milestones (id, project_id, title, done, position, due_date, created_at, updated_at) VALUES (:id, :projectId, :title, :done, :n, :due_date, :now, :now)', {
    id,
    projectId,
    title: d.title,
    done: d.done,
    n,
    due_date: d.due_date ?? null,
    now,
  });
  return get<Milestone>(db, 'SELECT * FROM milestones WHERE id = :id', { id })!;
}

export function updateMilestone(db: DB, id: string, patch: z.input<typeof milestonePatch>, actor: Actor = 'user'): Milestone {
  const before = get<Milestone & { project_title: string }>(db, 'SELECT m.*, p.title AS project_title FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = :id', { id });
  if (!before) throw notFound('Étape');
  const q = buildUpdate('milestones', id, milestonePatch.parse(patch), ['title', 'done', 'due_date', 'position']);
  if (q) run(db, q.sql, q.params);
  const after = get<Milestone>(db, 'SELECT * FROM milestones WHERE id = :id', { id })!;
  if (!before.done && after.done) {
    logActivity(db, { kind: 'milestone.done', title: `Étape franchie : ${after.title}`, detail: before.project_title, entity_kind: 'project', entity_id: after.project_id, actor });
  }
  return after;
}

export function deleteMilestone(db: DB, id: string) {
  run(db, 'DELETE FROM milestones WHERE id = :id', { id });
}

// ─── Risques ─────────────────────────────────────────────────────────────────

export function addRisk(db: DB, projectId: string, input: z.input<typeof riskInput>): Risk {
  const d = riskInput.parse(input);
  const id = newId('rsk');
  const now = nowISO();
  run(db, 'INSERT INTO risks (id, project_id, title, severity, mitigation, status, created_at, updated_at) VALUES (:id, :projectId, :title, :severity, :mitigation, :status, :now, :now)', {
    id,
    projectId,
    ...d,
    now,
  });
  return get<Risk>(db, 'SELECT * FROM risks WHERE id = :id', { id })!;
}

export function updateRisk(db: DB, id: string, patch: z.input<typeof riskPatch>): Risk {
  const q = buildUpdate('risks', id, riskPatch.parse(patch), ['title', 'severity', 'mitigation', 'status']);
  if (q) run(db, q.sql, q.params);
  const r = get<Risk>(db, 'SELECT * FROM risks WHERE id = :id', { id });
  if (!r) throw notFound('Risque');
  return r;
}

export function deleteRisk(db: DB, id: string) {
  run(db, 'DELETE FROM risks WHERE id = :id', { id });
}

// ─── Dépenses (budget consommé) ──────────────────────────────────────────────

export function addExpense(db: DB, projectId: string, input: z.input<typeof expenseInput>): Expense {
  getProjectSummary(db, projectId);
  const d = expenseInput.parse(input);
  const id = newId('exp');
  run(db, 'INSERT INTO expenses (id, project_id, label, amount, date, created_at) VALUES (:id, :projectId, :label, :amount, :date, :now)', {
    id,
    projectId,
    ...d,
    now: nowISO(),
  });
  return get<Expense>(db, 'SELECT * FROM expenses WHERE id = :id', { id })!;
}

export function deleteExpense(db: DB, id: string) {
  run(db, 'DELETE FROM expenses WHERE id = :id', { id });
}

// ─── Analyses IA ─────────────────────────────────────────────────────────────

export function saveProjectAnalysis(db: DB, projectId: string, model: string, analysis: ProjectAnalysis) {
  const id = newId('pan');
  run(db, 'INSERT INTO project_analyses (id, project_id, model, analysis, created_at) VALUES (:id, :projectId, :model, :analysis, :now)', {
    id,
    projectId,
    model,
    analysis: JSON.stringify(analysis),
    now: nowISO(),
  });
  logActivity(db, { kind: 'project.analyzed', title: `Analyse IA : ${getProjectSummary(db, projectId).title}`, detail: `Score de santé ${Math.round(analysis.health_score)}/100`, entity_kind: 'project', entity_id: projectId, actor: 'ai' });
}
