/**
 * Outils communs aux intégrations (Strava, Menhir, Apple Santé).
 *
 * Le piège classique : la même sortie arrive par plusieurs chemins (ta montre
 * l'envoie à Strava, qui l'écrit dans Apple Santé, et Menhir l'importe aussi).
 * `importWorkout` évite les doublons à deux niveaux :
 *  1. même source + même identifiant externe → déjà importée ;
 *  2. une séance d'une AUTRE source, le même jour, même type, durée et distance
 *     proches → c'est la même séance vue ailleurs, on ne la recopie pas.
 */
import { type DB, all, get, run, newId, nowISO, parseJSON } from '../db/client';
import { createWorkout } from '../repos/analytics';
import { WORKOUT_TYPES } from '../../shared/schemas';

export type WorkoutType = (typeof WORKOUT_TYPES)[number];
export type ImportOutcome = 'added' | 'known' | 'similar';

export interface IncomingWorkout {
  date: string; // AAAA-MM-JJ
  type: WorkoutType;
  duration_min: number;
  distance_km?: number | null;
  intensity?: number;
  notes?: string;
}

/** Deux séances sont « la même » si type, durée (±12 %) et distance (±5 %) concordent. */
export function isSameSession(a: { type: string; duration_min: number; distance_km: number | null }, b: IncomingWorkout): boolean {
  if (a.type !== b.type) return false;
  const dd = Math.abs(a.duration_min - b.duration_min);
  if (dd > Math.max(3, 0.12 * Math.max(a.duration_min, b.duration_min))) return false;
  if (a.distance_km && b.distance_km) {
    const dk = Math.abs(a.distance_km - b.distance_km);
    if (dk > Math.max(0.3, 0.05 * Math.max(a.distance_km, b.distance_km))) return false;
  }
  return true;
}

export function importWorkout(db: DB, w: IncomingWorkout, source: string, externalId: string): ImportOutcome {
  if (get(db, 'SELECT 1 FROM workouts WHERE source = :source AND external_id = :externalId', { source, externalId })) return 'known';
  const sameDay = all<{ type: string; duration_min: number; distance_km: number | null }>(
    db,
    'SELECT type, duration_min, distance_km FROM workouts WHERE date = :date AND source != :source',
    { date: w.date, source },
  );
  if (sameDay.some((x) => isSameSession(x, w))) return 'similar';
  createWorkout(
    db,
    {
      date: w.date,
      type: w.type,
      duration_min: Math.min(1440, Math.max(1, Math.round(w.duration_min * 10) / 10)),
      distance_km: w.distance_km ? Math.round(w.distance_km * 100) / 100 : null,
      intensity: Math.min(5, Math.max(1, Math.round(w.intensity ?? 3))),
      notes: (w.notes ?? '').slice(0, 2000),
    },
    'system',
    source,
    externalId,
    { silent: true },
  );
  return 'added';
}

/** Intensité 1-5 estimée à partir de la fréquence cardiaque moyenne (sinon « moyenne »). */
export function intensityFromHeartRate(avgHr: number | null | undefined): number {
  if (!avgHr) return 3;
  if (avgHr < 125) return 2;
  if (avgHr < 145) return 3;
  if (avgHr < 162) return 4;
  return 5;
}

// ─── Métriques alimentées automatiquement (pas, sommeil, poids…) ─────────────

export interface MetricSpec {
  key: string;
  name: string;
  unit: string;
  direction: 'up' | 'down';
  category: 'health' | 'sport' | 'productivity' | 'finance' | 'custom';
  color: string;
}

/** Trouve (ou crée) la métrique : par clé, sinon par nom (ex. « Sommeil » déjà créé à la main). */
export function ensureMetric(db: DB, spec: MetricSpec): string {
  const byKey = get<{ id: string }>(db, 'SELECT id FROM metrics WHERE key = :key', { key: spec.key });
  if (byKey) return byKey.id;
  const byName = get<{ id: string }>(db, 'SELECT id FROM metrics WHERE key IS NULL AND lower(name) = lower(:name)', { name: spec.name });
  if (byName) {
    run(db, 'UPDATE metrics SET key = :key WHERE id = :id', { key: spec.key, id: byName.id });
    return byName.id;
  }
  const id = newId('met');
  const now = nowISO();
  run(db, 'INSERT INTO metrics (id, name, unit, category, target, direction, color, key, created_at, updated_at) VALUES (:id, :name, :unit, :category, NULL, :direction, :color, :key, :now, :now)', {
    id,
    ...spec,
    now,
  });
  return id;
}

/** Enregistre la valeur d'un jour pour une source (remplace la précédente : renvoyer deux fois ne double pas). */
export function setDailyValue(db: DB, spec: MetricSpec, date: string, value: number, source: string): 'added' | 'updated' {
  const metricId = ensureMetric(db, spec);
  const existed = run(db, 'DELETE FROM metric_entries WHERE metric_id = :metricId AND date = :date AND source = :source', { metricId, date, source }).changes > 0;
  run(db, "INSERT INTO metric_entries (id, metric_id, date, value, note, source, created_at) VALUES (:id, :metricId, :date, :value, '', :source, :now)", {
    id: newId('mte'),
    metricId,
    date,
    value: Math.round(value * 100) / 100,
    source,
    now: nowISO(),
  });
  return existed ? 'updated' : 'added';
}

// ─── État des intégrations ───────────────────────────────────────────────────

export interface SyncState {
  lastSyncAt?: string;
  lastError?: string | null;
  lastResult?: Record<string, number>;
  /** Totaux depuis la connexion. */
  totals?: Record<string, number>;
  [k: string]: unknown;
}

export function getState(db: DB, id: string): SyncState {
  const row = get<{ data: string }>(db, 'SELECT data FROM integration_state WHERE id = :id', { id });
  return parseJSON<SyncState>(row?.data, {});
}

export function setState(db: DB, id: string, patch: SyncState): SyncState {
  const next = { ...getState(db, id), ...patch };
  run(db, 'INSERT INTO integration_state (id, data, updated_at) VALUES (:id, :data, :now) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', {
    id,
    data: JSON.stringify(next),
    now: nowISO(),
  });
  return next;
}

export function clearState(db: DB, id: string) {
  run(db, 'DELETE FROM integration_state WHERE id = :id', { id });
}

/** Additionne les compteurs d'une synchro aux totaux. */
export function addTotals(prev: Record<string, number> | undefined, add: Record<string, number>): Record<string, number> {
  const out = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(add)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Appel HTTP JSON avec message d'erreur lisible. */
export async function fetchJson<T>(f: typeof fetch, url: string, init: RequestInit = {}, service = 'Service'): Promise<T> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000) });
  } catch {
    throw new IntegrationError(`${service} est injoignable (connexion Internet ?).`, 'network');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* réponse non JSON */
  }
  if (!res.ok) {
    const msg = (data as { message?: string; error_description?: string; msg?: string } | null)?.error_description ?? (data as { message?: string } | null)?.message ?? (data as { msg?: string } | null)?.msg ?? text.slice(0, 200);
    throw new IntegrationError(`${service} : ${msg || `erreur ${res.status}`}`, res.status === 401 || res.status === 400 || res.status === 403 ? 'auth' : 'api', res.status);
  }
  return data as T;
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    public kind: 'network' | 'auth' | 'api' | 'config',
    public status?: number,
  ) {
    super(message);
  }
}
