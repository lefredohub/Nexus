/**
 * Intégrations Strava, Menhir et Apple Santé — avec de faux serveurs (aucun appel réel).
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { testDb, testSecrets, tempDir } from './helpers';
import { createApp } from '../server/app';
import { PairingManager } from '../server/auth';
import * as strava from '../server/integrations/strava';
import * as menhir from '../server/integrations/menhir';
import { importWorkout, isSameSession, setDailyValue } from '../server/integrations/common';
import { listWorkouts, listMetrics, createMetric } from '../server/repos/analytics';
import { listActivity } from '../server/repos/activity';

type Handler = (url: URL, init: RequestInit & { bodyText: string }) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit & { bodyText: string } }[] = [];
  const f = (async (u: string, init: RequestInit = {}) => {
    const url = new URL(u);
    const bodyText = init.body === undefined ? '' : String(init.body);
    calls.push({ url, init: { ...init, bodyText } });
    return handler(url, { ...init, bodyText });
  }) as unknown as typeof fetch;
  return { f, calls };
}

// ─── Anti-doublons ───────────────────────────────────────────────────────────

describe('import sans doublons entre sources', () => {
  it('reconnaît la même séance venue d’une autre source', () => {
    const db = testDb();
    const run = { date: '2026-11-18', type: 'run' as const, duration_min: 42, distance_km: 8.1 };
    expect(importWorkout(db, run, 'strava', '1')).toBe('added');
    expect(importWorkout(db, run, 'strava', '1')).toBe('known');
    expect(importWorkout(db, { ...run, duration_min: 43, distance_km: 8.05 }, 'menhir', 'run:a')).toBe('similar');
    expect(importWorkout(db, { ...run, duration_min: 70, distance_km: 14 }, 'menhir', 'run:b')).toBe('added'); // deuxième sortie du jour
    expect(listWorkouts(db)).toHaveLength(2);
    expect(isSameSession({ type: 'run', duration_min: 30, distance_km: 5 }, { ...run, type: 'bike', duration_min: 30, distance_km: 5 })).toBe(false);
  });
});

// ─── Strava ──────────────────────────────────────────────────────────────────

const act = (id: number, day: string, type: string, min: number, km: number, hr?: number) => ({ id, name: `Act ${id}`, sport_type: type, start_date_local: `${day}T07:00:00Z`, moving_time: min * 60, distance: km * 1000, average_heartrate: hr, total_elevation_gain: 50 });

function fakeStrava(pages: unknown[][]) {
  return fakeFetch(async (url, init) => {
    if (url.pathname === '/oauth/token') {
      const p = new URLSearchParams(init.bodyText);
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'bon-code') return Response.json({ access_token: 'acc1', refresh_token: 'ref1', expires_at: Math.floor(Date.now() / 1000) - 10, athlete: { id: 7, firstname: 'Alex', lastname: 'D' } });
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'ref1') return Response.json({ access_token: 'acc2', refresh_token: 'ref2', expires_at: Math.floor(Date.now() / 1000) + 21600 });
      return Response.json({ message: 'Bad Request' }, { status: 400 });
    }
    if (url.pathname === '/api/v3/athlete/activities') {
      if (init.headers && (init.headers as Record<string, string>).Authorization !== 'Bearer acc2') return Response.json({ message: 'Authorization Error' }, { status: 401 });
      return Response.json(pages[Number(url.searchParams.get('page')) - 1] ?? []);
    }
    if (url.pathname === '/oauth/deauthorize') return Response.json({});
    return new Response('?', { status: 404 });
  });
}

describe('Strava', () => {
  it('construit l’URL d’autorisation avec un état anti-falsification', () => {
    const secrets = testSecrets();
    expect(() => strava.authorizeUrl(secrets, 'http://localhost:4317/cb')).toThrow(/Client ID/);
    strava.setApp(secrets, { clientId: '12345', clientSecret: 'a'.repeat(40) });
    const u = new URL(strava.authorizeUrl(secrets, 'http://localhost:4317/cb'));
    expect(u.searchParams.get('scope')).toBe('read,activity:read_all');
    const state = u.searchParams.get('state')!;
    expect(strava.consumeState('faux')).toBe(false);
    expect(strava.consumeState(state)).toBe(true);
    expect(strava.consumeState(state)).toBe(false); // usage unique
  });

  it('connecte, renouvelle le jeton expiré et importe toutes les pages', async () => {
    const db = testDb();
    const secrets = testSecrets();
    strava.setApp(secrets, { clientId: '12345', clientSecret: 'a'.repeat(40) });
    const page1 = Array.from({ length: 100 }, (_, i) => act(1000 + i, `2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, '0')}`, i % 2 ? 'Run' : 'Ride', 30 + (i % 40), 5 + (i % 30), 150));
    const { f, calls } = fakeStrava([page1, [act(2001, '2026-11-17', 'WeightTraining', 45, 0), act(2002, '2026-11-18', 'TrailRun', 80, 12, 165)]]);
    const d = { db, secrets, fetch: f };
    await strava.exchangeCode(d, 'bon-code');
    const r = await strava.syncStrava(d);
    expect(r.added + r.similar).toBe(102);
    expect(calls.filter((c) => c.url.pathname === '/api/v3/athlete/activities')).toHaveLength(2);
    expect(secrets.getSecret<{ refresh_token: string }>('strava.tokens')!.refresh_token).toBe('ref2');
    const trail = listWorkouts(db).find((w) => w.date === '2026-11-18')!;
    expect(trail).toMatchObject({ type: 'run', duration_min: 80, distance_km: 12, intensity: 5, source: 'strava' });
    expect(trail.notes).toContain('D+ 50 m');
    expect(listWorkouts(db).find((w) => w.date === '2026-11-17')!.type).toBe('strength');
    // Resynchroniser n'ajoute rien.
    const again = await strava.syncStrava(d);
    expect(again.added).toBe(0);
    expect(strava.stravaStatus(d)).toMatchObject({ connected: true, athlete: 'Alex D', lastError: null });
    expect(listActivity(db).filter((a) => a.kind === 'integration.sync')).toHaveLength(1); // un résumé, pas 102 lignes
    await strava.disconnect(d);
    expect(strava.isConnected(secrets)).toBe(false);
  });

  it('mauvais code d’autorisation : erreur claire, rien n’est stocké', async () => {
    const secrets = testSecrets();
    strava.setApp(secrets, { clientId: '12345', clientSecret: 'a'.repeat(40) });
    await expect(strava.exchangeCode({ db: testDb(), secrets, fetch: fakeStrava([]).f }, 'faux')).rejects.toThrow(/Strava/);
    expect(strava.isConnected(secrets)).toBe(false);
  });

  it('associe les types Strava aux types NEXUS', () => {
    expect(['Run', 'VirtualRun', 'GravelRide', 'Swim', 'WeightTraining', 'Hike', 'Yoga', 'Crossfit', 'Tennis', 'Kitesurf'].map(strava.mapStravaType)).toEqual(['run', 'run', 'bike', 'swim', 'strength', 'walk', 'yoga', 'hiit', 'sport', 'sport']);
  });
});

// ─── Menhir ──────────────────────────────────────────────────────────────────

function fakeMenhir(data: unknown) {
  return fakeFetch(async (url, init) => {
    if (url.pathname === '/config.js') return new Response("window.FITLOG = {\n  url: 'https://projet-test.supabase.co',\n  key: 'sb_publishable_test',\n  api: ''\n};");
    expect((init.headers as Record<string, string>).apikey).toBe('sb_publishable_test');
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const b = JSON.parse(init.bodyText);
      if (b.password !== 'secret') return Response.json({ error_description: 'Invalid login credentials' }, { status: 400 });
      return Response.json({ access_token: 'a1', refresh_token: 'r1', user: { id: 'uid-1', email: b.email } });
    }
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse(init.bodyText);
      return b.refresh_token === 'r1' || b.refresh_token === 'r2' ? Response.json({ access_token: 'a2', refresh_token: b.refresh_token === 'r1' ? 'r2' : 'r3', user: { id: 'uid-1' } }) : Response.json({ msg: 'Invalid Refresh Token' }, { status: 400 });
    }
    if (url.pathname === '/rest/v1/fitlog_data') {
      expect(url.searchParams.get('user_id')).toBe('eq.uid-1');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer a2');
      return Response.json([{ data }]);
    }
    return new Response('?', { status: 404 });
  });
}

const MENHIR_DATA = {
  runs: [
    { id: 'a1', n: 'Footing', d: '2026-11-15T08:00', km: 8.2, s: 2520, up: 60, hr: 140, t: 'Run' },
    { id: 'g2', n: 'Trail des crêtes', d: '2026-11-16T09:00', km: 15, s: 6300, up: 640, hr: 158, t: 'TrailRun' },
    { id: 'x', d: '2026-11-17T09:00', km: 0, s: 0 }, // incomplète : ignorée
    { id: 'y', d: 12345, km: 5, s: 1500 }, // abîmée (date illisible) : ignorée sans bloquer le reste
  ],
  h: [
    {
      id: 'h1', date: '2026-11-17T18:30:00.000Z', name: 'Haut du corps', dur: 55,
      ex: [
        { name: 'Développé couché', sets: [{ w: 60, r: 10, done: true }, { w: '60', r: '8', done: true }] }, // nombres saisis en texte
        { name: 'Tractions', sets: [{ w: 0, r: 8 }] },
        { name: 'Vélo', t: 'cardio', sets: [{ d: 10 }] },
        { name: 'Dips', skip: true, sets: [] }, // passé pendant la séance : ne compte pas
        { name: 'Planche lestée', m: 'sec', sets: [{ w: 10, r: 60 }] }, // en secondes : hors tonnage
      ],
    },
    {
      id: 'h2', date: '2026-11-18T18:30:00.000Z', name: 'Jambes',
      ex: [
        { name: 'Squat', sets: [{ w: 80, r: 5 }, { w: 80, r: 5 }, { w: 80, r: 5 }, { w: 80, r: 5, done: false }] }, // la 4e n'a pas été faite
        { name: 'Sled push', u: 'm', sets: [{ w: 100, r: 25 }] }, // en mètres : hors tonnage
      ],
    },
    { id: 'h3', date: '2026-11-19T18:30:00.000Z', name: 'Vide', ex: [{ name: 'Squat', skip: true, sets: [] }] }, // rien de fait : ignorée
    { date: null, name: 'Abîmée' }, // illisible : ignorée
  ],
  // ressenti du jour (Forme du jour) : sommeil, énergie, jambes, de 1 à 5
  ck: { '2026-11-17': { s: 4, e: 3, c: 2 }, '2026-11-18': { s: 5 }, '2026-11-19': { s: 9 }, 'pas-une-date': { s: 1 } },
  cs: { sante: '2026-11-01T10:00:00.000Z' }, // accord pour les données de santé donné dans Menhir
};

describe('Menhir', () => {
  it('se connecte, ne garde pas le mot de passe, importe course et muscu', async () => {
    const db = testDb();
    const secrets = testSecrets();
    const { f } = fakeMenhir(MENHIR_DATA);
    const d = { db, secrets, fetch: f };
    await expect(menhir.loginMenhir(d, 'moi@exemple.fr', 'faux')).rejects.toThrow(/mot de passe incorrect/);
    await menhir.loginMenhir(d, 'moi@exemple.fr', 'secret');
    expect(JSON.stringify(secrets.getSecret('menhir.session'))).not.toContain('secret"');
    const r = await menhir.syncMenhir(d);
    expect(r).toMatchObject({ added: 4 });
    const ws = listWorkouts(db);
    expect(ws.find((w) => w.date === '2026-11-16')).toMatchObject({ type: 'run', distance_km: 15, duration_min: 105, intensity: 4, source: 'menhir' });
    const gym = ws.find((w) => w.notes.startsWith('Haut du corps'))!;
    expect(gym).toMatchObject({ type: 'strength', duration_min: 55 });
    expect(gym.notes).toContain('1 080 kg soulevés'.replace(' ', ' ')); // 60×10 + 60×8, cardio et gainage exclus
    expect(gym.notes).toContain('4 exercices · 5 séries'); // Dips passé : pas compté
    expect(ws.find((w) => w.notes.startsWith('Jambes'))!.duration_min).toBe(15); // pas de durée : estimation
    expect(ws.some((w) => w.notes.startsWith('Vide') || w.notes.startsWith('Abîmée'))).toBe(false);
    const metrics = listMetrics(db);
    const tonnage = metrics.find((m) => m.name === 'Tonnage muscu')!;
    expect(tonnage.entries.map((e) => e.value)).toEqual([1080, 1200]);  // série non faite et traîneau (mètres) exclus
    const feel = (name: string) => metrics.find((m) => m.name === name)!.entries.map((e) => [e.date, e.value]).sort();
    expect(feel('Sommeil (ressenti)')).toEqual([['2026-11-17', 4], ['2026-11-18', 5]]); // 9 hors échelle : ignoré
    expect(feel('Énergie (ressenti)')).toEqual([['2026-11-17', 3]]);
    expect(feel('Jambes (ressenti)')).toEqual([['2026-11-17', 2]]);
    // Le jeton de renouvellement tourne à chaque synchro et resynchroniser n'ajoute rien.
    expect(secrets.getSecret<{ refresh_token: string }>('menhir.session')!.refresh_token).toBe('r2');
    expect((await menhir.syncMenhir(d)).added).toBe(0);
    expect(secrets.getSecret<{ refresh_token: string }>('menhir.session')!.refresh_token).toBe('r3');
  });
});

describe('Menhir : corrections et accord santé', () => {
  it('retire un tonnage recalculé à 0 et le ressenti quand l\'accord santé est retiré', async () => {
    const db = testDb();
    const secrets = testSecrets();
    const payload: { h: unknown[]; cs?: unknown; ck?: unknown } = structuredClone(MENHIR_DATA);
    payload.h.push({ id: 'h4', date: '2026-11-20T18:30:00.000Z', name: 'HYROX', ex: [{ name: 'Sled push', u: 'm', sets: [{ w: 100, r: 25 }] }] });
    const { f } = fakeMenhir(payload);
    const d = { db, secrets, fetch: f };
    await menhir.loginMenhir(d, 'moi@exemple.fr', 'secret');
    // valeur fausse laissée par l'ancienne version (100 kg × 25 m comptés comme des répétitions)
    setDailyValue(db, { key: 'menhir.tonnage', name: 'Tonnage muscu', unit: 'kg', direction: 'up', category: 'sport', color: '#b8851c' }, '2026-11-20', 2500, 'menhir');
    await menhir.syncMenhir(d);
    const tonnage = () => listMetrics(db).find((m) => m.name === 'Tonnage muscu')!.entries.map((e) => e.date).sort();
    expect(tonnage()).toEqual(['2026-11-17', '2026-11-18']); // le 20 a été retiré
    expect(listMetrics(db).find((m) => m.name === 'Sommeil (ressenti)')!.entries).toHaveLength(2);
    // accord retiré dans Menhir : ressenti effacé là-bas, et retiré ici
    delete payload.cs;
    delete payload.ck;
    await menhir.syncMenhir(d);
    expect(listMetrics(db).find((m) => m.name === 'Sommeil (ressenti)')!.entries).toHaveLength(0);
  });
});

// ─── Apple Santé (Raccourci) via l'API ───────────────────────────────────────

describe('Apple Santé', () => {
  function setup() {
    const db = testDb();
    const deps = { db, secrets: testSecrets(), backupDir: join(tempDir(), 'b'), pairing: new PairingManager() };
    const local = createApp({ ...deps, mode: 'local' });
    const remote = createApp({ ...deps, mode: 'remote' });
    const call = (app: typeof local, path: string, init: { method?: string; body?: unknown; auth?: string; host?: string } = {}) =>
      app.request(`http://${init.host ?? '127.0.0.1:4317'}/api${path}`, {
        method: init.method ?? 'POST',
        headers: { host: init.host ?? '127.0.0.1:4317', 'content-type': 'application/json', ...(init.auth ? { authorization: init.auth } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    return { db, local, remote, call };
  }

  it('reçoit les mesures du Raccourci sur la porte iPhone, avec un jeton limité', async () => {
    const { db, local, remote, call } = setup();
    // Une métrique « Sommeil » créée à la main avant : elle est réutilisée, pas dupliquée.
    createMetric(db, { name: 'Sommeil', unit: 'h' });
    const res = await call(local, '/integrations/health/tokens', { body: { name: 'iPhone' } });
    const { token } = (await res.json()) as { token: string };
    expect(token).toMatch(/^nxs_/);

    const host = 'mon-mac.tail1234.ts.net';
    const payload = { date: '2026-11-18', steps: '7 856', sleep_hours: '7,25', weight_kg: '72,4 kg', resting_hr: 54, active_kcal: '', workouts: [{ type: 'Course à pied', start: '2026-11-18T07:00:00+01:00', duration_min: '42', distance_km: '8,1' }] };
    expect((await call(remote, '/ingest/health', { body: payload, host })).status).toBe(401);
    expect((await call(remote, '/ingest/health', { body: payload, host, auth: 'Bearer nxs_faux_jeton_faux_jeton_faux' })).status).toBe(401);
    const ok = await call(remote, '/ingest/health', { body: payload, host, auth: `Bearer ${token}` });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ date: '2026-11-18', saved: ['steps', 'sleep', 'weight', 'resting_hr'], workouts: { added: 1 } });
    // Renvoyer le même jour remplace (pas de doublon).
    await call(remote, '/ingest/health', { body: { ...payload, steps: 9000 }, host, auth: `Bearer ${token}` });
    const metrics = listMetrics(db);
    expect(metrics.filter((m) => m.name === 'Sommeil')).toHaveLength(1);
    expect(metrics.find((m) => m.name === 'Pas')!.entries.map((e) => e.value)).toEqual([9000]);
    expect(metrics.find((m) => m.name === 'Poids')!.last!.value).toBe(72.4);
    expect(listWorkouts(db)).toHaveLength(1);
    // Le jeton n'ouvre rien d'autre.
    expect((await call(remote, '/overview', { method: 'GET', host, auth: `Bearer ${token}` })).status).toBe(401);
  });

  it('un jeton révoqué ne fonctionne plus, et les jetons ne se gèrent que depuis le Mac', async () => {
    const { local, remote, call } = setup();
    const { token, info } = (await (await call(local, '/integrations/health/tokens', { body: {} })).json()) as { token: string; info: { id: string } };
    await call(local, `/integrations/health/tokens/${info.id}`, { method: 'DELETE' });
    expect((await call(remote, '/ingest/health', { body: { steps: 1 }, host: 'x.ts.net', auth: `Bearer ${token}` })).status).toBe(401);
    expect((await call(remote, '/integrations/health/tokens', { body: {}, host: 'x.ts.net' })).status).toBe(401); // pas appairé
  });
});

describe('Strava : adresse de retour', () => {
  it('renvoie toujours vers localhost, le domaine déclaré chez Strava', async () => {
    const secrets = testSecrets();
    strava.setApp(secrets, { clientId: '12345', clientSecret: 'a'.repeat(40) });
    const app = createApp({ db: testDb(), secrets, mode: 'local' });
    const res = await app.request('http://127.0.0.1:4317/api/integrations/strava/connect', { headers: { host: '127.0.0.1:4317' } });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe('http://localhost:4317/api/integrations/strava/callback');
  });
});
