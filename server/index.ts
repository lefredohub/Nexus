/**
 * Point d'entrée du serveur NEXUS.
 * - Développement : l'API tourne ici (port 4317), l'interface via Vite (port 5317).
 * - Production (`npm start`) : ce serveur sert aussi l'interface compilée (dist/).
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { config } from './config';
import { openDatabase } from './db/client';
import { SecretStore } from './ai/secrets';
import { createApp } from './app';
import { startAutomationEngine } from './automations/engine';

loadDotEnv(resolve(config.root, '.env'));

const db = openDatabase(config.dbFile);
const secrets = new SecretStore(config.secretsFile);
const app = createApp({ db, secrets, backupDir: resolve(config.dataDir, 'backups') });

const dist = resolve(config.root, 'dist');
if (config.isProd && existsSync(dist)) {
  const root = relative(process.cwd(), dist) || '.';
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ path: `${root}/index.html` }));
}

const stopEngine = startAutomationEngine({ db, ai: { db, secrets } });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const url = config.isProd ? `http://localhost:${info.port}` : `http://localhost:${config.webPort}`;
  console.log(`\n  ◉ NEXUS — API prête sur http://${config.host}:${info.port}`);
  console.log(`    Interface : ${url}`);
  console.log(`    Données   : ${config.dbFile}`);
  console.log(`    IA        : ${secrets.status().configured ? 'clé API configurée' : 'pas de clé API (à ajouter dans Réglages)'}\n`);
});

function shutdown() {
  stopEngine();
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
