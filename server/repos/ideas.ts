import { z } from 'zod';
import { type DB, all, get, run, tx, newId, nowISO, todayISO, parseJSON, buildUpdate } from '../db/client';
import { ideaInput, ideaPatch, type IdeaAnalysis } from '../../shared/schemas';
import { AppError, notFound } from '../lib/errors';
import { emitEvent } from '../events';
import { logActivity, type Actor } from './activity';
import { createProject, getProject, type ProjectDetail } from './projects';
import { createTask } from './tasks';
import { createLink } from './links';

export interface Idea {
  id: string;
  content: string;
  title: string | null;
  status: 'inbox' | 'analyzed' | 'converted' | 'archived';
  analysis: IdeaAnalysis | null;
  analyzed_at: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

const hydrate = (row: Record<string, unknown>): Idea => ({ ...(row as unknown as Idea), analysis: parseJSON<IdeaAnalysis | null>(row.analysis, null) });

export function listIdeas(db: DB, opts: { status?: string } = {}): Idea[] {
  const where = opts.status ? 'WHERE status = :status' : "WHERE status != 'archived'";
  return all(db, `SELECT * FROM ideas ${where} ORDER BY created_at DESC`, opts.status ? { status: opts.status } : {}).map(hydrate);
}

export function getIdea(db: DB, id: string): Idea {
  const row = get(db, 'SELECT * FROM ideas WHERE id = :id', { id });
  if (!row) throw notFound('Idée');
  return hydrate(row);
}

export function createIdea(db: DB, input: z.input<typeof ideaInput>, actor: Actor = 'user'): Idea {
  const d = ideaInput.parse(input);
  const id = newId('ide');
  const now = nowISO();
  run(db, "INSERT INTO ideas (id, content, title, status, created_at, updated_at) VALUES (:id, :content, :title, 'inbox', :now, :now)", {
    id,
    content: d.content,
    title: d.title ?? null,
    now,
  });
  const idea = getIdea(db, id);
  logActivity(db, { kind: 'idea.created', title: `Idée capturée : ${idea.title ?? idea.content.slice(0, 60)}`, entity_kind: 'idea', entity_id: id, actor });
  emitEvent('idea.created', { idea });
  return idea;
}

export function updateIdea(db: DB, id: string, patch: z.input<typeof ideaPatch>): Idea {
  getIdea(db, id);
  const q = buildUpdate('ideas', id, ideaPatch.parse(patch), ['content', 'title', 'status']);
  if (q) run(db, q.sql, q.params);
  return getIdea(db, id);
}

export function saveIdeaAnalysis(db: DB, id: string, analysis: IdeaAnalysis): Idea {
  const idea = getIdea(db, id);
  run(db, "UPDATE ideas SET analysis = :analysis, analyzed_at = :now, title = coalesce(title, :title), status = CASE WHEN status = 'inbox' THEN 'analyzed' ELSE status END, updated_at = :now WHERE id = :id", {
    id,
    analysis: JSON.stringify(analysis),
    title: analysis.title,
    now: nowISO(),
  });
  logActivity(db, { kind: 'idea.analyzed', title: `Idée analysée : ${idea.title ?? analysis.title}`, detail: `Faisabilité ${analysis.feasibility.score}/10 · Potentiel ${analysis.potential.score}/10`, entity_kind: 'idea', entity_id: id, actor: 'ai' });
  return getIdea(db, id);
}

/**
 * Transforme une idée en projet. Si elle a été analysée, le plan devient
 * les étapes, les risques sont repris, et la « première action » devient une tâche.
 */
export function convertIdeaToProject(db: DB, id: string, actor: Actor = 'user'): ProjectDetail {
  const idea = getIdea(db, id);
  if (idea.status === 'converted' && idea.project_id) throw new AppError(409, 'already_converted', 'Cette idée est déjà devenue un projet');
  const a = idea.analysis;
  return tx(db, () => {
    const project = createProject(
      db,
      {
        title: (idea.title ?? a?.title ?? idea.content.slice(0, 80)).slice(0, 200),
        description: a ? `${a.summary}\n\n— Idée d'origine —\n${idea.content}` : idea.content,
        objective: a?.verdict_reason ?? '',
        status: 'planning',
        start_date: todayISO(),
      },
      actor,
      {
        milestones: a?.plan.map((s) => s.title.slice(0, 200)),
        risks: a?.risks.map((r) => ({ title: r.slice(0, 200), severity: 'medium' as const })),
      },
    );
    if (a?.first_action) createTask(db, { title: a.first_action.slice(0, 200), priority: 1, project_id: project.id }, actor);
    run(db, "UPDATE ideas SET status = 'converted', project_id = :pid, updated_at = :now WHERE id = :id", { id, pid: project.id, now: nowISO() });
    createLink(db, { source: { kind: 'idea', id }, target: { kind: 'project', id: project.id }, label: 'devenue' });
    return getProject(db, project.id);
  });
}

export function deleteIdea(db: DB, id: string) {
  getIdea(db, id);
  run(db, 'DELETE FROM ideas WHERE id = :id', { id });
  run(db, "DELETE FROM links WHERE (source_kind = 'idea' AND source_id = :id) OR (target_kind = 'idea' AND target_id = :id)", { id });
}
