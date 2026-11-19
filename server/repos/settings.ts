import { type DB, all, run } from '../db/client';

export interface Settings {
  user_name: string;
  /** « ollama » : IA locale gratuite sur le Mac. « anthropic » : Claude (payant, clé API). */
  ai_provider: 'anthropic' | 'ollama';
  /** Modèle Ollama utilisé quand ai_provider = « ollama ». */
  ollama_model: string;
  ai_model: string;
  ai_effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  ai_allow_writes: boolean;
  currency: string;
  onboarded: boolean;
  /** Porte d'accès distant (iPhone) : désactivée par défaut. */
  remote_mode: 'off' | 'lan' | 'tailscale';
}

export const DEFAULT_SETTINGS: Settings = {
  user_name: '',
  ai_provider: 'ollama',
  ollama_model: 'qwen3:8b',
  ai_model: 'claude-opus-5-5',
  ai_effort: 'medium',
  ai_allow_writes: true,
  currency: 'EUR',
  onboarded: false,
  remote_mode: 'off',
};

export function getSettings(db: DB): Settings {
  const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (key in DEFAULT_SETTINGS) {
      try {
        out[key] = JSON.parse(value);
      } catch {
        /* valeur corrompue : on garde le défaut */
      }
    }
  }
  return out as unknown as Settings;
}

export function updateSettings(db: DB, patch: Partial<Settings>): Settings {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !(key in DEFAULT_SETTINGS)) continue;
    run(db, 'INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value', {
      key,
      value: JSON.stringify(value),
    });
  }
  return getSettings(db);
}
