/**
 * Synchronisation avec Menhir (ex-FitLog), ton carnet course + musculation.
 *
 * Menhir sauvegarde toutes ses données dans Supabase (table `fitlog_data`, une
 * ligne JSON par compte, protégée par ton identifiant). NEXUS se connecte avec ton
 * compte Menhir et LIT cette ligne : il ne modifie jamais rien dans Menhir.
 *
 * Le mot de passe sert une seule fois, à la connexion : NEXUS ne garde que le
 * jeton de renouvellement (renouvelé à chaque synchro), dans data/secrets.json.
 *
 * Ce qui est importé :
 *  - les sorties de course (`runs`) : date, durée, distance, D+, fréquence cardiaque ;
 *  - les séances de musculation (`h`) : durée, exercices, séries, tonnage
 *    (et une métrique « Tonnage muscu » par jour).
 */
import type { DB } from '../db/client';
import { todayISO } from '../db/client';
import { logActivity } from '../repos/activity';
import type { SecretStore } from '../ai/secrets';
import { importWorkout, intensityFromHeartRate, setDailyValue, getState, setState, clearState, addTotals, fetchJson, IntegrationError, type MetricSpec } from './common';

const ID = 'menhir';
/** Adresse de l'app Menhir : on y lit config.js (adresse Supabase + clé publique). */
export const MENHIR_APP_URL = (process.env.MENHIR_APP_URL ?? 'https://menhir.rk8h5294kt.workers.dev').replace(/\/$/, '');
/** Valeurs de config.js de Menhir (publiques par conception), si l'app est injoignable. */
const FALLBACK = { url: 'https://ykhxasrheernozkzlevr.supabase.co', key: 'sb_publishable_tMYkEfgKO7Kj51GzKnv-Ag_SXe6z3HE' };

export interface MenhirDeps {
  db: DB;
  secrets: SecretStore;
  fetch?: typeof fetch;
}

interface Session { url: string; key: string; refresh_token: string; user_id: string; email: string }
interface AuthResponse { access_token: string; refresh_token: string; user?: { id: string; email?: string } }

/** Une sortie de course telle que Menhir la stocke. */
export interface MenhirRun { id?: string | number; n?: string; d: string; km?: number; s?: number; up?: number; hr?: number | null; t?: string }
/** Une séance de musculation telle que Menhir la stocke. */
export interface MenhirSession { date: string; name?: string; dur?: number; ex?: { name: string; t?: string; sets?: { w?: number; r?: number; d?: number }[] }[] }

const TONNAGE: MetricSpec = { key: 'menhir.tonnage', name: 'Tonnage muscu', unit: 'kg', direction: 'up', category: 'sport', color: '#b8851c' };

/** Lit l'adresse Supabase et la clé publique dans le config.js de Menhir. */
export async function menhirConfig(f: typeof fetch): Promise<{ url: string; key: string }> {
  try {
    const res = await f(`${MENHIR_APP_URL}/config.js`, { signal: AbortSignal.timeout(8000) });
    const js = await res.text();
    const url = js.match(/url:\s*['"]([^'"]+)['"]/)?.[1];
    const key = js.match(/key:\s*['"]([^'"]+)['"]/)?.[1];
    if (res.ok && url && key) return { url: url.replace(/\/$/, ''), key };
  } catch {
    /* app injoignable : valeurs connues */
  }
  return FALLBACK;
}

const sb = (cfg: { url: string; key: string }, path: string, init: RequestInit = {}, token?: string): [string, RequestInit] => [
  `${cfg.url}${path}`,
  { ...init, headers: { apikey: cfg.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } },
];

/** Connexion avec le compte Menhir (e-mail + mot de passe, utilisés une seule fois). */
export async function loginMenhir(d: MenhirDeps, email: string, password: string): Promise<{ email: string }> {
  const f = d.fetch ?? fetch;
  const cfg = await menhirConfig(f);
  const auth = await fetchJson<AuthResponse>(f, ...sb(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }), 'Menhir').catch((err) => {
    if (err instanceof IntegrationError && err.kind === 'auth') throw new IntegrationError('Menhir : e-mail ou mot de passe incorrect.', 'auth');
    throw err;
  });
  if (!auth.user?.id) throw new IntegrationError('Menhir : réponse de connexion inattendue.', 'api');
  d.secrets.setSecret('menhir.session', { ...cfg, refresh_token: auth.refresh_token, user_id: auth.user.id, email: auth.user.email ?? email } satisfies Session);
  setState(d.db, ID, { email: auth.user.email ?? email, connectedAt: new Date().toISOString(), lastError: null });
  return { email: auth.user.email ?? email };
}

/** Nouveau jeton d'accès. Supabase renouvelle aussi le jeton de renouvellement : on le sauvegarde. */
async function accessToken(d: MenhirDeps): Promise<{ token: string; session: Session }> {
  const s = d.secrets.getSecret<Session>('menhir.session');
  if (!s) throw new IntegrationError('Menhir n’est pas connecté.', 'config');
  const auth = await fetchJson<AuthResponse>(d.fetch ?? fetch, ...sb(s, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) }), 'Menhir').catch((err) => {
    if (err instanceof IntegrationError && err.kind === 'auth') throw new IntegrationError('Menhir : la connexion a expiré. Reconnecte ton compte.', 'auth');
    throw err;
  });
  const session = { ...s, refresh_token: auth.refresh_token };
  d.secrets.setSecret('menhir.session', session);
  return { token: auth.access_token, session };
}

export function isConnected(secrets: SecretStore): boolean {
  return Boolean(secrets.getSecret('menhir.session'));
}

export function disconnect(d: MenhirDeps) {
  d.secrets.deleteSecret('menhir.session');
  clearState(d.db, ID);
}

// ─── Conversion ──────────────────────────────────────────────────────────────

export function runToWorkout(r: MenhirRun) {
  return {
    date: String(r.d).slice(0, 10),
    type: 'run' as const,
    duration_min: (r.s ?? 0) / 60,
    distance_km: r.km && r.km > 0 ? r.km : null,
    intensity: intensityFromHeartRate(r.hr),
    notes: `${r.n || (r.t === 'TrailRun' ? 'Trail' : 'Course')}${r.up ? ` · D+ ${Math.round(r.up)} m` : ''} (Menhir)`,
  };
}

/** Résumé d'une séance de muscu : exercices, séries, tonnage (charge × répétitions). */
export function sessionSummary(h: MenhirSession) {
  const ex = h.ex ?? [];
  let sets = 0;
  let tonnage = 0;
  for (const e of ex) {
    for (const s of e.sets ?? []) {
      sets++;
      if (e.t !== 'cardio') tonnage += (s.w ?? 0) * (s.r ?? 0);
    }
  }
  return { exercises: ex.length, sets, tonnage: Math.round(tonnage) };
}

export function sessionToWorkout(h: MenhirSession) {
  const sum = sessionSummary(h);
  return {
    date: todayISO(new Date(h.date)),
    type: 'strength' as const,
    // Durée enregistrée par Menhir, sinon estimation (~2,5 min par série, repos compris).
    duration_min: h.dur && h.dur > 0 ? h.dur : Math.max(15, Math.round(sum.sets * 2.5)),
    distance_km: null,
    intensity: 3,
    notes: `${h.name || 'Musculation'} · ${sum.exercises} exercice${sum.exercises > 1 ? 's' : ''} · ${sum.sets} séries${sum.tonnage ? ` · ${sum.tonnage.toLocaleString('fr-FR')} kg soulevés` : ''} (Menhir)`,
  };
}

// ─── Synchronisation ─────────────────────────────────────────────────────────

export async function syncMenhir(d: MenhirDeps): Promise<Record<string, number>> {
  const state = getState(d.db, ID);
  try {
    const { token, session } = await accessToken(d);
    const rows = await fetchJson<{ data: { runs?: MenhirRun[]; h?: MenhirSession[] } }[]>(
      d.fetch ?? fetch,
      ...sb(session, `/rest/v1/fitlog_data?select=data&user_id=eq.${encodeURIComponent(session.user_id)}`, {}, token),
      'Menhir',
    );
    const data = rows[0]?.data ?? {};
    const counts = { added: 0, known: 0, similar: 0 };
    for (const r of data.runs ?? []) {
      if (!r?.d || !(r.s && r.s > 0)) continue;
      counts[importWorkout(d.db, runToWorkout(r), 'menhir', `run:${r.id ?? `${r.d}|${r.km}`}`)]++;
    }
    const tonnageByDay = new Map<string, number>();
    for (const h of data.h ?? []) {
      if (!h?.date || !(h.ex ?? []).length) continue;
      const w = sessionToWorkout(h);
      counts[importWorkout(d.db, w, 'menhir', `gym:${h.date}|${h.name ?? ''}`)]++;
      const t = sessionSummary(h).tonnage;
      if (t > 0) tonnageByDay.set(w.date, (tonnageByDay.get(w.date) ?? 0) + t);
    }
    for (const [date, t] of tonnageByDay) setDailyValue(d.db, TONNAGE, date, t, 'menhir');
    setState(d.db, ID, { lastSyncAt: new Date().toISOString(), lastError: null, lastResult: counts, totals: addTotals(state.totals, counts) });
    if (counts.added > 0) logActivity(d.db, { kind: 'integration.sync', title: `Menhir : ${counts.added} séance${counts.added > 1 ? 's' : ''} importée${counts.added > 1 ? 's' : ''}`, actor: 'system' });
    return counts;
  } catch (err) {
    setState(d.db, ID, { lastError: err instanceof Error ? err.message : String(err), lastErrorAt: new Date().toISOString() });
    throw err;
  }
}

export function menhirStatus(d: MenhirDeps) {
  const s = getState(d.db, ID);
  return {
    connected: isConnected(d.secrets),
    email: (s.email as string | null) ?? null,
    lastSyncAt: s.lastSyncAt ?? null,
    lastResult: s.lastResult ?? null,
    totals: s.totals ?? null,
    lastError: s.lastError ?? null,
    appUrl: MENHIR_APP_URL,
  };
}
