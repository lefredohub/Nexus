/**
 * Registre des intégrations de données (Personal Analytics).
 *
 * Une intégration alimente les tables existantes (transactions, workouts,
 * metric_entries) avec sa propre `source` et un `external_id` stable : une
 * resynchronisation ne crée jamais de doublons.
 *
 * Disponibles : Strava (strava.ts), Menhir (menhir.ts), Apple Santé (health.ts), CSV bancaire.
 * Pour en ajouter une : un module dans ce dossier (voir common.ts pour l'import sans
 * doublons), des routes dans server/app.ts, une entrée ici. Les secrets vont dans SecretStore.
 */
export interface IntegrationProvider {
  id: string;
  name: string;
  domain: 'finance' | 'sport' | 'health' | 'productivity';
  description: string;
  status: 'available' | 'planned';
}

export const INTEGRATIONS: IntegrationProvider[] = [
  { id: 'strava', name: 'Strava', domain: 'sport', description: 'Tes activités Strava importées automatiquement toutes les heures.', status: 'available' },
  { id: 'menhir', name: 'Menhir', domain: 'sport', description: 'Tes sorties de course et séances de muscu de Menhir, en lecture seule.', status: 'available' },
  { id: 'apple-health', name: 'Apple Santé', domain: 'health', description: 'Pas, sommeil, poids, FC au repos et calories, envoyés chaque soir par un Raccourci iPhone.', status: 'available' },
  { id: 'csv-bank', name: 'Relevé bancaire (CSV)', domain: 'finance', description: 'Importe les opérations exportées depuis ta banque. Les doublons sont détectés automatiquement.', status: 'available' },
  { id: 'open-banking', name: 'Open Banking', domain: 'finance', description: 'Connexion bancaire directe via un agrégateur DSP2.', status: 'planned' },
];
