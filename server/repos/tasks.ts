import { z } from 'zod';
import { type DB, all, get, run, newId, nowISO, todayISO, buildUpdate } from '../db/client';
import { taskInput, taskPatch } from '../../shared/schemas';
import { notFound } from '../lib/errors';
import { emitEvent } from '../events';
import { logActivity, type Actor } from './activity';

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: 'todo' | 'doing' | 'done';
  priority: 1 | 2 | 3;
  due_date: string | null;
  project_id: string | null;
  goal_id: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_title?: string | null;
  project_color?: string | null;
}

const SELECT = `SELECT t.*, p.title AS project_title, p.color AS project_color
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id`;

export interface TaskFilters {
  status?: 'todo' | 'doing' | 'done' | 'open';
  project_id?: string;
  due_before?: string;
  limit?: number;
}

export function listTasks(db: DB, f: TaskFilters = {}): Task[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { limit: f.limit ?? 500 };
  if (f.status === 'open') where.push("t.status != 'done'");
  else if (f.status) (where.push('t.status = :status'), (params.status = f.status));
  if (f.project_id) (where.push('t.project_id = :project_id'), (params.project_id = f.project_id));
  if (f.due_before) (where.push('t.due_date IS NOT NULL AND t.due_date <= :due_before'), (params.due_before = f.due_before));
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
             t.priority ASC, coalesce(t.due_date, '9999-12-31') ASC, t.created_at DESC
    LIMIT :limit`;
  return all<Task>(db, sql, params);
}

export function getTask(db: DB, id: string): Task {
  const t = get<Task>(db, `${SELECT} WHERE t.id = :id`, { id });
  if (!t) throw notFound('Tâche');
  return t;
}

/** Tâches prioritaires : en cours, en retard, à échéance proche, puis haute priorité. */
export function focusTasks(db: DB, limit = 7): Task[] {
  const today = todayISO();
  return all<Task>(
    db,
    `${SELECT} WHERE t.status != 'done'
     ORDER BY CASE WHEN t.status = 'doing' THEN 0
                   WHEN t.due_date IS NOT NULL AND t.due_date <= :today THEN 1
                   ELSE 2 END,
              t.priority ASC, coalesce(t.due_date, '9999-12-31') ASC, t.created_at ASC
     LIMIT :limit`,
    { today, limit },
  );
}

export function createTask(db: DB, input: z.input<typeof taskInput>, actor: Actor = 'user'): Task {
  const data = taskInput.parse(input);
  const id = newId('tsk');
  const now = nowISO();
  run(
    db,
    `INSERT INTO tasks (id, title, notes, status, priority, due_date, project_id, goal_id, source, created_at, updated_at, completed_at)
     VALUES (:id, :title, :notes, :status, :priority, :due_date, :project_id, :goal_id, :source, :now, :now, :completed_at)`,
    { id, ...data, due_date: data.due_date ?? null, project_id: data.project_id ?? null, goal_id: data.goal_id ?? null, source: actor, now, completed_at: data.status === 'done' ? now : null },
  );
  const task = getTask(db, id);
  logActivity(db, { kind: 'task.created', title: `Tâche créée : ${task.title}`, entity_kind: 'task', entity_id: id, actor });
  emitEvent('task.created', { task });
  return task;
}

export function updateTask(db: DB, id: string, patch: z.input<typeof taskPatch>, actor: Actor = 'user'): Task {
  const before = getTask(db, id);
  const data = taskPatch.parse(patch) as Record<string, unknown>;
  if (data.status && data.status !== before.status) data.completed_at = data.status === 'done' ? nowISO() : null;
  const q = buildUpdate('tasks', id, data, ['title', 'notes', 'status', 'priority', 'due_date', 'project_id', 'goal_id', 'completed_at']);
  if (q) run(db, q.sql, q.params);
  const task = getTask(db, id);
  if (before.status !== 'done' && task.status === 'done') {
    logActivity(db, { kind: 'task.completed', title: `Tâche terminée : ${task.title}`, entity_kind: 'task', entity_id: id, actor });
    emitEvent('task.completed', { task });
  }
  return task;
}

export function deleteTask(db: DB, id: string) {
  getTask(db, id);
  run(db, 'DELETE FROM tasks WHERE id = :id', { id });
  run(db, "DELETE FROM links WHERE (source_kind = 'task' AND source_id = :id) OR (target_kind = 'task' AND target_id = :id)", { id });
}
