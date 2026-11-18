import { z } from 'zod';
import { type DB, all, get, run, newId, nowISO } from '../db/client';
import { linkInput, type EntityKind } from '../../shared/schemas';
import { AppError, notFound } from '../lib/errors';

const TABLE: Record<EntityKind, { table: string; title: string }> = {
  project: { table: 'projects', title: 'title' },
  task: { table: 'tasks', title: 'title' },
  goal: { table: 'goals', title: 'title' },
  idea: { table: 'ideas', title: "coalesce(title, substr(content, 1, 80))" },
  note: { table: 'notes', title: 'title' },
  memory: { table: 'memories', title: 'substr(content, 1, 80)' },
};

/** Titre lisible d'une entité, ou `null` si elle n'existe pas. */
export function entityTitle(db: DB, kind: EntityKind, id: string): string | null {
  const t = TABLE[kind];
  if (!t) return null;
  const row = get<{ title: string }>(db, `SELECT ${t.title} AS title FROM ${t.table} WHERE id = :id`, { id });
  return row?.title ?? null;
}

export interface Link { id: string; source_kind: EntityKind; source_id: string; target_kind: EntityKind; target_id: string; label: string; created_at: string }

export function createLink(db: DB, input: z.input<typeof linkInput>): Link {
  const d = linkInput.parse(input);
  if (d.source.kind === d.target.kind && d.source.id === d.target.id) throw new AppError(422, 'self_link', 'Un élément ne peut pas être relié à lui-même');
  for (const ref of [d.source, d.target]) if (entityTitle(db, ref.kind, ref.id) === null) throw notFound(`Élément ${ref.kind}`);
  // Un lien est non orienté pour l'utilisateur : on évite le doublon inverse.
  const existing = get<Link>(
    db,
    `SELECT * FROM links WHERE (source_kind = :sk AND source_id = :si AND target_kind = :tk AND target_id = :ti)
                            OR (source_kind = :tk AND source_id = :ti AND target_kind = :sk AND target_id = :si)`,
    { sk: d.source.kind, si: d.source.id, tk: d.target.kind, ti: d.target.id },
  );
  if (existing) return existing;
  const id = newId('lnk');
  run(db, 'INSERT INTO links (id, source_kind, source_id, target_kind, target_id, label, created_at) VALUES (:id, :sk, :si, :tk, :ti, :label, :now)', {
    id, sk: d.source.kind, si: d.source.id, tk: d.target.kind, ti: d.target.id, label: d.label, now: nowISO(),
  });
  return get<Link>(db, 'SELECT * FROM links WHERE id = :id', { id })!;
}

export function deleteLink(db: DB, id: string) {
  run(db, 'DELETE FROM links WHERE id = :id', { id });
}

export function linksFor(db: DB, kind: EntityKind, id: string) {
  const rows = all<Link>(db, 'SELECT * FROM links WHERE (source_kind = :kind AND source_id = :id) OR (target_kind = :kind AND target_id = :id)', { kind, id });
  return rows.map((l) => {
    const isSource = l.source_kind === kind && l.source_id === id;
    const other = isSource ? { kind: l.target_kind, id: l.target_id } : { kind: l.source_kind, id: l.source_id };
    return { link_id: l.id, label: l.label, ...other, title: entityTitle(db, other.kind, other.id) };
  });
}
