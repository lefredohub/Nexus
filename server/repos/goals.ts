import { z } from 'zod';
import { type DB, all, get, run, newId, nowISO, buildUpdate } from '../db/client';
import { goalInput, goalPatch } from '../../shared/schemas';
import { notFound } from '../lib/errors';
import { logActivity, type Actor } from './activity';

export interface Goal {
  id: string;
  title: string;
  description: string;
  area: string;
  metric_unit: string | null;
  start_value: number;
  target_value: number | null;
  current_value: number;
  due_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  progress: number; // 0..1
  project_count: number;
  open_tasks: number;
}

export function goalProgress(g: Pick<Goal, 'status' | 'start_value' | 'target_value' | 'current_value'>): number {
  if (g.status === 'achieved') return 1;
  if (g.target_value === null || g.target_value === undefined || g.target_value === g.start_value) return 0;
  const p = (g.current_value - g.start_value) / (g.target_value - g.start_value);
  return Math.max(0, Math.min(1, p));
}

const SELECT = `SELECT g.*,
  (SELECT count(*) FROM projects p WHERE p.goal_id = g.id AND p.status NOT IN ('archived')) AS project_count,
  (SELECT count(*) FROM tasks t WHERE t.goal_id = g.id AND t.status != 'done') AS open_tasks
  FROM goals g`;

const withProgress = (g: Omit<Goal, 'progress'>): Goal => ({ ...g, progress: goalProgress(g) });

export function listGoals(db: DB, opts: { includeInactive?: boolean } = {}): Goal[] {
  const where = opts.includeInactive ? '' : "WHERE g.status IN ('active', 'paused')";
  return all<Omit<Goal, 'progress'>>(db, `${SELECT} ${where} ORDER BY CASE g.status WHEN 'active' THEN 0 ELSE 1 END, coalesce(g.due_date, '9999') ASC`).map(withProgress);
}

export function getGoal(db: DB, id: string): Goal {
  const g = get<Omit<Goal, 'progress'>>(db, `${SELECT} WHERE g.id = :id`, { id });
  if (!g) throw notFound('Objectif');
  return withProgress(g);
}

export function createGoal(db: DB, input: z.input<typeof goalInput>, actor: Actor = 'user'): Goal {
  const d = goalInput.parse(input);
  const id = newId('gol');
  const now = nowISO();
  run(
    db,
    `INSERT INTO goals (id, title, description, area, metric_unit, start_value, target_value, current_value, due_date, status, created_at, updated_at)
     VALUES (:id, :title, :description, :area, :metric_unit, :start_value, :target_value, :current_value, :due_date, :status, :now, :now)`,
    { id, ...d, metric_unit: d.metric_unit ?? null, target_value: d.target_value ?? null, due_date: d.due_date ?? null, now },
  );
  logActivity(db, { kind: 'goal.created', title: `Objectif défini : ${d.title}`, entity_kind: 'goal', entity_id: id, actor });
  return getGoal(db, id);
}

export function updateGoal(db: DB, id: string, patch: z.input<typeof goalPatch>, actor: Actor = 'user'): Goal {
  const before = getGoal(db, id);
  const d = goalPatch.parse(patch);
  const q = buildUpdate('goals', id, d, ['title', 'description', 'area', 'metric_unit', 'start_value', 'target_value', 'current_value', 'due_date', 'status']);
  if (q) run(db, q.sql, q.params);
  const goal = getGoal(db, id);
  if (before.status !== 'achieved' && goal.status === 'achieved') {
    logActivity(db, { kind: 'goal.achieved', title: `Objectif atteint : ${goal.title}`, entity_kind: 'goal', entity_id: id, actor });
  } else if (d.current_value !== undefined && d.current_value !== before.current_value) {
    logActivity(db, {
      kind: 'goal.progress',
      title: `Progression : ${goal.title}`,
      detail: `${before.current_value} → ${goal.current_value}${goal.metric_unit ? ' ' + goal.metric_unit : ''}`,
      entity_kind: 'goal',
      entity_id: id,
      actor,
    });
  }
  return goal;
}

export function deleteGoal(db: DB, id: string) {
  getGoal(db, id);
  run(db, 'DELETE FROM goals WHERE id = :id', { id });
  run(db, "DELETE FROM links WHERE (source_kind = 'goal' AND source_id = :id) OR (target_kind = 'goal' AND target_id = :id)", { id });
}
