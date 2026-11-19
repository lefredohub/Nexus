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
import { readCookie, SESSION_COOKIE } from './auth';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOST.test(u.host);
  } catch {
    return false;
  }
}

/**
 * Une modification doit être en JSON, ou ne rien contenir (ex. DELETE).
 * Un formulaire HTML piégé envoie toujours un type « form » ou « text/plain » :
 * il est donc refusé, ce qui suffit contre les attaques CSRF.
 */
export function isJsonOrEmpty(contentType: string | undefined, contentLength: string | undefined, transferEncoding: string | undefined): boolean {
  if (contentType) return contentType.toLowerCase().includes('application/json');
  const declaresBody = (contentLength !== undefined && contentLength !== '0') || transferEncoding !== undefined;
  return !declaresBody;
}

export const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host') ?? '';
  if (!LOCAL_HOST.test(host)) return c.json({ error: { code: 'forbidden_host', message: 'Hôte non autorisé' } }, 403);

  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin && !isLocalOrigin(origin)) return c.json({ error: { code: 'forbidden_origin', message: 'Origine non autorisée' } }, 403);
    if (!isJsonOrEmpty(c.req.header('content-type'), c.req.header('content-length'), c.req.header('transfer-encoding'))) {
      return c.json({ error: { code: 'unsupported_media', message: 'JSON attendu' } }, 415);
    }
  }
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
};

/**
 * Protections de l'accès DISTANT (iPhone via Wi-Fi ou Tailscale).
 * Ici l'hôte peut être une IP du réseau local ou un nom *.ts.net : on ne peut
 * donc pas filtrer sur l'en-tête Host. À la place :
 *  - toute requête API doit porter un cookie de session valide (appareil appairé),
 *    sauf les routes d'appairage `/api/auth/*` ;
 *  - toute modification doit venir de la même origine que la page (anti-CSRF)
 *    et être en JSON.
 */
export function remoteGuard(verify: (token: string | undefined) => unknown): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const origin = c.req.header('origin');
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '';
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          /* origine illisible : refusée ci-dessous */
        }
        if (originHost !== host) return c.json({ error: { code: 'forbidden_origin', message: 'Origine non autorisée' } }, 403);
      }
      if (!isJsonOrEmpty(c.req.header('content-type'), c.req.header('content-length'), c.req.header('transfer-encoding'))) {
        return c.json({ error: { code: 'unsupported_media', message: 'JSON attendu' } }, 415);
      }
    }
    if (!c.req.path.startsWith('/api/auth/')) {
      const token = readCookie(c.req.header('cookie'), SESSION_COOKIE);
      if (!verify(token)) return c.json({ error: { code: 'unauthenticated', message: 'Appareil non autorisé. Saisis le code d’appairage affiché sur ton Mac.' } }, 401);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  };
}
