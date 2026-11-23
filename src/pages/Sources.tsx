/**
 * Analytics → Sources : brancher Strava, Menhir et Apple Santé.
 * Les réglages sensibles (identifiants, jetons) ne se font que depuis le Mac.
 */
import { useEffect, useState } from 'react';
import { Activity, Check, Copy, Dumbbell, ExternalLink, HeartPulse, KeyRound, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { relTime, cx } from '../lib/format';
import { useSearchParam, navigate } from '../lib/router';
import type { AIStatus, RemoteInfo } from '../lib/types';
import { Badge, Button, Field, Input, Panel, SectionHeader } from '../components/ui';
import { toast } from '../components/Toast';

interface SyncInfo { lastSyncAt: string | null; lastResult: Record<string, number> | null; totals: Record<string, number> | null; lastError: string | null }
interface IntegrationsData {
  catalog: { id: string; name: string; description: string; status: string }[];
  strava: SyncInfo & { appConfigured: boolean; connected: boolean; athlete: string | null };
  menhir: SyncInfo & { connected: boolean; email: string | null; appUrl: string };
  health: { lastReceivedAt: string | null; lastDate: string | null; lastFields: string[]; receivedCount: number; tokens: { id: string; name: string; created_at: string; last_used_at: string | null }[] };
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast('Copié'));
}

function SyncLine({ info }: { info: SyncInfo }) {
  return (
    <div className="space-y-1 text-[12.5px]">
      <div className="text-ink-2">
        {info.lastSyncAt ? `Dernière synchro ${relTime(info.lastSyncAt)}` : 'Pas encore synchronisé'}
        {info.lastResult && ` · ${info.lastResult.added ?? 0} nouvelle(s)`}
        {info.totals && ` · ${info.totals.added ?? 0} importée(s) au total`}
      </div>
      {info.lastError && <div className="text-danger">{info.lastError}</div>}
    </div>
  );
}

export function Sources() {
  const { data } = useApi<IntegrationsData>(['integrations'], '/integrations');
  const { data: ai } = useApi<AIStatus>(['ai-status'], '/ai/status');
  const isMac = ai?.mode !== 'remote';
  const connected = useSearchParam('connected');
  const error = useSearchParam('error');
  const added = useSearchParam('added');

  // Retour de la page d'autorisation Strava.
  useEffect(() => {
    if (connected === 'strava') toast(`Strava connecté · ${added ?? 0} séance(s) importée(s)`);
    if (error) toast(error, 'error');
    if (connected || error) navigate('/analytics?tab=sources', { replace: true });
  }, [connected, error, added]);

  if (!data) return <Panel className="h-64 animate-pulse" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <StravaCard s={data.strava} isMac={isMac} />
      <MenhirCard m={data.menhir} isMac={isMac} />
      <div className="lg:col-span-2">
        <HealthCard h={data.health} isMac={isMac} />
      </div>
      <Panel className="p-5 lg:col-span-2">
        <SectionHeader title="Autres sources" />
        <div className="grid gap-2 sm:grid-cols-2">
          {data.catalog
            .filter((i) => !['strava', 'menhir', 'apple-health'].includes(i.id))
            .map((i) => (
              <div key={i.id} className={cx('rounded-xl border border-line p-3', i.status !== 'available' && 'opacity-60')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium">{i.name}</span>
                  <Badge tone={i.status === 'available' ? 'ok' : 'neutral'}>{i.status === 'available' ? 'Disponible' : 'Prévu'}</Badge>
                </div>
                <div className="mt-1 text-[12px] text-ink-3">{i.description}{i.id === 'csv-bank' && ' (onglet Finances)'}</div>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}

function CardHeader({ icon: Icon, title, color, on }: { icon: typeof Activity; title: string; color: string; on: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: `${color}22`, color }}>
        <Icon size={17} />
      </span>
      <span className="flex-1 text-[15px] font-medium">{title}</span>
      {on ? <Badge tone="ok">Connecté</Badge> : <Badge>Non connecté</Badge>}
    </div>
  );
}

function StravaCard({ s, isMac }: { s: IntegrationsData['strava']; isMac: boolean }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const saveApp = useAction(() => api('/integrations/strava/app', { method: 'PUT', body: { clientId, clientSecret: secret } }), { success: 'Application Strava enregistrée' });
  const sync = useAction(() => api<Record<string, number>>('/integrations/strava/sync', { body: {} }), { success: (r) => `${r.added} nouvelle(s) séance(s)` });
  const off = useAction(() => api('/integrations/strava', { method: 'DELETE' }), { success: 'Strava déconnecté' });
  return (
    <Panel className="p-5">
      <CardHeader icon={Activity} title="Strava" color="#fc5200" on={s.connected} />
      {s.connected ? (
        <div className="space-y-3">
          <div className="text-[13.5px]">Compte : {s.athlete ?? 'connecté'} · synchro automatique toutes les heures</div>
          <SyncLine info={s} />
          <div className="flex gap-2">
            <Button size="sm" icon={<RefreshCw size={13} />} loading={sync.isPending} onClick={() => sync.mutate(undefined)}>
              Synchroniser
            </Button>
            {isMac && (
              <Button size="sm" variant="ghost" icon={<Unplug size={13} />} onClick={() => confirm('Déconnecter Strava ? Les séances déjà importées restent.') && off.mutate(undefined)}>
                Déconnecter
              </Button>
            )}
          </div>
        </div>
      ) : !isMac ? (
        <div className="text-[13px] text-ink-3">À connecter depuis le Mac.</div>
      ) : !s.appConfigured ? (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-ink-2">
            <li>
              Ouvre{' '}
              <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ion underline">
                strava.com/settings/api <ExternalLink size={11} />
              </a>{' '}
              (connecté à ton compte).
            </li>
            <li>
              Crée une application : nom « NEXUS », catégorie au choix, site web <code className="font-mono text-ink">http://localhost</code>, et surtout <span className="text-ink">Authorization Callback Domain</span> : <code className="font-mono text-ink">localhost</code>.
            </li>
            <li>Copie ici le <span className="text-ink">Client ID</span> et le <span className="text-ink">Client Secret</span> affichés.</li>
          </ol>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Client ID">
              <Input value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="123456" className="font-mono" />
            </Field>
            <Field label="Client Secret">
              <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value.trim())} placeholder="40 caractères" className="font-mono" autoComplete="off" />
            </Field>
          </div>
          <Button variant="primary" size="sm" icon={<KeyRound size={13} />} disabled={!clientId || !secret} loading={saveApp.isPending} onClick={() => saveApp.mutate(undefined)}>
            Enregistrer
          </Button>
          <div className="text-[11.5px] text-ink-3">Le secret reste sur ton Mac (data/secrets.json) et n’est jamais renvoyé à l’interface.</div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-2">Application Strava prête. Autorise maintenant NEXUS à lire tes activités (lecture seule).</p>
          <a href="/api/integrations/strava/connect" className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-[#fc5200] px-4 text-[13px] font-medium text-white hover:brightness-110">
            <Activity size={14} /> Connecter avec Strava
          </a>
          {s.lastError && <div className="text-[12.5px] text-danger">{s.lastError}</div>}
        </div>
      )}
    </Panel>
  );
}

function MenhirCard({ m, isMac }: { m: IntegrationsData['menhir']; isMac: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useAction(() => api<{ firstSync: Record<string, number> }>('/integrations/menhir/login', { body: { email, password } }), { success: (r) => `Menhir connecté · ${r.firstSync.added} séance(s) importée(s)` });
  const sync = useAction(() => api<Record<string, number>>('/integrations/menhir/sync', { body: {} }), { success: (r) => `${r.added} nouvelle(s) séance(s)` });
  const off = useAction(() => api('/integrations/menhir', { method: 'DELETE' }), { success: 'Menhir déconnecté' });
  return (
    <Panel className="p-5">
      <CardHeader icon={Dumbbell} title="Menhir" color="#b8851c" on={m.connected} />
      {m.connected ? (
        <div className="space-y-3">
          <div className="text-[13.5px]">Compte : {m.email} · synchro automatique toutes les heures</div>
          <SyncLine info={m} />
          <div className="flex gap-2">
            <Button size="sm" icon={<RefreshCw size={13} />} loading={sync.isPending} onClick={() => sync.mutate(undefined)}>
              Synchroniser
            </Button>
            {isMac && (
              <Button size="sm" variant="ghost" icon={<Unplug size={13} />} onClick={() => confirm('Déconnecter Menhir ? Les séances déjà importées restent.') && off.mutate(undefined)}>
                Déconnecter
              </Button>
            )}
          </div>
        </div>
      ) : !isMac ? (
        <div className="text-[13px] text-ink-3">À connecter depuis le Mac.</div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate(undefined, { onSuccess: () => setPassword('') });
          }}
        >
          <p className="text-[13px] text-ink-2">Importe tes sorties de course, tes séances de muscu (avec le tonnage) et ton ressenti du jour. Lecture seule : NEXUS ne modifie rien dans Menhir. Il faut que la sauvegarde cloud soit activée dans Menhir (Réglages → Compte).</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="E-mail Menhir">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Mot de passe">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={!email || !password} loading={login.isPending}>
            Connecter Menhir
          </Button>
          <div className="text-[11.5px] text-ink-3">Le mot de passe sert une seule fois et n’est pas conservé : NEXUS garde seulement un jeton de connexion.</div>
        </form>
      )}
    </Panel>
  );
}

const FIELD_LABEL: Record<string, string> = { steps: 'pas', sleep: 'sommeil', weight: 'poids', resting_hr: 'FC repos', active_kcal: 'calories' };

function HealthCard({ h, isMac }: { h: IntegrationsData['health']; isMac: boolean }) {
  const { data: remote } = useApi<RemoteInfo>(['remote'], '/remote', { enabled: isMac });
  const [fresh, setFresh] = useState<string | null>(null);
  const create = useAction(() => api<{ token: string }>('/integrations/health/tokens', { body: { name: 'Raccourci Santé' } }), { success: 'Jeton créé : copie-le maintenant' });
  const revoke = useAction((id: string) => api(`/integrations/health/tokens/${id}`, { method: 'DELETE' }), { success: 'Jeton révoqué' });
  const base = remote?.baseUrl;
  const url = base ? `${base}/api/ingest/health` : null;
  return (
    <Panel className="p-5">
      <CardHeader icon={HeartPulse} title="Apple Santé" color="#e57fa8" on={h.receivedCount > 0} />
      <div className="mb-4 text-[13px]">
        {h.lastReceivedAt ? (
          <span className="text-ink-2">
            Dernier envoi {relTime(h.lastReceivedAt)} (journée du {h.lastDate}) : {h.lastFields.map((f) => FIELD_LABEL[f] ?? f).join(', ') || 'aucune mesure'}.
          </span>
        ) : (
          <span className="text-ink-3">Aucune donnée reçue pour l’instant.</span>
        )}
      </div>
      {!isMac ? (
        <div className="text-[13px] text-ink-3">La mise en place se fait depuis le Mac (Analytics → Sources).</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="label">1 · Adresse et jeton</div>
            {!url ? (
              <div className="rounded-lg border border-warn/30 bg-warn/[0.06] p-3 text-[12.5px] text-ink-2">
                Active d’abord l’accès depuis l’iPhone (Réglages → Accès depuis l’iPhone, mode Tailscale conseillé) : le Raccourci envoie les données à cette adresse.
              </div>
            ) : (
              <Field label="URL à mettre dans le Raccourci">
                <div className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-3 py-2 font-mono text-[12px]">
                  <span className="flex-1 truncate">{url}</span>
                  <button aria-label="Copier l’URL" onClick={() => copy(url)} className="text-ink-3 hover:text-ink">
                    <Copy size={13} />
                  </button>
                </div>
              </Field>
            )}
            {fresh ? (
              <Field label="Ton jeton (affiché une seule fois)">
                <div className="flex items-center gap-2 rounded-lg border border-signal/40 bg-signal/[0.06] px-3 py-2 font-mono text-[12px]">
                  <span className="flex-1 break-all">Bearer {fresh}</span>
                  <button aria-label="Copier le jeton" onClick={() => copy(`Bearer ${fresh}`)} className="text-ink-3 hover:text-ink">
                    <Copy size={13} />
                  </button>
                </div>
              </Field>
            ) : (
              <Button size="sm" icon={<KeyRound size={13} />} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (r) => setFresh(r.token) })}>
                Créer un jeton pour le Raccourci
              </Button>
            )}
            {h.tokens.length > 0 && (
              <div className="space-y-1">
                {h.tokens.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                    <Check size={12} className="text-ok" />
                    <span className="flex-1">{t.name} · {t.last_used_at ? `utilisé ${relTime(t.last_used_at)}` : 'jamais utilisé'}</span>
                    <button aria-label="Révoquer le jeton" onClick={() => confirm('Révoquer ce jeton ? Le Raccourci ne pourra plus envoyer de données.') && revoke.mutate(t.id)} className="text-ink-4 hover:text-danger">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11.5px] text-ink-3">Ce jeton ne permet QUE d’envoyer des mesures de santé : il ne donne accès à aucune autre donnée de NEXUS.</p>
          </div>
          <div>
            <div className="label mb-2">2 · Le Raccourci sur l’iPhone (une fois, ~10 min)</div>
            <ol className="list-decimal space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-ink-2">
              <li>App <span className="text-ink">Raccourcis</span> → onglet <span className="text-ink">Automatisation</span> → <span className="text-ink">+</span> → <span className="text-ink">Heure de la journée</span> : 22:00, Quotidien, <span className="text-ink">Exécuter immédiatement</span> → <span className="text-ink">Nouveau raccourci vide</span>.</li>
              <li>
                <span className="text-ink">Pas</span> : action « Rechercher des échantillons de santé » (Type : Pas, Date de début : aujourd’hui), puis « Calculer des statistiques » → <span className="text-ink">Somme</span>.
              </li>
              <li>
                <span className="text-ink">Calories</span> : même chose avec Type : Énergie active, puis Somme.
              </li>
              <li>
                <span className="text-ink">Poids</span> et <span className="text-ink">FC au repos</span> : « Rechercher des échantillons de santé » (Type : Poids, puis FC au repos), trier par Date de début du plus récent, Limite : 1.
              </li>
              <li>
                Action <span className="text-ink">« Obtenir le contenu de l’URL »</span> : l’URL ci-contre, Méthode <span className="text-ink">POST</span>, En-tête <code className="font-mono">Authorization</code> = le jeton (avec « Bearer »), Corps <span className="text-ink">JSON</span> avec les champs <code className="font-mono">steps</code>, <code className="font-mono">active_kcal</code>, <code className="font-mono">weight_kg</code>, <code className="font-mono">resting_hr</code> reliés aux résultats ci-dessus.
              </li>
              <li>Touche ▶︎ pour tester : la carte « Dernier envoi » ci-contre se met à jour.</li>
            </ol>
            <p className="mt-2 text-[11.5px] text-ink-3">Le sommeil (<code className="font-mono">sleep_hours</code>) et les entraînements sont acceptés aussi, mais leur récupération dans Raccourcis dépend de la version d’iOS : on les ajoutera ensemble, iPhone en main. Les noms d’actions peuvent légèrement varier selon la version d’iOS.</p>
          </div>
        </div>
      )}
    </Panel>
  );
}
