import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { testDb, testSecrets, tempDir } from './helpers';
import { createApp } from '../server/app';
import { SecretStore } from '../server/ai/secrets';
import { isLocalOrigin } from '../server/security';

function setup() {
  const db = testDb();
  const backupDir = join(tempDir(), 'backups');
  const app = createApp({ db, secrets: testSecrets(false), backupDir });
  const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    app.request(`http://127.0.0.1:4317/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { host: '127.0.0.1:4317', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  return { db, app, call, backupDir };
}

describe('sécurité du serveur local', () => {
  it('refuse un en-tête Host étranger (DNS rebinding)', async () => {
    const { app } = setup();
    const res = await app.request('http://evil.example/api/overview', { headers: { host: 'evil.example' } });
    expect(res.status).toBe(403);
  });

  it('refuse les écritures venant d’une autre origine', async () => {
    const { call } = setup();
    const res = await call('/tasks', { body: { title: 'x' }, headers: { origin: 'https://site-malveillant.com' } });
    expect(res.status).toBe(403);
    expect((await call('/tasks', { body: { title: 'ok' }, headers: { origin: 'http://localhost:5317' } })).status).toBe(201);
  });

  it('refuse les écritures non JSON (anti-CSRF par formulaire)', async () => {
    const { app } = setup();
    const res = await app.request('http://127.0.0.1:4317/api/tasks', { method: 'POST', headers: { host: '127.0.0.1:4317', 'content-type': 'application/x-www-form-urlencoded' }, body: 'title=x' });
    expect(res.status).toBe(415);
  });

  it('reconnaît les origines locales', () => {
    expect(isLocalOrigin('http://localhost:5317')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1')).toBe(true);
    expect(isLocalOrigin('http://localhost.evil.com')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
  });
});

describe('API', () => {
  it('renvoie des erreurs de validation lisibles (422)', async () => {
    const { call } = setup();
    const res = await call('/projects', { body: { title: '', color: 'rouge' } });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('validation');
    expect(json.error.message).toMatch(/Titre requis/);
  });

  it('404 sur une ressource absente', async () => {
    const { call } = setup();
    expect((await call('/projects/prj_nope')).status).toBe(404);
    expect((await call('/route-inconnue')).status).toBe(404);
  });

  it('parcours complet : démo, vue d’ensemble, recherche, graphe', async () => {
    const { call } = setup();
    expect(await (await call('/demo')).json()).toEqual({ empty: true });
    expect((await call('/demo', { body: {} })).status).toBe(200);
    expect((await call('/demo', { body: {} })).status).toBe(409); // jamais par-dessus des données existantes
    const overview = (await (await call('/overview')).json()) as { projects: unknown[]; focus: unknown[] };
    expect(overview.projects.length).toBeGreaterThan(0);
    expect(overview.focus.length).toBeGreaterThan(0);
    expect(((await (await call('/search?q=newsletter')).json()) as unknown[]).length).toBeGreaterThan(0);
    const graph = (await (await call('/graph')).json()) as { nodes: unknown[]; edges: unknown[] };
    expect(graph.edges.length).toBeGreaterThan(5);
    expect((await call('/settings')).status).toBe(200);
  });

  it('l’IA sans clé répond par une erreur explicite, sans planter', async () => {
    const { call } = setup();
    await call('/settings', { method: 'PATCH', body: { ai_provider: 'anthropic' } });
    const res = await call('/ai/briefing', { body: {} });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('no_api_key');
    expect(((await (await call('/ai/status')).json()) as { key: { configured: boolean } }).key.configured).toBe(false);
  });

  it('la clé API est validée, jamais renvoyée en clair', async () => {
    const { call } = setup();
    expect((await call('/ai/key', { body: { apiKey: 'pas-une-cle' } })).status).toBe(422);
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const res = await call('/ai/key', { body: { apiKey: key } });
    const text = await res.text();
    expect(text).not.toContain(key);
    expect(JSON.parse(text)).toMatchObject({ configured: true, source: 'file' });
  });

  it('réinitialisation : exige la confirmation et crée une sauvegarde avant', async () => {
    const { call, backupDir } = setup();
    await call('/demo', { body: {} });
    expect((await call('/reset', { body: { confirm: 'oui' } })).status).toBe(422);
    const res = await call('/reset', { body: { confirm: 'EFFACER' } });
    expect(res.status).toBe(200);
    const { backup } = (await res.json()) as { backup: string };
    expect(backup.startsWith(backupDir)).toBe(true);
    expect(existsSync(backup)).toBe(true);
    expect(await (await call('/demo')).json()).toEqual({ empty: true });
  });
});

describe('stockage de la clé', () => {
  it('écrit le fichier de secrets avec des permissions restreintes', () => {
    const file = join(tempDir(), 'secrets.json');
    const s = new SecretStore(file);
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      s.setApiKey('sk-ant-test-123456789012345678901234');
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(file, 'utf8')).anthropicApiKey).toMatch(/^sk-ant-/);
      expect(s.status()).toMatchObject({ configured: true, source: 'file' });
      s.clearApiKey();
      expect(s.status().configured).toBe(false);
      process.env.ANTHROPIC_API_KEY = 'sk-ant-env-123456789012345678901234';
      expect(s.status().source).toBe('env');
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('règle « JSON ou vide » (anti-CSRF)', () => {
  it('accepte JSON et requêtes sans contenu, refuse formulaires et texte', async () => {
    const { isJsonOrEmpty } = await import('../server/security');
    expect(isJsonOrEmpty('application/json; charset=utf-8', '12', undefined)).toBe(true);
    expect(isJsonOrEmpty(undefined, undefined, undefined)).toBe(true); // DELETE sans corps
    expect(isJsonOrEmpty(undefined, '0', undefined)).toBe(true);
    expect(isJsonOrEmpty('application/x-www-form-urlencoded', '7', undefined)).toBe(false);
    expect(isJsonOrEmpty('text/plain', '3', undefined)).toBe(false);
    expect(isJsonOrEmpty('multipart/form-data; boundary=x', undefined, 'chunked')).toBe(false);
    expect(isJsonOrEmpty(undefined, '5', undefined)).toBe(false);
  });
});
