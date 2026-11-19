/**
 * Synchronisation Strava (API v3, OAuth 2).
 *
 * Mise en place (une fois, par l'utilisateur) : créer une « application API » sur
 * https://www.strava.com/settings/api avec « Authorization Callback Domain » = localhost,
 * puis saisir Client ID et Client Secret dans NEXUS. NEXUS ouvre ensuite la page
 * d'autorisation Strava ; au retour, il échange le code contre des jetons, stockés
 * dans data/secrets.json (jamais renvoyés à l'interface).
 *
 * Synchro : nouvelles activités depuis la dernière fois (180 jours au premier passage),
 * automatiquement toutes les heures et à la demande. Lecture seule (scope activity:read_all).
 */
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/client';

import { logActivity } from '../repos/activity';
import type { SecretStore } from '../ai/secrets';
import { importWorkout, intensityFromHeartRate, getState, setState, clearState, addTotals, fetchJson, IntegrationError, type WorkoutType } from './common';

const STRAVA = 'https://www.strava.com';
const ID = 'strava';

export interface StravaDeps {
  db: DB;
  secrets: SecretStore;
  fetch?: typeof fetch;
}

interface StravaApp { clientId: string; clientSecret: string }
interface StravaTokens { access_token: string; refresh_token: string; expires_at: number; athlete?: { id: number; firstname?: string; lastname?: string } }

export interface StravaActivity {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date_local: string;
  moving_time: number;
  elapsed_time?: number;
  distance: number;
  average_heartrate?: number;
  total_elevation_gain?: number;
}

/** Types Strava → types NEXUS. */
export function mapStravaType(t: string): WorkoutType {
  if (/Run/i.test(t)) return 'run';
  if (/Ride|Velomobile|Handcycle/i.test(t)) return 'bike';
  if (/Swim/i.test(t)) return 'swim';
  if (/WeightTraining|Workout|Crossfit/i.test(t)) return /Crossfit/i.test(t) ? 'hiit' : 'strength';
  if (/HighIntensity|HIIT/i.test(t)) return 'hiit';
  if (/Walk|Hike/i.test(t)) return 'walk';
  if (/Yoga|Pilates/i.test(t)) return 'yoga';
  if (/Soccer|Tennis|Badminton|Basketball|Squash|Volleyball|Padel|Pickleball|Golf|Climbing|Ski|Snowboard|Rowing|Kayak|Surf/i.test(t)) return 'sport';
  return 'other';
}

export function activityToWorkout(a: StravaActivity) {
  return {
    date: a.start_date_local.slice(0, 10), // heure locale de l'activité
    type: mapStravaType(a.sport_type ?? a.type ?? ''),
    duration_min: (a.moving_time || a.elapsed_time || 0) / 60,
    distance_km: a.distance > 0 ? a.distance / 1000 : null,
    intensity: intensityFromHeartRate(a.average_heartrate),
    notes: `${a.name}${a.total_elevation_gain ? ` · D+ ${Math.round(a.total_elevation_gain)} m` : ''} (Strava)`,
  };
}

// ─── Configuration et connexion ──────────────────────────────────────────────

export function getApp(secrets: SecretStore): StravaApp | null {
  return secrets.getSecret<StravaApp>('strava.app');
}

export function setApp(secrets: SecretStore, app: StravaApp) {
  secrets.setSecret('strava.app', app);
}

/** États OAuth en attente (protection contre les retours d'autorisation forgés). */
const pendingStates = new Map<string, number>();

export function authorizeUrl(secrets: SecretStore, redirectUri: string): string {
  const app = getApp(secrets);
  if (!app) throw new IntegrationError('Renseigne d’abord le Client ID et le Client Secret de ton application Strava.', 'config');
  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri, response_type: 'code', approval_prompt: 'auto', scope: 'read,activity:read_all', state });
  return `${STRAVA}/oauth/authorize?${q}`;
}

export function consumeState(state: string | undefined): boolean {
  if (!state) return false;
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return exp !== undefined && exp > Date.now();
}

async function tokenRequest(d: StravaDeps, params: Record<string, string>): Promise<StravaTokens> {
  const app = getApp(d.secrets);
  if (!app) throw new IntegrationError('Application Strava non configurée.', 'config');
  return fetchJson<StravaTokens>(
    d.fetch ?? fetch,
    `${STRAVA}/oauth/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...params }) },
    'Strava',
  );
}

/** Échange le code d'autorisation contre des jetons. */
export async function exchangeCode(d: StravaDeps, code: string): Promise<StravaTokens> {
  const t = await tokenRequest(d, { code, grant_type: 'authorization_code' });
  d.secrets.setSecret('strava.tokens', t);
  setState(d.db, ID, { athlete: t.athlete ? [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(' ') : null, connectedAt: new Date().toISOString(), lastError: null });
  return t;
}

/** Jeton d'accès valide (renouvelé automatiquement : il expire toutes les 6 h). */
async function accessToken(d: StravaDeps): Promise<string> {
  const t = d.secrets.getSecret<StravaTokens>('strava.tokens');
  if (!t) throw new IntegrationError('Strava n’est pas connecté.', 'config');
  if (t.expires_at - 120 > Date.now() / 1000) return t.access_token;
  const fresh = await tokenRequest(d, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
  d.secrets.setSecret('strava.tokens', { ...t, ...fresh });
  return fresh.access_token;
}

export function isConnected(secrets: SecretStore): boolean {
  return Boolean(secrets.getSecret('strava.tokens'));
}

export async function disconnect(d: StravaDeps) {
  const t = d.secrets.getSecret<StravaTokens>('strava.tokens');
  if (t) {
    // Révoque l'accès côté Strava (au mieux) ; les séances déjà importées restent dans NEXUS.
    await fetchJson(d.fetch ?? fetch, `${STRAVA}/oauth/deauthorize`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ access_token: t.access_token }) }, 'Strava').catch(() => {});
  }
  d.secrets.deleteSecret('strava.tokens');
  clearState(d.db, ID);
}

// ─── Synchronisation ─────────────────────────────────────────────────────────

export async function syncStrava(d: StravaDeps): Promise<Record<string, number>> {
  const state = getState(d.db, ID);
  try {
    const token = await accessToken(d);
    // Reprend un peu avant la dernière activité vue (modifications tardives), sinon 180 jours.
    const after = typeof state.lastActivityEpoch === 'number' ? state.lastActivityEpoch - 2 * 86400 : Math.floor(Date.now() / 1000) - 180 * 86400;
    const counts = { added: 0, known: 0, similar: 0 };
    let newest = typeof state.lastActivityEpoch === 'number' ? state.lastActivityEpoch : 0;
    for (let page = 1; page <= 20; page++) {
      const list = await fetchJson<StravaActivity[]>(d.fetch ?? fetch, `${STRAVA}/api/v3/athlete/activities?after=${after}&page=${page}&per_page=100`, { headers: { Authorization: `Bearer ${token}` } }, 'Strava');
      for (const a of list) {
        counts[importWorkout(d.db, activityToWorkout(a), 'strava', String(a.id))]++;
        const epoch = Math.floor(new Date(a.start_date_local).getTime() / 1000);
        if (epoch > newest) newest = epoch;
      }
      if (list.length < 100) break;
    }
    setState(d.db, ID, { lastSyncAt: new Date().toISOString(), lastError: null, lastResult: counts, totals: addTotals(state.totals, counts), lastActivityEpoch: newest || undefined });
    if (counts.added > 0) logActivity(d.db, { kind: 'integration.sync', title: `Strava : ${counts.added} séance${counts.added > 1 ? 's' : ''} importée${counts.added > 1 ? 's' : ''}`, actor: 'system' });
    return counts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setState(d.db, ID, { lastError: message, lastErrorAt: new Date().toISOString() });
    throw err;
  }
}

export function stravaStatus(d: StravaDeps) {
  const s = getState(d.db, ID);
  return {
    appConfigured: Boolean(getApp(d.secrets)),
    connected: isConnected(d.secrets),
    athlete: (s.athlete as string | null) ?? null,
    lastSyncAt: s.lastSyncAt ?? null,
    lastResult: s.lastResult ?? null,
    totals: s.totals ?? null,
    lastError: s.lastError ?? null,
  };
}
