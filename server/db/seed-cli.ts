/** `npm run seed` : charge les données de démo dans une base vide. */
import { openDatabase } from './client';
import { loadDemoData, isEmpty } from './seed';
import { config } from '../config';

const db = openDatabase(config.dbFile);
if (!isEmpty(db)) {
  console.error('La base contient déjà des données : chargement de la démo annulé (rien n’a été modifié).');
  process.exit(1);
}
loadDemoData(db);
console.log(`Données de démonstration chargées dans ${config.dbFile}`);
