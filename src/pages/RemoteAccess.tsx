/**
 * Réglages « Accès depuis l'iPhone » : activer la porte distante, appairer un
 * appareil par QR code, gérer les appareils autorisés.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Lock, LogOut, QrCode, ShieldCheck, Smartphone, Trash2, Wifi } from 'lucide-react';
import { api, useAction, useApi, queryClient } from '../lib/api';
import { cx, relTime } from '../lib/format';
import type { AuthStatus, RemoteInfo } from '../lib/types';
import { Badge, Button, Modal, Panel, SectionHeader } from '../components/ui';
import { toast } from '../components/Toast';

const MODES = [
  { id: 'off', title: 'Désactivé', icon: Lock, text: 'NEXUS n’est accessible que depuis ce Mac.' },
  { id: 'tailscale', title: 'Tailscale', badge: 'Recommandé', icon: ShieldCheck, text: 'Partout (4G, Wi-Fi), chiffré, HTTPS. Le micro de Jarvis fonctionne. Visible uniquement par tes appareils.' },
  { id: 'lan', title: 'Wi-Fi de la maison', icon: Wifi, text: 'Seulement à la maison, sans HTTPS : Safari bloque le micro (la voix de Jarvis et la dictée du clavier marchent).' },
] as const;

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast('Copié'));
}

export function RemoteAccessPanel() {
  const { data: info } = useApi<RemoteInfo>(['remote'], '/remote', { refetchInterval: 15_000 });
  const setMode = useAction((mode: string) => api<RemoteInfo>('/remote', { method: 'PATCH', body: { mode } }), { success: 'Accès distant mis à jour' });
  const tailscale = useAction(() => api<{ ok: boolean; output: string }>('/remote/tailscale', { body: {} }));
  const revoke = useAction((id: string) => api(`/remote/devices/${id}`, { method: 'DELETE' }), { success: 'Appareil retiré' });
  const [pairing, setPairing] = useState(false);
  const st = info?.status;
  const ts = st?.tailscale;

  return (
    <Panel hud className="p-5 md:p-6">
      <SectionHeader title="Accès depuis l’iPhone" action={<Smartphone size={15} className="text-ink-4" />} />
      <p className="-mt-1 mb-4 text-[13px] text-ink-2">Consulte NEXUS et parle à Jarvis depuis ton iPhone. Tes données restent sur ce Mac : l’iPhone s’y connecte, avec un appairage obligatoire.</p>

      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => {
          const active = info?.mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => !active && setMode.mutate(m.id)}
              disabled={setMode.isPending}
              className={cx('rounded-xl border p-3.5 text-left transition-all', active ? 'border-signal/50 bg-signal/[0.06]' : 'border-line hover:border-line-strong')}
            >
              <div className="flex items-center gap-2">
                <m.icon size={15} className={active ? 'text-signal' : 'text-ink-3'} />
                <span className="text-[13.5px] font-medium">{m.title}</span>
                {'badge' in m && <Badge tone="signal">{m.badge}</Badge>}
              </div>
              <div className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{m.text}</div>
            </button>
          );
        })}
      </div>

      {st && info.mode !== 'off' && (
        <div className="mt-4 space-y-3 rounded-xl border border-line bg-white/[0.02] p-4 text-[13px]">
          <div className="flex items-center gap-2">
            <span className={cx('h-2 w-2 rounded-full', st.running ? 'bg-ok shadow-[0_0_8px_var(--color-ok)]' : 'bg-danger')} />
            {st.running ? `Porte distante ouverte (port ${st.port})` : `Porte distante fermée${st.error ? ` : ${st.error}` : ''}`}
          </div>

          {info.mode === 'lan' && (
            <div>
              <div className="label mb-1.5">Adresse à ouvrir sur l’iPhone (même Wi-Fi)</div>
              {st.lanUrls.length === 0 && <div className="text-ink-3">Aucune adresse réseau détectée : le Mac est-il connecté au Wi-Fi ?</div>}
              {st.lanUrls.map((u) => (
                <UrlRow key={u} url={u} />
              ))}
            </div>
          )}

          {info.mode === 'tailscale' && (
            <div className="space-y-2.5">
              {!ts?.installed ? (
                <ol className="list-decimal space-y-1 pl-5 text-ink-2">
                  <li>
                    Installe Tailscale (gratuit) sur ce Mac et sur ton iPhone :{' '}
                    <a className="text-ion underline" href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                      tailscale.com/download
                    </a>
                  </li>
                  <li>Connecte-toi avec le même compte sur les deux appareils.</li>
                  <li>Reviens ici : NEXUS détectera Tailscale automatiquement.</li>
                </ol>
              ) : !ts.dnsName ? (
                <div className="text-ink-2">Tailscale est installé mais pas connecté. Ouvre l’app Tailscale sur le Mac et connecte-toi.</div>
              ) : (
                <>
                  <div className="label">Adresse privée de ton NEXUS</div>
                  <UrlRow url={ts.url!} />
                  <div className="text-[12px] text-ink-3">
                    Dernière étape (une seule fois) : publier NEXUS en HTTPS sur ton réseau Tailscale. Équivaut à la commande <code className="font-mono text-ink-2">tailscale serve --bg {st.port}</code>.
                  </div>
                  <Button size="sm" icon={<ShieldCheck size={13} />} loading={tailscale.isPending} onClick={() => tailscale.mutate(undefined)}>
                    Activer le HTTPS Tailscale
                  </Button>
                  {tailscale.data && (
                    <pre className={cx('max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2.5 font-mono text-[11px]', tailscale.data.ok ? 'text-ink-2' : 'text-warn')}>
                      {tailscale.data.output || (tailscale.data.ok ? 'OK' : 'Échec')}
                    </pre>
                  )}
                  <div className="text-[12px] text-ink-3">Si Tailscale demande d’activer « HTTPS Certificates », suis le lien affiché (console Tailscale → DNS), puis relance.</div>
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button variant="primary" size="sm" icon={<QrCode size={14} />} disabled={!st.running} onClick={() => setPairing(true)}>
              Appairer un appareil
            </Button>
            <span className="text-[12px] text-ink-3">Code à usage unique, valable 10 minutes.</span>
          </div>
        </div>
      )}

      {info && info.devices.length > 0 && (
        <div className="mt-4">
          <div className="label mb-2">Appareils autorisés</div>
          <div className="space-y-1">
            {info.devices.map((d) => (
              <div key={d.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-white/[0.03]">
                <Smartphone size={14} className="text-ink-3" />
                <span className="flex-1">{d.name}</span>
                <span className="font-mono text-[10.5px] text-ink-3">vu {relTime(d.last_seen_at)}</span>
                <button aria-label={`Retirer ${d.name}`} onClick={() => confirm(`Retirer l’accès de « ${d.name} » ?`) && revoke.mutate(d.id)} className="text-ink-4 hover:text-danger">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <PairingModal open={pairing} onClose={() => (setPairing(false), void queryClient.invalidateQueries({ queryKey: ['remote'] }))} />
    </Panel>
  );
}

function UrlRow({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-3 py-2 font-mono text-[12.5px]">
      <span className="flex-1 truncate">{url}</span>
      <button aria-label="Copier l’adresse" onClick={() => copy(url)} className="text-ink-3 hover:text-ink">
        <Copy size={13} />
      </button>
    </div>
  );
}

function PairingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<{ code: string; expiresAt: string; url: string | null; qr: string | null } | null>(null);
  const [left, setLeft] = useState(0);
  const { data: info } = useApi<RemoteInfo>(['remote'], '/remote', { enabled: open, refetchInterval: open ? 3000 : false });
  const [initialDevices, setInitialDevices] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setInitialDevices(null);
    api<{ code: string; expiresAt: string; url: string | null; qr: string | null }>('/remote/pairing', { body: {} }).then(setData, (e) => toast(e.message, 'error'));
  }, [open]);
  useEffect(() => {
    if (open && info && initialDevices === null) setInitialDevices(info.devices.length);
  }, [open, info, initialDevices]);
  useEffect(() => {
    if (!data) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [data]);

  const paired = initialDevices !== null && info !== undefined && info.devices.length > initialDevices;

  return (
    <Modal open={open} onClose={onClose} title="Appairer un appareil">
      {paired ? (
        <div className="py-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ok/15 text-ok">
            <Check size={22} />
          </div>
          <div className="text-[16px] font-medium">« {info!.devices[0].name} » est relié.</div>
          <Button className="mt-5" variant="primary" onClick={onClose}>
            Terminé
          </Button>
        </div>
      ) : !data ? (
        <div className="py-10 text-center text-ink-3">Génération du code…</div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {data.qr ? (
              // SVG généré par notre propre serveur (bibliothèque qrcode) : contenu de confiance.
              // Modules sombres sur fond blanc : c'est ce que l'appareil photo de l'iPhone lit le mieux.
              <div className="w-[180px] shrink-0 overflow-hidden rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: data.qr }} />
            ) : (
              <div className="flex h-[180px] w-[180px] shrink-0 items-center justify-center rounded-xl border border-dashed border-line p-4 text-center text-[12px] text-ink-3">Adresse inconnue : saisis le code à la main sur l’iPhone.</div>
            )}
            <div className="text-center sm:text-left">
              <div className="label mb-1">Code</div>
              <div className="num text-[40px] tracking-[0.18em]">{data.code}</div>
              <div className={cx('font-mono text-[11px]', left < 60 ? 'text-warn' : 'text-ink-3')}>{left > 0 ? `expire dans ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'expiré — ferme et recommence'}</div>
            </div>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-ink-2">
            <li>Scanne le QR code avec l’appareil photo de l’iPhone : Safari s’ouvre et l’iPhone est relié.</li>
            <li>
              Pour l’avoir comme une app : dans Safari, <span className="text-ink">Partager → Sur l’écran d’accueil</span>.
            </li>
            <li>Ouvre NEXUS depuis l’icône : iOS l’isole de Safari, il te redemandera un code. Génère-en un nouveau ici et saisis-le.</li>
          </ol>
        </div>
      )}
    </Modal>
  );
}

/** Sur l'iPhone : informations sur cet appareil et déconnexion. */
export function ThisDevicePanel() {
  const { data: auth } = useApi<AuthStatus>(['auth'], '/auth/status');
  const logout = useAction(() => api('/auth/logout', { body: {} }));
  return (
    <Panel hud className="p-5 md:p-6">
      <SectionHeader title="Cet appareil" action={<Smartphone size={15} className="text-ink-4" />} />
      <p className="text-[13.5px] text-ink-2">
        Connecté à ton NEXUS en tant que <span className="text-ink">« {auth?.device?.name ?? 'appareil'} »</span>
        {auth?.device ? `, relié ${relTime(auth.device.created_at)}` : ''}. La clé API, les sauvegardes et la gestion des appareils se règlent sur le Mac.
      </p>
      <Button className="mt-4" variant="danger" size="sm" icon={<LogOut size={13} />} onClick={() => confirm('Déconnecter cet appareil ? Il faudra un nouveau code pour revenir.') && logout.mutate(undefined)}>
        Déconnecter cet appareil
      </Button>
    </Panel>
  );
}
