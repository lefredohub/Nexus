/**
 * Serveur d'accès distant (iPhone, iPad…).
 *
 * NEXUS a deux « portes » :
 *  - la porte locale (127.0.0.1:4317), utilisée par le Mac lui-même, sans mot de passe ;
 *  - la porte distante (port 4318), ouverte UNIQUEMENT si tu l'actives dans Réglages,
 *    qui exige un appareil appairé pour chaque requête.
 *
 * Deux modes pour la porte distante :
 *  - « tailscale » (recommandé) : la porte n'écoute que sur le Mac ; Tailscale la rend
 *    accessible en HTTPS à TES appareils uniquement, à la maison comme dehors. Le HTTPS
 *    est indispensable pour le micro (commande vocale) sur iPhone.
 *  - « lan » : la porte écoute sur le Wi-Fi de la maison (http://IP-du-Mac:4318).
 *    Plus simple, mais sans HTTPS : Safari bloque alors le micro (la voix de Jarvis
 *    fonctionne, la dictée par le clavier de l'iPhone aussi).
 */
import { serve, type ServerType } from '@hono/node-server';
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export type RemoteMode = 'off' | 'lan' | 'tailscale';

export interface RemoteStatus {
  mode: RemoteMode;
  running: boolean;
  port: number;
  error: string | null;
  lanUrls: string[];
  tailscale: { installed: boolean; dnsName: string | null; url: string | null };
}

/** Adresses IPv4 du Mac sur le réseau local (ex. http://192.168.1.20:4318). */
export function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

const TAILSCALE_BINARIES = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'];

function run(bin: string, args: string[], timeout = 4000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() || (err?.message ?? '') }));
  });
}

let tsCache: { at: number; value: RemoteStatus['tailscale']; bin: string | null } | null = null;

/** Détecte Tailscale et le nom HTTPS de cette machine (ex. mon-mac.tail1234.ts.net). */
export async function detectTailscale(force = false): Promise<RemoteStatus['tailscale'] & { bin: string | null }> {
  if (!force && tsCache && Date.now() - tsCache.at < 30_000) return { ...tsCache.value, bin: tsCache.bin };
  for (const bin of TAILSCALE_BINARIES) {
    const r = await run(bin, ['status', '--json']);
    if (!r.ok && /ENOENT|not found/i.test(r.out)) continue;
    let dnsName: string | null = null;
    try {
      dnsName = (JSON.parse(r.out).Self?.DNSName as string | undefined)?.replace(/\.$/, '') || null;
    } catch {
      /* Tailscale installé mais arrêté ou non connecté */
    }
    const value = { installed: true, dnsName, url: dnsName ? `https://${dnsName}` : null };
    tsCache = { at: Date.now(), value, bin };
    return { ...value, bin };
  }
  const value = { installed: false, dnsName: null, url: null };
  tsCache = { at: Date.now(), value, bin: null };
  return { ...value, bin: null };
}

/** Demande à Tailscale de publier la porte distante en HTTPS, pour tes appareils seulement. */
export async function enableTailscaleServe(port: number): Promise<{ ok: boolean; output: string }> {
  const ts = await detectTailscale(true);
  if (!ts.bin) return { ok: false, output: 'Tailscale n’est pas installé sur ce Mac.' };
  const r = await run(ts.bin, ['serve', '--bg', String(port)], 15_000);
  return { ok: r.ok, output: r.out };
}

export class RemoteServer {
  private server: ServerType | null = null;
  private mode: RemoteMode = 'off';
  private error: string | null = null;

  constructor(
    private fetchHandler: (req: Request) => Response | Promise<Response>,
    readonly port: number,
  ) {}

  /** Applique un mode : démarre, redémarre ou arrête la porte distante. */
  async apply(mode: RemoteMode): Promise<void> {
    await this.stop();
    this.mode = mode;
    this.error = null;
    if (mode === 'off') return;
    const hostname = mode === 'lan' ? '0.0.0.0' : '127.0.0.1';
    await new Promise<void>((resolve) => {
      const server = serve({ fetch: this.fetchHandler, hostname, port: this.port }, () => resolve());
      server.on('error', (err: NodeJS.ErrnoException) => {
        this.error = err.code === 'EADDRINUSE' ? `Le port ${this.port} est déjà utilisé.` : err.message;
        this.server = null;
        resolve();
      });
      this.server = server;
    });
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return;
    // Ferme aussi les connexions gardées ouvertes (keep-alive), sinon l'arrêt traînerait.
    (s as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  async status(): Promise<RemoteStatus> {
    const ts = await detectTailscale();
    return {
      mode: this.mode,
      running: this.server !== null && this.error === null,
      port: this.port,
      error: this.error,
      lanUrls: lanUrls(this.port),
      tailscale: { installed: ts.installed, dnsName: ts.dnsName, url: ts.url },
    };
  }
}
