/**
 * Accès depuis l'iPhone : appairage, sessions, révocation, et cloisonnement
 * des actions réservées au Mac.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { testDb, testSecrets, tempDir } from './helpers';
import { createApp } from '../server/app';
import { PairingManager, readCookie, verifySession } from '../server/auth';
import { initialContext, turnContext, VOICE_HINT } from '../server/ai/prompts';

function setup() {
  const db = testDb();
  const pairing = new PairingManager();
  const deps = { db, secrets: testSecrets(true), backupDir: join(tempDir(), 'b'), pairing };
  const local = createApp({ ...deps, mode: 'local' });
  const remote = createApp({ ...deps, mode: 'remote' });
  const HOST = 'mon-mac.tail1234.ts.net';
  const call = (app: typeof local, path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string; host?: string } = {}) =>
    app.request(`https://${init.host ?? HOST}/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        host: init.host ?? HOST,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.origin ? { origin: init.origin } : {}),
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  return { db, pairing, local, remote, call, HOST };
}

async function pair(s: ReturnType<typeof setup>) {
  const { code } = s.pairing.createCode();
  const res = await s.call(s.remote, '/auth/pair', { body: { code } });
  const cookie = res.headers.get('set-cookie')!;
  return { res, cookie: cookie.split(';')[0] };
}

describe('accès distant', () => {
  it('refuse toute donnée sans appareil appairé', async () => {
    const s = setup();
    const res = await s.call(s.remote, '/overview');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthenticated');
    expect(((await (await s.call(s.remote, '/auth/status')).json()) as { authenticated: boolean }).authenticated).toBe(false);
  });

  it('appaire un iPhone avec le code, puis le laisse accéder aux données', async () => {
    const s = setup();
    const { res, cookie } = await pair(s);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(res.headers.get('set-cookie')).toMatch(/Secure/); // servi en HTTPS (Tailscale)
    expect(((await res.json()) as { device: { name: string } }).device.name).toBe('iPhone');
    expect((await s.call(s.remote, '/overview', { cookie })).status).toBe(200);
    expect(((await (await s.call(s.remote, '/auth/status', { cookie })).json()) as { authenticated: boolean }).authenticated).toBe(true);
    // Le jeton n'est stocké qu'en empreinte.
    const token = readCookie(cookie, 'nexus_session')!;
    expect(JSON.stringify(s.db.prepare('SELECT * FROM devices').all())).not.toContain(token);
    expect(verifySession(s.db, token)).not.toBeNull();
  });

  it('un code est à usage unique et expire', async () => {
    const s = setup();
    const { code } = s.pairing.createCode();
    expect((await s.call(s.remote, '/auth/pair', { body: { code } })).status).toBe(200);
    expect((await s.call(s.remote, '/auth/pair', { body: { code } })).status).toBe(401);
    const p = new PairingManager();
    const c2 = p.createCode(0).code;
    expect(p.consume(c2, 11 * 60 * 1000)).toBe(false);
  });

  it('5 codes faux invalident le code en cours (anti force brute)', async () => {
    const s = setup();
    const { code } = s.pairing.createCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await s.call(s.remote, '/auth/pair', { body: { code: wrong } })).status).toBe(401);
    expect((await s.call(s.remote, '/auth/pair', { body: { code } })).status).toBe(401);
  });

  it('bloque l’appairage après 20 échecs en une heure', () => {
    const p = new PairingManager();
    for (let i = 0; i < 20; i++) {
      p.createCode();
      p.consume('999999x');
    }
    p.createCode();
    expect(() => p.consume('123456')).toThrow(/Trop de tentatives/);
  });

  it('un appareil révoqué perd l’accès immédiatement', async () => {
    const s = setup();
    const { cookie } = await pair(s);
    const devices = (await (await s.call(s.local, '/remote', { host: '127.0.0.1:4317' })).json()) as { devices: { id: string }[] };
    expect(devices.devices).toHaveLength(1);
    await s.call(s.local, `/remote/devices/${devices.devices[0].id}`, { method: 'DELETE', host: '127.0.0.1:4317' });
    expect((await s.call(s.remote, '/overview', { cookie })).status).toBe(401);
  });

  it('les actions sensibles restent réservées au Mac, même appairé', async () => {
    const s = setup();
    const { cookie } = await pair(s);
    for (const [path, init] of [
      ['/remote', {}],
      ['/remote/pairing', { body: {} }],
      ['/ai/key', { body: { apiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' } }],
      ['/reset', { body: { confirm: 'EFFACER' } }],
      ['/export', {}],
      ['/backup', { body: {} }],
    ] as const) {
      expect((await s.call(s.remote, path, { ...init, cookie })).status, path).toBe(403);
    }
    // Et la clé API n'est jamais exposée, même masquée.
    const status = (await (await s.call(s.remote, '/ai/status', { cookie })).json()) as { key: { masked: string | null; configured: boolean } };
    expect(status.key).toMatchObject({ configured: true, masked: null });
  });

  it('refuse les écritures venant d’une autre origine (anti-CSRF)', async () => {
    const s = setup();
    const { cookie } = await pair(s);
    expect((await s.call(s.remote, '/tasks', { body: { title: 'x' }, cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await s.call(s.remote, '/tasks', { body: { title: 'ok' }, cookie, origin: `https://${s.HOST}` })).status).toBe(201);
  });

  it('la porte locale reste inaccessible depuis un autre hôte', async () => {
    const s = setup();
    expect((await s.call(s.local, '/overview')).status).toBe(403);
  });
});

describe('mode vocal', () => {
  it('ajoute la consigne vocale dans le contexte du message, pas dans le système', () => {
    const db = testDb();
    expect(initialContext(db, true)).toContain(VOICE_HINT);
    expect(turnContext(db, true)).toContain(VOICE_HINT);
    expect(turnContext(db, false)).not.toContain(VOICE_HINT);
  });
});
