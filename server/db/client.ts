/**
 * Accès SQLite.
 *
 * Décision : on utilise `node:sqlite`, le moteur SQLite intégré à Node.js (≥ 22.13).
 * Avantages : zéro dépendance native à compiler sur le Mac, un seul fichier de
 * données (`data/nexus.db`) facile à sauvegarder. Le module est encore marqué
 * « expérimental » par Node : on masque l'avertissement dans les scripts npm.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { migrate } from './migrations';

export type DB = DatabaseSync;
export type Row = Record<string, unknown>;
type Params = Record<string, unknown> | unknown[] | undefined;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** SQLite n'accepte ni `undefined` ni booléens : on normalise. */
function normalize(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

function bind(params: Params): SQLInputValue[] | [Record<string, SQLInputValue>] {
  if (params === undefined) return [];
  if (Array.isArray(params)) return params.map(normalize);
  const out: Record<string, SQLInputValue> = {};
  for (const [k, v] of Object.entries(params)) out[k] = normalize(v);
  return [out];
}

export function all<T = Row>(db: DB, sql: string, params?: Params): T[] {
  return db.prepare(sql).all(...(bind(params) as SQLInputValue[])) as T[];
}

export function get<T = Row>(db: DB, sql: string, params?: Params): T | undefined {
  return db.prepare(sql).get(...(bind(params) as SQLInputValue[])) as T | undefined;
}

export function run(db: DB, sql: string, params?: Params) {
  return db.prepare(sql).run(...(bind(params) as SQLInputValue[]));
}

/** Exécute `fn` dans une transaction (annulée si une erreur est levée). */
export function tx<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Identifiant court et lisible, préfixé par le type : `prj_Xk3...`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('base64url')}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** Date locale du jour (AAAA-MM-JJ), selon le fuseau de la machine. */
export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + days));
}

export function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Construit dynamiquement `SET a = :a, b = :b` pour un patch partiel. */
export function buildUpdate(table: string, id: string, patch: Record<string, unknown>, allowed: readonly string[]) {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k) && patch[k] !== undefined);
  if (keys.length === 0) return null;
  const set = keys.map((k) => `${k} = :${k}`).join(', ');
  const params: Record<string, unknown> = { id, updated_at: nowISO() };
  for (const k of keys) params[k] = patch[k];
  return { sql: `UPDATE ${table} SET ${set}, updated_at = :updated_at WHERE id = :id`, params };
}
