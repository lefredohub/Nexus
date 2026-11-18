import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db/client';
import { SecretStore } from '../server/ai/secrets';

/** Base SQLite en mémoire, migrée, pour chaque test. */
export function testDb() {
  return openDatabase(':memory:');
}

export function tempDir() {
  return mkdtempSync(join(tmpdir(), 'nexus-test-'));
}

export function testSecrets(withKey = false) {
  const s = new SecretStore(join(tempDir(), 'secrets.json'));
  if (withKey) s.setApiKey('sk-ant-test-0000000000000000000000');
  return s;
}

/** Laisse passer les événements différés (setImmediate) et les promesses. */
export const flush = () => new Promise((r) => setTimeout(r, 20));
