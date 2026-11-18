/**
 * Protections du serveur local.
 *
 * NEXUS écoute uniquement sur 127.0.0.1 : il est invisible depuis le réseau.
 * Reste un risque classique pour une app locale : qu'un site web malveillant
 * ouvert dans ton navigateur tente d'appeler http://127.0.0.1:4317. On bloque :
 *  - les en-têtes Host inattendus (protection contre le « DNS rebinding ») ;
 *  - les requêtes de modification venant d'une autre origine que localhost ;
 *  - les requêtes de modification qui ne sont pas en JSON (anti-CSRF par formulaire).
 */
import type { MiddlewareHandler } from 'hono';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOST.test(u.host);
  } catch {
    return false;
  }
}

export const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host') ?? '';
  if (!LOCAL_HOST.test(host)) return c.json({ error: { code: 'forbidden_host', message: 'Hôte non autorisé' } }, 403);

  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin && !isLocalOrigin(origin)) return c.json({ error: { code: 'forbidden_origin', message: 'Origine non autorisée' } }, 403);
    const type = c.req.header('content-type') ?? '';
    const hasBody = c.req.raw.body !== null && c.req.header('content-length') !== '0';
    if (hasBody && !type.includes('application/json')) return c.json({ error: { code: 'unsupported_media', message: 'JSON attendu' } }, 415);
  }
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
};
