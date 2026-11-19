/**
 * Apple Santé → NEXUS, via un Raccourci iPhone.
 *
 * Apple n'offre pas d'accès en ligne aux données Santé : elles restent sur l'iPhone.
 * Un Raccourci (app Raccourcis, automatisation quotidienne) lit les mesures du jour
 * et les envoie en JSON à NEXUS (`POST /api/ingest/health`), avec un jeton limité
 * à cet usage. Renvoyer plusieurs fois le même jour remplace les valeurs : pas de doublons.
 */
import type { DB } from '../db/client';
import { todayISO } from '../db/client';
import type { HealthIngest } from '../../shared/schemas';
import { importWorkout, setDailyValue, getState, setState, type MetricSpec, type WorkoutType } from './common';

const ID = 'apple-health';
const SOURCE = 'apple-health';

export const HEALTH_METRICS: Record<'steps' | 'sleep' | 'weight' | 'resting_hr' | 'active_kcal', MetricSpec> = {
  steps: { key: 'health.steps', name: 'Pas', unit: 'pas', direction: 'up', category: 'health', color: '#8fb4ff' },
  sleep: { key: 'health.sleep', name: 'Sommeil', unit: 'h', direction: 'up', category: 'health', color: '#8fb4ff' },
  weight: { key: 'health.weight', name: 'Poids', unit: 'kg', direction: 'down', category: 'health', color: '#8fb4ff' },
  resting_hr: { key: 'health.resting_hr', name: 'FC au repos', unit: 'bpm', direction: 'down', category: 'health', color: '#8fb4ff' },
  active_kcal: { key: 'health.active_kcal', name: 'Calories actives', unit: 'kcal', direction: 'up', category: 'health', color: '#8fb4ff' },
};

/** Types d'entraînement (noms français de l'app Santé ou identifiants HealthKit) → types NEXUS. */
export function mapHealthWorkout(type: string): WorkoutType {
  const t = type.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/run|course|trail|jogging/.test(t)) return 'run';
  if (/cycl|velo|bike/.test(t)) return 'bike';
  if (/swim|natation|nage/.test(t)) return 'swim';
  if (/strength|musculation|renforcement|traditionalstrength|functional/.test(t)) return 'strength';
  if (/hiit|fractionne|high.?intensity|cross/.test(t)) return 'hiit';
  if (/walk|marche|hik|randonnee/.test(t)) return 'walk';
  if (/yoga|pilates/.test(t)) return 'yoga';
  if (/soccer|football|tennis|basket|padel|badminton|squash|rugby|volley|ski|climb|escalade|row|aviron/.test(t)) return 'sport';
  return 'other';
}

export function ingestHealth(db: DB, p: HealthIngest) {
  const date = p.date ?? todayISO();
  const saved: string[] = [];
  const put = (field: string, spec: MetricSpec, v: number | undefined, valid: (n: number) => boolean) => {
    if (v === undefined || !valid(v)) return;
    setDailyValue(db, spec, date, v, SOURCE);
    saved.push(field);
  };
  put('steps', HEALTH_METRICS.steps, p.steps, (n) => n < 200_000);
  const sleep = p.sleep_hours ?? (p.sleep_minutes !== undefined ? p.sleep_minutes / 60 : undefined);
  put('sleep', HEALTH_METRICS.sleep, sleep !== undefined ? Math.round(sleep * 100) / 100 : undefined, (n) => n > 0 && n <= 24);
  put('weight', HEALTH_METRICS.weight, p.weight_kg, (n) => n > 20 && n < 400);
  put('resting_hr', HEALTH_METRICS.resting_hr, p.resting_hr, (n) => n > 20 && n < 200);
  put('active_kcal', HEALTH_METRICS.active_kcal, p.active_kcal, (n) => n < 20_000);

  const workouts = { added: 0, known: 0, similar: 0 };
  for (const w of p.workouts ?? []) {
    if (!w.duration_min) continue;
    const day = /^\d{4}-\d{2}-\d{2}/.test(w.start) ? w.start.slice(0, 10) : date;
    workouts[importWorkout(db, { date: day, type: mapHealthWorkout(w.type), duration_min: w.duration_min, distance_km: w.distance_km ?? null, notes: `${w.type} (Apple Santé)` }, SOURCE, `${w.start}|${w.type}`)]++;
  }
  const state = getState(db, ID);
  setState(db, ID, { lastReceivedAt: new Date().toISOString(), lastDate: date, lastFields: saved, receivedCount: ((state.receivedCount as number) ?? 0) + 1 });
  return { date, saved, workouts };
}

export function healthStatus(db: DB) {
  const s = getState(db, ID);
  return { lastReceivedAt: (s.lastReceivedAt as string) ?? null, lastDate: (s.lastDate as string) ?? null, lastFields: (s.lastFields as string[]) ?? [], receivedCount: (s.receivedCount as number) ?? 0 };
}
