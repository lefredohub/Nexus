/** Export, sauvegarde et réinitialisation des données. */
import { mkdirSync } from 'node:fs';
import { type DB, all } from './client';

const TABLES = ['settings', 'goals', 'projects', 'milestones', 'risks', 'expenses', 'project_analyses', 'tasks', 'ideas', 'notes', 'memories', 'links', 'activity', 'transactions', 'workouts', 'habits', 'habit_checks', 'metrics', 'metric_entries', 'conversations', 'messages', 'briefings', 'automations', 'automation_runs'];

export function exportAll(db: DB) {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = all(db, `SELECT * FROM ${t}`);
  return { app: 'nexus', exported_at: new Date().toISOString(), data };
}

/** Copie de sécurité complète de la base (fichier SQLite) dans data/backups/. */
export function backupDatabase(db: DB, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/nexus-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

/** Vide toutes les données (après sauvegarde). Les réglages et la clé API sont conservés. */
export function wipeData(db: DB) {
  const order = ['automation_runs', 'automations', 'messages', 'conversations', 'briefings', 'metric_entries', 'metrics', 'habit_checks', 'habits', 'workouts', 'transactions', 'activity', 'links', 'memories', 'notes', 'project_analyses', 'expenses', 'risks', 'milestones', 'tasks', 'ideas', 'projects', 'goals'];
  db.exec('BEGIN');
  try {
    for (const t of order) db.exec(`DELETE FROM ${t}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
