/**
 * Registre des intégrations de données (Personal Analytics).
 *
 * Une intégration alimente les tables existantes (transactions, workouts,
 * metric_entries) avec sa propre `source` et un `external_id` stable : une
 * resynchronisation ne crée jamais de doublons.
 *
 * Disponible aujourd'hui : import CSV de relevés bancaires.
 * Pour en ajouter une (ex. Strava) : implémente `IntegrationProvider`, puis
 * ajoute-la à INTEGRATIONS. Les secrets (jetons OAuth…) iront dans SecretStore.
 */
export interface IntegrationProvider {
  id: string;
  name: string;
  domain: 'finance' | 'sport' | 'health' | 'productivity';
  description: string;
  status: 'available' | 'planned';
}

export const INTEGRATIONS: IntegrationProvider[] = [
  { id: 'csv-bank', name: 'Relevé bancaire (CSV)', domain: 'finance', description: 'Importe les opérations exportées depuis ta banque. Les doublons sont détectés automatiquement.', status: 'available' },
  { id: 'strava', name: 'Strava', domain: 'sport', description: 'Synchronisation des activités sportives via l’API Strava (OAuth).', status: 'planned' },
  { id: 'apple-health', name: 'Apple Santé (export)', domain: 'health', description: 'Import de l’export XML d’Apple Santé (pas, sommeil, poids).', status: 'planned' },
  { id: 'open-banking', name: 'Open Banking', domain: 'finance', description: 'Connexion bancaire directe via un agrégateur DSP2.', status: 'planned' },
];
