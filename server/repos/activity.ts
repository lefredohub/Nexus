import { type DB, all, run, newId, nowISO } from '../db/client';

export type Actor = 'user' | 'ai' | 'automation' | 'system';

export interface ActivityInput {
  kind: string; // ex: task.created, project.updated, automation.notify
  title: string;
  detail?: string;
  entity_kind?: string | null;
  entity_id?: string | null;
  actor?: Actor;
}

export function logActivity(db: DB, a: ActivityInput) {
  run(
    db,
    `INSERT INTO activity (id, kind, entity_kind, entity_id, title, detail, actor, created_at)
     VALUES (:id, :kind, :entity_kind, :entity_id, :title, :detail, :actor, :created_at)`,
    {
      id: newId('act'),
      kind: a.kind,
      entity_kind: a.entity_kind ?? null,
      entity_id: a.entity_id ?? null,
      title: a.title,
      detail: a.detail ?? '',
      actor: a.actor ?? 'user',
      created_at: nowISO(),
    },
  );
}

export function listActivity(db: DB, limit = 30) {
  return all(db, 'SELECT * FROM activity ORDER BY created_at DESC LIMIT :limit', { limit });
}
