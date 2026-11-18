import { z } from 'zod';
import { type DB, all, get, run, newId, nowISO, parseJSON, buildUpdate } from '../db/client';
import { noteInput, notePatch, memoryInput, memoryPatch } from '../../shared/schemas';
import { notFound } from '../lib/errors';
import { logActivity, type Actor } from './activity';

export interface Note { id: string; title: string; content: string; tags: string[]; pinned: boolean; created_at: string; updated_at: string }
export interface Memory { id: string; content: string; kind: string; importance: number; source: string; created_at: string; updated_at: string }

const hydrateNote = (r: Record<string, unknown>): Note => ({ ...(r as unknown as Note), tags: parseJSON<string[]>(r.tags, []), pinned: r.pinned === 1 });

export function listNotes(db: DB): Note[] {
  return all(db, 'SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC').map(hydrateNote);
}
export function getNote(db: DB, id: string): Note {
  const r = get(db, 'SELECT * FROM notes WHERE id = :id', { id });
  if (!r) throw notFound('Note');
  return hydrateNote(r);
}
export function createNote(db: DB, input: z.input<typeof noteInput>, actor: Actor = 'user'): Note {
  const d = noteInput.parse(input);
  const id = newId('nte');
  const now = nowISO();
  run(db, 'INSERT INTO notes (id, title, content, tags, pinned, created_at, updated_at) VALUES (:id, :title, :content, :tags, :pinned, :now, :now)', {
    id, ...d, tags: JSON.stringify(d.tags), now,
  });
  logActivity(db, { kind: 'note.created', title: `Note : ${d.title}`, entity_kind: 'note', entity_id: id, actor });
  return getNote(db, id);
}
export function updateNote(db: DB, id: string, patch: z.input<typeof notePatch>): Note {
  getNote(db, id);
  const d = notePatch.parse(patch) as Record<string, unknown>;
  if (d.tags) d.tags = JSON.stringify(d.tags);
  const q = buildUpdate('notes', id, d, ['title', 'content', 'tags', 'pinned']);
  if (q) run(db, q.sql, q.params);
  return getNote(db, id);
}
export function deleteNote(db: DB, id: string) {
  getNote(db, id);
  run(db, 'DELETE FROM notes WHERE id = :id', { id });
  run(db, "DELETE FROM links WHERE (source_kind = 'note' AND source_id = :id) OR (target_kind = 'note' AND target_id = :id)", { id });
}

// ─── Mémoire long terme de l'IA ──────────────────────────────────────────────

export function listMemories(db: DB, limit = 500): Memory[] {
  return all<Memory>(db, 'SELECT * FROM memories ORDER BY importance DESC, updated_at DESC LIMIT :limit', { limit });
}
export function getMemory(db: DB, id: string): Memory {
  const r = get<Memory>(db, 'SELECT * FROM memories WHERE id = :id', { id });
  if (!r) throw notFound('Souvenir');
  return r;
}
export function createMemory(db: DB, input: z.input<typeof memoryInput>, actor: Actor = 'user'): Memory {
  const d = memoryInput.parse(input);
  const id = newId('mem');
  const now = nowISO();
  run(db, 'INSERT INTO memories (id, content, kind, importance, source, created_at, updated_at) VALUES (:id, :content, :kind, :importance, :source, :now, :now)', {
    id, ...d, source: actor === 'ai' ? 'ai' : 'user', now,
  });
  logActivity(db, { kind: 'memory.created', title: actor === 'ai' ? 'NEXUS a mémorisé une information' : 'Souvenir ajouté', detail: d.content.slice(0, 140), entity_kind: 'memory', entity_id: id, actor });
  return getMemory(db, id);
}
export function updateMemory(db: DB, id: string, patch: z.input<typeof memoryPatch>): Memory {
  getMemory(db, id);
  const q = buildUpdate('memories', id, memoryPatch.parse(patch), ['content', 'kind', 'importance']);
  if (q) run(db, q.sql, q.params);
  return getMemory(db, id);
}
export function deleteMemory(db: DB, id: string) {
  getMemory(db, id);
  run(db, 'DELETE FROM memories WHERE id = :id', { id });
  run(db, "DELETE FROM links WHERE (source_kind = 'memory' AND source_id = :id) OR (target_kind = 'memory' AND target_id = :id)", { id });
}
