import { type DB, all, get, run, newId, nowISO, parseJSON } from '../db/client';
import { notFound } from '../lib/errors';

export interface Conversation { id: string; title: string; model: string; created_at: string; updated_at: string; message_count?: number }
export type MessageKind = 'user' | 'assistant' | 'tool_results';
export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  kind: MessageKind;
  content: unknown[]; // blocs API exacts
  text: string; // texte visible
  meta: Record<string, unknown>;
  created_at: string;
}

export function listConversations(db: DB): Conversation[] {
  return all<Conversation>(db, `SELECT c.*, (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.kind != 'tool_results') AS message_count
    FROM conversations c ORDER BY c.updated_at DESC LIMIT 200`);
}

export function getConversation(db: DB, id: string): Conversation {
  const c = get<Conversation>(db, 'SELECT * FROM conversations WHERE id = :id', { id });
  if (!c) throw notFound('Conversation');
  return c;
}

export function createConversation(db: DB, model: string, title = 'Nouvelle conversation'): Conversation {
  const id = newId('cnv');
  const now = nowISO();
  run(db, 'INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (:id, :title, :model, :now, :now)', { id, title, model, now });
  return getConversation(db, id);
}

export function renameConversation(db: DB, id: string, title: string) {
  run(db, 'UPDATE conversations SET title = :title WHERE id = :id', { id, title: title.slice(0, 120) });
}

export function deleteConversation(db: DB, id: string) {
  run(db, 'DELETE FROM conversations WHERE id = :id', { id });
}

/** Ajoute un message — l'historique est en AJOUT SEUL : on ne modifie jamais un message existant. */
export function appendMessage(db: DB, m: Omit<StoredMessage, 'id' | 'created_at'>): StoredMessage {
  const id = newId('msg');
  // created_at strictement croissant pour garder l'ordre même dans la même milliseconde.
  const last = get<{ created_at: string }>(db, 'SELECT max(created_at) AS created_at FROM messages WHERE conversation_id = :c', { c: m.conversation_id });
  let ts = nowISO();
  if (last?.created_at && ts <= last.created_at) ts = new Date(new Date(last.created_at).getTime() + 1).toISOString();
  run(db, 'INSERT INTO messages (id, conversation_id, role, kind, content, text, meta, created_at) VALUES (:id, :cid, :role, :kind, :content, :text, :meta, :ts)', {
    id,
    cid: m.conversation_id,
    role: m.role,
    kind: m.kind,
    content: JSON.stringify(m.content),
    text: m.text,
    meta: JSON.stringify(m.meta),
    ts,
  });
  run(db, 'UPDATE conversations SET updated_at = :ts WHERE id = :cid', { ts, cid: m.conversation_id });
  return { ...m, id, created_at: ts };
}

export function listMessages(db: DB, conversationId: string): StoredMessage[] {
  return all<Record<string, unknown>>(db, 'SELECT * FROM messages WHERE conversation_id = :id ORDER BY created_at ASC', { id: conversationId }).map((r) => ({
    ...(r as unknown as StoredMessage),
    content: parseJSON<unknown[]>(r.content, []),
    meta: parseJSON<Record<string, unknown>>(r.meta, {}),
  }));
}
