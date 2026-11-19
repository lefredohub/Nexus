/**
 * Personal Analytics : finances, sport, habitudes et métriques libres.
 *
 * Toutes les entrées portent une colonne `source` ('manual', 'csv', plus tard
 * 'strava', 'bank:xyz'…) et un `external_id` : une intégration future pourra
 * synchroniser sans créer de doublons (contrainte UNIQUE(source, external_id)).
 */
import { z } from 'zod';
import { type DB, all, get, run, tx, newId, nowISO, todayISO, addDays, buildUpdate } from '../db/client';
import { transactionInput, workoutInput, habitInput, habitPatch, metricInput, metricEntryInput } from '../../shared/schemas';
import { notFound } from '../lib/errors';
import { emitEvent } from '../events';
import { logActivity, type Actor } from './activity';

// ─── Finances ────────────────────────────────────────────────────────────────

export interface Transaction { id: string; date: string; amount: number; category: string; label: string; source: string; external_id: string | null; created_at: string }

export function listTransactions(db: DB, opts: { from?: string; to?: string; limit?: number } = {}): Transaction[] {
  return all<Transaction>(
    db,
    `SELECT * FROM transactions WHERE date >= :from AND date <= :to ORDER BY date DESC, created_at DESC LIMIT :limit`,
    { from: opts.from ?? '0000-01-01', to: opts.to ?? '9999-12-31', limit: opts.limit ?? 500 },
  );
}

export function createTransaction(db: DB, input: z.input<typeof transactionInput>, actor: Actor = 'user', source = 'manual', externalId: string | null = null): Transaction {
  const d = transactionInput.parse(input);
  const id = newId('trx');
  run(db, 'INSERT INTO transactions (id, date, amount, category, label, source, external_id, created_at) VALUES (:id, :date, :amount, :category, :label, :source, :external_id, :now)', {
    id, ...d, source, external_id: externalId, now: nowISO(),
  });
  const t = get<Transaction>(db, 'SELECT * FROM transactions WHERE id = :id', { id })!;
  if (source === 'manual') {
    logActivity(db, { kind: 'transaction.logged', title: `${d.amount > 0 ? 'Revenu' : 'Dépense'} : ${d.label || d.category}`, detail: `${d.amount > 0 ? '+' : ''}${d.amount.toFixed(2)}`, actor });
    emitEvent('transaction.logged', { transaction: t });
  }
  return t;
}

export function deleteTransaction(db: DB, id: string) {
  run(db, 'DELETE FROM transactions WHERE id = :id', { id });
}

const monthKey = (iso: string) => iso.slice(0, 7);
function monthsBack(n: number): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

export function financeSummary(db: DB, months = 6) {
  const keys = monthsBack(months);
  const rows = all<{ month: string; income: number; expense: number }>(
    db,
    `SELECT substr(date, 1, 7) AS month,
            sum(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS income,
            sum(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS expense
     FROM transactions WHERE date >= :from GROUP BY month`,
    { from: `${keys[0]}-01` },
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const series = keys.map((m) => {
    const r = byMonth.get(m);
    const income = r?.income ?? 0;
    const expense = r?.expense ?? 0;
    return { month: m, income, expense, net: income - expense };
  });
  const current = monthKey(todayISO());
  const categories = all<{ category: string; total: number }>(
    db,
    `SELECT category, sum(-amount) AS total FROM transactions WHERE amount < 0 AND substr(date, 1, 7) = :m GROUP BY category ORDER BY total DESC`,
    { m: current },
  );
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  const savingsRate = cur && cur.income > 0 ? (cur.income - cur.expense) / cur.income : null;
  const { balance } = get<{ balance: number }>(db, 'SELECT coalesce(sum(amount), 0) AS balance FROM transactions')!;
  return { series, categories, current: cur, previous: prev ?? null, savingsRate, balance };
}

// ─── Sport ───────────────────────────────────────────────────────────────────

export interface Workout { id: string; date: string; type: string; duration_min: number; distance_km: number | null; intensity: number; notes: string; source: string; created_at: string }

export function listWorkouts(db: DB, opts: { from?: string; limit?: number } = {}): Workout[] {
  return all<Workout>(db, 'SELECT * FROM workouts WHERE date >= :from ORDER BY date DESC, created_at DESC LIMIT :limit', {
    from: opts.from ?? '0000-01-01',
    limit: opts.limit ?? 300,
  });
}

export function createWorkout(db: DB, input: z.input<typeof workoutInput>, actor: Actor = 'user', source = 'manual', externalId: string | null = null, opts: { silent?: boolean } = {}): Workout {
  const d = workoutInput.parse(input);
  const id = newId('wkt');
  run(db, 'INSERT INTO workouts (id, date, type, duration_min, distance_km, intensity, notes, source, external_id, created_at) VALUES (:id, :date, :type, :duration_min, :distance_km, :intensity, :notes, :source, :external_id, :now)', {
    id, ...d, distance_km: d.distance_km ?? null, source, external_id: externalId, now: nowISO(),
  });
  const w = get<Workout>(db, 'SELECT * FROM workouts WHERE id = :id', { id })!;
  // Import en masse (Strava, Menhir…) : pas une ligne d'activité par séance, un résumé suffit.
  if (opts.silent) return w;
  logActivity(db, { kind: 'workout.logged', title: `Séance : ${d.type} · ${Math.round(d.duration_min)} min`, detail: d.distance_km ? `${d.distance_km} km` : '', actor });
  emitEvent('workout.logged', { workout: w });
  return w;
}

export function deleteWorkout(db: DB, id: string) {
  run(db, 'DELETE FROM workouts WHERE id = :id', { id });
}

/** Lundi de la semaine d'une date ISO. */
export function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const offset = (date.getDay() + 6) % 7;
  return addDays(iso, -offset);
}

export function sportSummary(db: DB, weeks = 12) {
  const thisWeek = weekStart(todayISO());
  const keys = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - 1 - i)));
  const rows = listWorkouts(db, { from: keys[0], limit: 10000 });
  const series = keys.map((wk) => {
    const inWeek = rows.filter((r) => weekStart(r.date) === wk);
    return {
      week: wk,
      sessions: inWeek.length,
      minutes: inWeek.reduce((s, r) => s + r.duration_min, 0),
      distance: inWeek.reduce((s, r) => s + (r.distance_km ?? 0), 0),
      load: inWeek.reduce((s, r) => s + r.duration_min * r.intensity, 0),
    };
  });
  const byType = all<{ type: string; sessions: number; minutes: number }>(
    db,
    'SELECT type, count(*) AS sessions, sum(duration_min) AS minutes FROM workouts WHERE date >= :from GROUP BY type ORDER BY minutes DESC',
    { from: addDays(todayISO(), -30) },
  );
  // Série de semaines consécutives avec au moins une séance (en partant de la semaine en cours ou précédente).
  let weekStreak = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].sessions > 0) weekStreak++;
    else if (i === series.length - 1) continue; // la semaine en cours peut être vide pour l'instant
    else break;
  }
  return { series, byType, weekStreak, current: series[series.length - 1] };
}

// ─── Habitudes ───────────────────────────────────────────────────────────────

export interface Habit { id: string; name: string; target_per_week: number; color: string; archived: number; created_at: string }
export interface HabitWithStats extends Habit { checks: string[]; streak: number; week_count: number; rate_30d: number; done_today: boolean }

/** Série de jours consécutifs cochés, aujourd'hui inclus s'il est coché, sinon à partir d'hier. */
export function computeStreak(checks: Set<string>, today: string): number {
  let day = checks.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (checks.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export function listHabits(db: DB, days = 120): HabitWithStats[] {
  const today = todayISO();
  const from = addDays(today, -days);
  const habits = all<Habit>(db, 'SELECT * FROM habits WHERE archived = 0 ORDER BY created_at');
  const checks = all<{ habit_id: string; date: string }>(db, 'SELECT habit_id, date FROM habit_checks WHERE date >= :from', { from });
  const wk = weekStart(today);
  return habits.map((h) => {
    const mine = checks.filter((c) => c.habit_id === h.id).map((c) => c.date).sort();
    const set = new Set(mine);
    const last30 = mine.filter((d) => d > addDays(today, -30)).length;
    return {
      ...h,
      checks: mine,
      streak: computeStreak(set, today),
      week_count: mine.filter((d) => d >= wk).length,
      rate_30d: last30 / 30,
      done_today: set.has(today),
    };
  });
}

export function createHabit(db: DB, input: z.input<typeof habitInput>, actor: Actor = 'user'): Habit {
  const d = habitInput.parse(input);
  const id = newId('hab');
  const now = nowISO();
  run(db, 'INSERT INTO habits (id, name, target_per_week, color, created_at, updated_at) VALUES (:id, :name, :target_per_week, :color, :now, :now)', { id, ...d, now });
  logActivity(db, { kind: 'habit.created', title: `Nouvelle habitude : ${d.name}`, actor });
  return get<Habit>(db, 'SELECT * FROM habits WHERE id = :id', { id })!;
}

export function updateHabit(db: DB, id: string, patch: z.input<typeof habitPatch>): Habit {
  const q = buildUpdate('habits', id, habitPatch.parse(patch), ['name', 'target_per_week', 'color', 'archived']);
  if (q) run(db, q.sql, q.params);
  const h = get<Habit>(db, 'SELECT * FROM habits WHERE id = :id', { id });
  if (!h) throw notFound('Habitude');
  return h;
}

export function deleteHabit(db: DB, id: string) {
  run(db, 'DELETE FROM habits WHERE id = :id', { id });
}

/** Coche ou décoche une habitude pour un jour donné. Renvoie le nouvel état. */
export function setHabitCheck(db: DB, habitId: string, date: string, done: boolean, actor: Actor = 'user'): boolean {
  const h = get<Habit>(db, 'SELECT * FROM habits WHERE id = :id', { id: habitId });
  if (!h) throw notFound('Habitude');
  if (done) {
    const r = run(db, 'INSERT OR IGNORE INTO habit_checks (habit_id, date) VALUES (:habitId, :date)', { habitId, date });
    if (r.changes > 0 && date === todayISO()) logActivity(db, { kind: 'habit.checked', title: `Habitude tenue : ${h.name}`, actor });
  } else {
    run(db, 'DELETE FROM habit_checks WHERE habit_id = :habitId AND date = :date', { habitId, date });
  }
  return done;
}

// ─── Métriques libres (poids, sommeil, heures de focus…) ─────────────────────

export interface Metric { id: string; name: string; unit: string; category: string; target: number | null; direction: 'up' | 'down'; color: string; created_at: string }
export interface MetricEntry { id: string; metric_id: string; date: string; value: number; note: string; source: string }

export function listMetrics(db: DB, days = 90) {
  const from = addDays(todayISO(), -days);
  const metrics = all<Metric>(db, 'SELECT * FROM metrics ORDER BY created_at');
  const entries = all<MetricEntry>(db, 'SELECT * FROM metric_entries WHERE date >= :from ORDER BY date ASC, created_at ASC', { from });
  return metrics.map((m) => {
    const mine = entries.filter((e) => e.metric_id === m.id);
    const last = mine[mine.length - 1] ?? null;
    const first = mine[0] ?? null;
    return { ...m, entries: mine, last, delta: last && first ? last.value - first.value : null };
  });
}

export function createMetric(db: DB, input: z.input<typeof metricInput>): Metric {
  const d = metricInput.parse(input);
  const id = newId('met');
  const now = nowISO();
  run(db, 'INSERT INTO metrics (id, name, unit, category, target, direction, color, created_at, updated_at) VALUES (:id, :name, :unit, :category, :target, :direction, :color, :now, :now)', {
    id, ...d, target: d.target ?? null, now,
  });
  return get<Metric>(db, 'SELECT * FROM metrics WHERE id = :id', { id })!;
}

export function deleteMetric(db: DB, id: string) {
  run(db, 'DELETE FROM metrics WHERE id = :id', { id });
}

export function addMetricEntry(db: DB, metricId: string, input: z.input<typeof metricEntryInput>, actor: Actor = 'user', source = 'manual'): MetricEntry {
  const m = get<Metric>(db, 'SELECT * FROM metrics WHERE id = :id', { id: metricId });
  if (!m) throw notFound('Métrique');
  const d = metricEntryInput.parse(input);
  const id = newId('mte');
  run(db, 'INSERT INTO metric_entries (id, metric_id, date, value, note, source, created_at) VALUES (:id, :metricId, :date, :value, :note, :source, :now)', {
    id, metricId, ...d, source, now: nowISO(),
  });
  logActivity(db, { kind: 'metric.logged', title: `${m.name} : ${d.value}${m.unit ? ' ' + m.unit : ''}`, actor });
  return get<MetricEntry>(db, 'SELECT * FROM metric_entries WHERE id = :id', { id })!;
}

export function deleteMetricEntry(db: DB, id: string) {
  run(db, 'DELETE FROM metric_entries WHERE id = :id', { id });
}

// ─── Import CSV (première « intégration » réelle : relevés bancaires) ────────

/** Parseur CSV minimal mais correct (guillemets, séparateur échappé, retours ligne). */
export function parseCSV(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = delimiter ?? ([';', '\t', ','].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** « 1 234,56 », « -12.5 », « 1,234.56 € » → nombre. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d,.\-+]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(raw: string, format: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'): string | null {
  const s = raw.trim();
  let y: string, m: string, d: string;
  if (format === 'YYYY-MM-DD') {
    const r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!r) return null;
    [, y, m, d] = r;
  } else {
    const r = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
    if (!r) return null;
    [, d, m, y] = r;
    if (format === 'MM/DD/YYYY') [d, m] = [m, d];
    if (y.length === 2) y = `20${y}`;
  }
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00`);
  return Number.isNaN(dt.getTime()) || Number(m) > 12 || Number(d) > 31 ? null : iso;
}

export interface CsvImportOptions {
  csv: string;
  delimiter?: string;
  columns: { date: string; amount: string; label?: string; category?: string };
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  invertSign: boolean;
}

export function importTransactionsCSV(db: DB, opts: CsvImportOptions) {
  const rows = parseCSV(opts.csv, opts.delimiter);
  if (rows.length < 2) return { imported: 0, skipped: 0, duplicates: 0, errors: ['Le fichier ne contient pas de données'] };
  const header = rows[0].map((h) => h.trim());
  const idx = (name?: string) => (name ? header.findIndex((h) => h === name) : -1);
  const iDate = idx(opts.columns.date);
  const iAmount = idx(opts.columns.amount);
  const iLabel = idx(opts.columns.label);
  const iCat = idx(opts.columns.category);
  if (iDate < 0 || iAmount < 0) return { imported: 0, skipped: 0, duplicates: 0, errors: ['Colonnes date / montant introuvables dans l’en-tête'] };

  let imported = 0, skipped = 0, duplicates = 0;
  const errors: string[] = [];
  const seen = new Map<string, number>();
  tx(db, () => {
    rows.slice(1).forEach((r, n) => {
      const date = parseDate(r[iDate] ?? '', opts.dateFormat);
      let amount = parseAmount(r[iAmount] ?? '');
      if (!date || amount === null || amount === 0) {
        skipped++;
        if (errors.length < 5) errors.push(`Ligne ${n + 2} ignorée (date ou montant illisible)`);
        return;
      }
      if (opts.invertSign) amount = -amount;
      const label = iLabel >= 0 ? (r[iLabel] ?? '').trim().slice(0, 200) : '';
      const category = iCat >= 0 && r[iCat]?.trim() ? r[iCat].trim().slice(0, 60) : 'Import';
      // Empreinte stable (date|montant|libellé|n° d'occurrence) : réimporter un relevé,
      // même partiellement chevauchant, ne crée pas de doublons.
      const base = `${date}|${amount.toFixed(2)}|${label}`;
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      const externalId = `${base}|${occurrence}`;
      const exists = get(db, "SELECT 1 FROM transactions WHERE source = 'csv' AND external_id = :e", { e: externalId });
      if (exists) return void duplicates++;
      createTransaction(db, { date, amount, label, category }, 'user', 'csv', externalId);
      imported++;
    });
    if (imported > 0) logActivity(db, { kind: 'transaction.import', title: `Import bancaire : ${imported} opérations`, actor: 'user' });
  });
  return { imported, skipped, duplicates, errors };
}

// ─── Synthèse ────────────────────────────────────────────────────────────────

export function analyticsDashboard(db: DB) {
  return {
    finance: financeSummary(db, 6),
    sport: sportSummary(db, 12),
    habits: listHabits(db, 120),
    metrics: listMetrics(db, 90),
  };
}
