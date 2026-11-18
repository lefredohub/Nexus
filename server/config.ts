/**
 * Configuration centrale. Tout ce qui dépend de l'environnement est ici.
 * Les valeurs peuvent être surchargées dans un fichier `.env` (voir `.env.example`).
 */
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

export const config = {
  root,
  dataDir: resolve(root, process.env.NEXUS_DATA_DIR ?? 'data'),
  get dbFile() {
    return resolve(this.dataDir, 'nexus.db');
  },
  get secretsFile() {
    return resolve(this.dataDir, 'secrets.json');
  },
  /** Le serveur n'écoute QUE sur la machine locale : rien n'est exposé au réseau. */
  host: '127.0.0.1',
  port: Number(process.env.NEXUS_PORT ?? 4317),
  webPort: Number(process.env.NEXUS_WEB_PORT ?? 5317),
  isProd: process.env.NODE_ENV === 'production',
};
