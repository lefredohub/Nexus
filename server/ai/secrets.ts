/**
 * Gestion de la clé API Anthropic.
 *
 * Ordre de priorité :
 *  1. variable d'environnement ANTHROPIC_API_KEY (ex. dans `.env`) ;
 *  2. fichier `data/secrets.json` (permissions 600 : lisible par toi seul),
 *     rempli depuis l'écran Réglages.
 *
 * La clé n'est JAMAIS renvoyée à l'interface : seule une version masquée l'est.
 * `data/` est exclu de Git.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export interface KeyStatus {
  configured: boolean;
  source: 'env' | 'file' | null;
  masked: string | null;
}

export class SecretStore {
  constructor(private file: string) {}

  private readFile(): { anthropicApiKey?: string } {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  getApiKey(): string | null {
    const env = process.env.ANTHROPIC_API_KEY?.trim();
    if (env) return env;
    return this.readFile().anthropicApiKey ?? null;
  }

  status(): KeyStatus {
    const env = process.env.ANTHROPIC_API_KEY?.trim();
    const key = this.getApiKey();
    return {
      configured: Boolean(key),
      source: env ? 'env' : key ? 'file' : null,
      masked: key ? `${key.slice(0, 10)}…${key.slice(-4)}` : null,
    };
  }

  setApiKey(key: string) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ ...this.readFile(), anthropicApiKey: key }, null, 2), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }

  clearApiKey() {
    const rest = this.readFile();
    delete rest.anthropicApiKey;
    if (Object.keys(rest).length === 0) rmSync(this.file, { force: true });
    else writeFileSync(this.file, JSON.stringify(rest, null, 2), { mode: 0o600 });
  }
}
