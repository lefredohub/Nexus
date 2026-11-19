/**
 * Point d'entrée du serveur NEXUS.
 * - Développement : l'API tourne ici (port 4317), l'interface via Vite (port 5317).
 * - Production (`npm start`) : ce serveur sert aussi l'interface compilée (dist/).
 */
import { serve } from '@hono/node-server';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config';
import { openDatabase } from './db/client';
import { SecretStore } from './ai/secrets';
import { createApp } from './app';
import { startAutomationEngine } from './automations/engine';
import { PairingManager } from './auth';
import { RemoteServer } from './remote';
import { attachStatic } from './static';
import { getSettings } from './repos/settings';

loadDotEnv(resolve(config.root, '.env'));

const db = openDatabase(config.dbFile);
const secrets = new SecretStore(config.secretsFile);
const backupDir = resolve(config.dataDir, 'backups');
const dist = resolve(config.root, 'dist');
const pairing = new PairingManager();

// Porte distante (iPhone) : toujours l'interface compilée + appairage obligatoire.
const remoteApp = createApp({ db, secrets, backupDir, mode: 'remote', pairing });
attachStatic(remoteApp, dist);
const remote = new RemoteServer(remoteApp.fetch, config.remotePort);

// Porte locale (le Mac lui-même).
const app = createApp({ db, secrets, backupDir, mode: 'local', pairing, remote });
if (config.isProd) attachStatic(app, dist);

const stopEngine = startAutomationEngine({ db, ai: { db, secrets } });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, async (info) => {
  const mode = getSettings(db).remote_mode;
  await remote.apply(mode);
  const st = await remote.status();
  const url = config.isProd ? `http://localhost:${info.port}` : `http://localhost:${config.webPort}`;
  console.log(`\n  ◉ NEXUS — API prête sur http://${config.host}:${info.port}`);
  console.log(`    Interface : ${url}`);
  console.log(`    Données   : ${config.dbFile}`);
  console.log(`    IA        : ${secrets.status().configured ? 'clé API configurée' : 'pas de clé API (à ajouter dans Réglages)'}`);
  if (mode === 'off') console.log('    iPhone    : accès distant désactivé (Réglages → Accès depuis l’iPhone)');
  else if (st.error) console.log(`    iPhone    : ⚠ ${st.error}`);
  else console.log(`    iPhone    : ${mode === 'tailscale' ? st.tailscale.url ?? `via Tailscale (port ${config.remotePort})` : st.lanUrls.join(', ')}`);
  if (mode !== 'off' && !existsSync(dist)) console.log('    ⚠ Interface non compilée pour l’iPhone : lance `npm start` (ou `npm run build`).');
  console.log('');
});

function shutdown() {
  stopEngine();
  void remote.stop();
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/** Lecture minimale d'un fichier .env (sans dépendance). Les variables déjà définies priment. */
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
