/**
 * Accès à distance : appairage d'appareils (iPhone, iPad…) et sessions.
 *
 * Principe :
 *  1. Sur le Mac (accès local uniquement), NEXUS génère un code à 6 chiffres,
 *     valable 10 minutes, affiché avec un QR code.
 *  2. L'appareil saisit ce code (ou scanne le QR). En échange, il reçoit un
 *     jeton de session long (256 bits), stocké dans un cookie HttpOnly.
 *  3. Chaque requête distante doit présenter ce cookie. On ne garde en base
 *     que l'empreinte SHA-256 du jeton : une copie de la base ne permet pas
 *     de se connecter.
 *  4. Un appareil peut être révoqué à tout moment depuis les Réglages du Mac.
 *
 * Anti force brute : 5 essais faux invalident le code en cours, et au-delà de
 * 20 échecs par heure l'appairage est bloqué temporairement.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { type DB, all, get, run, newId, nowISO } from './db/client';
import { AppError } from './lib/errors';

export const SESSION_COOKIE = 'nexus_session';
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_CODE = 5;
const MAX_FAILURES_PER_HOUR = 20;

export interface Device {
  id: string;
  name: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class PairingManager {
  private current: { code: string; expiresAt: number; attempts: number } | null = null;
  private failures: number[] = [];

  /** Génère un nouveau code (remplace le précédent). */
  createCode(now = Date.now()): { code: string; expiresAt: string } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.current = { code, expiresAt: now + CODE_TTL_MS, attempts: 0 };
    return { code, expiresAt: new Date(this.current.expiresAt).toISOString() };
  }

  activeCode(now = Date.now()) {
    if (!this.current || this.current.expiresAt < now) return null;
    return { code: this.current.code, expiresAt: new Date(this.current.expiresAt).toISOString() };
  }

  /** Vérifie un code ; consomme le code s'il est bon (usage unique). */
  consume(code: string, now = Date.now()): boolean {
    this.failures = this.failures.filter((t) => now - t < 3_600_000);
    if (this.failures.length >= MAX_FAILURES_PER_HOUR) {
      throw new AppError(429, 'too_many_attempts', 'Trop de tentatives. Réessaie dans une heure ou génère un nouveau code sur le Mac.');
    }
    const c = this.current;
    const ok =
      c !== null &&
      c.expiresAt >= now &&
      code.length === c.code.length &&
      timingSafeEqual(Buffer.from(code), Buffer.from(c.code));
    if (ok) {
      this.current = null;
      return true;
    }
    this.failures.push(now);
    if (c) {
      c.attempts++;
      if (c.attempts >= MAX_ATTEMPTS_PER_CODE) this.current = null;
    }
    return false;
  }
}

/** Échange un code valide contre un jeton de session pour un nouvel appareil. */
export function pairDevice(db: DB, pairing: PairingManager, code: string, name: string, userAgent: string): { token: string; device: Device } {
  if (!pairing.consume(code.trim())) throw new AppError(401, 'invalid_code', 'Code incorrect ou expiré. Génère un nouveau code sur le Mac.');
  const token = randomBytes(32).toString('base64url');
  const id = newId('dev');
  const now = nowISO();
  run(db, 'INSERT INTO devices (id, name, token_hash, user_agent, created_at, last_seen_at) VALUES (:id, :name, :h, :ua, :now, :now)', {
    id,
    name: name.trim().slice(0, 60) || guessDeviceName(userAgent),
    h: hash(token),
    ua: userAgent.slice(0, 300),
    now,
  });
  return { token, device: get<Device>(db, 'SELECT id, name, user_agent, created_at, last_seen_at, revoked_at FROM devices WHERE id = :id', { id })! };
}

/** Renvoie l'appareil correspondant au jeton, ou null (jeton inconnu ou révoqué). */
export function verifySession(db: DB, token: string | undefined): Device | null {
  if (!token || token.length < 20) return null;
  const d = get<Device>(db, 'SELECT id, name, user_agent, created_at, last_seen_at, revoked_at FROM devices WHERE token_hash = :h AND revoked_at IS NULL', { h: hash(token) });
  if (!d) return null;
  // Mise à jour de « vu pour la dernière fois » au plus une fois par minute.
  if (Date.now() - new Date(d.last_seen_at).getTime() > 60_000) run(db, 'UPDATE devices SET last_seen_at = :now WHERE id = :id', { id: d.id, now: nowISO() });
  return d;
}

export function listDevices(db: DB): Device[] {
  return all<Device>(db, 'SELECT id, name, user_agent, created_at, last_seen_at, revoked_at FROM devices WHERE revoked_at IS NULL ORDER BY last_seen_at DESC');
}

export function revokeDevice(db: DB, id: string) {
  run(db, 'UPDATE devices SET revoked_at = :now WHERE id = :id', { id, now: nowISO() });
}

export function guessDeviceName(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Appareil';
}

/** Lit un cookie dans l'en-tête Cookie (sans dépendance). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ─── Jetons d'accès limités (Raccourci iPhone → Apple Santé) ─────────────────
// Contrairement à un appareil appairé (accès complet), un jeton n'ouvre QU'UNE
// porte précise (« scope ») : le Raccourci Santé peut envoyer des mesures, rien d'autre.

export type TokenScope = 'health:write';

export interface ApiToken {
  id: string;
  name: string;
  scope: TokenScope;
  created_at: string;
  last_used_at: string | null;
}

export function createApiToken(db: DB, name: string, scope: TokenScope): { token: string; info: ApiToken } {
  const token = `nxs_${randomBytes(24).toString('base64url')}`;
  const id = newId('tok');
  run(db, 'INSERT INTO api_tokens (id, name, token_hash, scope, created_at) VALUES (:id, :name, :h, :scope, :now)', { id, name: name.slice(0, 60), h: hash(token), scope, now: nowISO() });
  return { token, info: get<ApiToken>(db, 'SELECT id, name, scope, created_at, last_used_at FROM api_tokens WHERE id = :id', { id })! };
}

/** Vérifie un jeton « Bearer » pour un périmètre donné. */
export function verifyApiToken(db: DB, authorization: string | undefined, scope: TokenScope): ApiToken | null {
  const m = authorization?.match(/^Bearer\s+(nxs_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const t = get<ApiToken>(db, 'SELECT id, name, scope, created_at, last_used_at FROM api_tokens WHERE token_hash = :h AND revoked_at IS NULL AND scope = :scope', { h: hash(m[1]), scope });
  if (t) run(db, 'UPDATE api_tokens SET last_used_at = :now WHERE id = :id', { id: t.id, now: nowISO() });
  return t ?? null;
}

export function listApiTokens(db: DB): ApiToken[] {
  return all<ApiToken>(db, 'SELECT id, name, scope, created_at, last_used_at FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC');
}

export function revokeApiToken(db: DB, id: string) {
  run(db, 'UPDATE api_tokens SET revoked_at = :now WHERE id = :id', { id, now: nowISO() });
}
