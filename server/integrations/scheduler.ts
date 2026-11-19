/**
 * Synchronisation automatique des intégrations connectées (Strava, Menhir),
 * 30 s après le démarrage puis toutes les heures, tant que NEXUS tourne.
 * Les erreurs sont enregistrées dans l'état de l'intégration (visibles dans Analytics → Sources).
 */
import type { DB } from '../db/client';
import type { SecretStore } from '../ai/secrets';
import * as strava from './strava';
import * as menhir from './menhir';

export function startIntegrationSync(deps: { db: DB; secrets: SecretStore }, everyMs = 60 * 60 * 1000): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (strava.isConnected(deps.secrets)) await strava.syncStrava(deps).catch(() => {});
      if (menhir.isConnected(deps.secrets)) await menhir.syncMenhir(deps).catch(() => {});
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => void tick(), 30_000);
  const timer = setInterval(() => void tick(), everyMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
