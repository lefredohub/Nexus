/**
 * Sert l'interface compilée (dossier dist/, produit par `npm run build`).
 * Utilisé en production locale et pour l'accès depuis l'iPhone.
 */
import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';

export function attachStatic(app: Hono, distDir: string) {
  if (!existsSync(distDir)) {
    app.get('*', (c) =>
      c.html(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="background:#060708;color:#ecebe6;font:16px system-ui;padding:32px">
         <h1>NEXUS</h1><p>L’interface n’est pas encore compilée.</p><p>Sur le Mac, lance <code>npm start</code> (ou <code>npm run build</code>).</p></body>`,
        503,
      ),
    );
    return;
  }
  const root = relative(process.cwd(), distDir) || '.';
  app.use('/*', serveStatic({ root }));
  // Toutes les autres adresses (/jarvis, /projects/…) renvoient l'application.
  app.get('*', serveStatic({ path: `${root}/index.html` }));
}
