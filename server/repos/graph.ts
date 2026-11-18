/**
 * Graphe de connaissances : assemble toutes les entités en nœuds et leurs
 * relations (explicites via `links`, implicites via les clés étrangères).
 */
import { type DB, all } from '../db/client';
import type { EntityKind } from '../../shared/schemas';

export interface GraphNode { id: string; kind: EntityKind; ref_id: string; label: string; status?: string; weight: number; color?: string }
export interface GraphEdge { id: string; source: string; target: string; label: string; implicit: boolean; link_id?: string }

const key = (kind: string, id: string) => `${kind}:${id}`;

export function buildGraph(db: DB, opts: { includeTasks?: boolean; includeDone?: boolean } = {}) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const push = (kind: EntityKind, rows: { id: string; label: string; status?: string; color?: string }[]) =>
    rows.forEach((r) => nodes.push({ id: key(kind, r.id), kind, ref_id: r.id, label: r.label, status: r.status, color: r.color, weight: 1 }));

  push('goal', all(db, "SELECT id, title AS label, status FROM goals WHERE status != 'abandoned'"));
  push('project', all(db, "SELECT id, title AS label, status, color FROM projects WHERE status != 'archived'"));
  push('idea', all(db, "SELECT id, coalesce(title, substr(content, 1, 60)) AS label, status FROM ideas WHERE status != 'archived'"));
  push('note', all(db, 'SELECT id, title AS label FROM notes'));
  push('memory', all(db, 'SELECT id, substr(content, 1, 60) AS label, kind AS status FROM memories'));
  if (opts.includeTasks) {
    const filter = opts.includeDone ? '' : "WHERE status != 'done'";
    push('task', all(db, `SELECT id, title AS label, status FROM tasks ${filter}`));
  }

  const present = new Set(nodes.map((n) => n.id));
  const addEdge = (e: GraphEdge) => {
    if (present.has(e.source) && present.has(e.target)) edges.push(e);
  };

  for (const p of all<{ id: string; goal_id: string }>(db, 'SELECT id, goal_id FROM projects WHERE goal_id IS NOT NULL'))
    addEdge({ id: `fk:pg:${p.id}`, source: key('project', p.id), target: key('goal', p.goal_id), label: 'sert', implicit: true });
  for (const i of all<{ id: string; project_id: string }>(db, 'SELECT id, project_id FROM ideas WHERE project_id IS NOT NULL'))
    addEdge({ id: `fk:ip:${i.id}`, source: key('idea', i.id), target: key('project', i.project_id), label: 'devenue', implicit: true });
  if (opts.includeTasks) {
    for (const t of all<{ id: string; project_id: string | null; goal_id: string | null }>(db, 'SELECT id, project_id, goal_id FROM tasks')) {
      if (t.project_id) addEdge({ id: `fk:tp:${t.id}`, source: key('task', t.id), target: key('project', t.project_id), label: '', implicit: true });
      if (t.goal_id) addEdge({ id: `fk:tg:${t.id}`, source: key('task', t.id), target: key('goal', t.goal_id), label: '', implicit: true });
    }
  }
  for (const l of all<{ id: string; source_kind: string; source_id: string; target_kind: string; target_id: string; label: string }>(db, 'SELECT * FROM links')) {
    const e = { id: l.id, link_id: l.id, source: key(l.source_kind, l.source_id), target: key(l.target_kind, l.target_id), label: l.label, implicit: false };
    // Un lien explicite remplace un lien implicite identique.
    const dup = edges.findIndex((x) => x.implicit && ((x.source === e.source && x.target === e.target) || (x.source === e.target && x.target === e.source)));
    if (dup >= 0) edges.splice(dup, 1);
    addEdge(e);
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  for (const n of nodes) n.weight = 1 + (degree.get(n.id) ?? 0);
  return { nodes, edges };
}
