/**
 * Réglages de l'intelligence artificielle : IA locale gratuite (Ollama) ou Claude.
 */
import { useState } from 'react';
import { Cpu, Download, ExternalLink, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { api, postSSE, queryClient, useAction, useApi, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import type { AIStatus, Settings } from '../lib/types';
import { Badge, Button, Field, Input, Panel, ProgressBar, SectionHeader, Select, Toggle } from '../components/ui';
import { Core } from '../components/Core';
import { toast } from '../components/Toast';

const CLAUDE_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Très économique (≈ 0,3 centime par échange)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Rapide, bon équilibre' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Raisonnement solide, coût modéré' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', hint: 'Le plus capable · nettement plus cher' },
];
const EFFORTS = [
  { id: 'low', label: 'Rapide' },
  { id: 'medium', label: 'Équilibré' },
  { id: 'high', label: 'Approfondi' },
  { id: 'xhigh', label: 'Très approfondi' },
  { id: 'max', label: 'Maximal' },
];
/** Modèles locaux conseillés pour un Mac M1/M2/M3 avec 16 Go. */
const LOCAL_SUGGESTIONS = [
  { name: 'qwen3:8b', size: '5,2 Go', hint: 'Conseillé : bon en français, sait utiliser les outils de NEXUS' },
  { name: 'qwen3:4b', size: '2,6 Go', hint: 'Plus rapide et plus léger, un peu moins fiable' },
];

/** Les statuts d'Ollama sont en anglais : on les traduit. */
function pullStatus(status: string): string {
  if (/^pulling manifest/.test(status)) return 'préparation';
  if (/^pulling/.test(status) || /^downloading/.test(status)) return 'téléchargement';
  if (/^verifying/.test(status)) return 'vérification';
  if (/^writing|^removing/.test(status)) return 'finalisation';
  if (status === 'success') return 'terminé';
  return status;
}

const fmtGo = (bytes: number) => `${(bytes / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;

export function AISettingsPanel({ isMac }: { isMac: boolean }) {
  const { data: s } = useApi<Settings>(['settings'], '/settings');
  const { data: ai } = useApi<AIStatus>(['ai-status'], '/ai/status', { refetchInterval: (q) => (q.state.data?.online ? false : 5000) });
  const patch = useAction((body: Partial<Settings>) => api('/settings', { method: 'PATCH', body }), { success: 'Réglage enregistré' });
  const verify = useAction(() => api<{ ok: boolean; name: string }>('/ai/verify', { body: {} }), { success: (r) => `Opérationnelle · ${r.name}` });
  const local = (s?.ai_provider ?? ai?.provider) === 'ollama';

  return (
    <Panel hud className="p-5 md:p-6">
      <SectionHeader title="Intelligence artificielle" action={<Core size={26} state={ai?.online ? 'idle' : 'offline'} />} />

      {/* Choix du cerveau */}
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { id: 'ollama' as const, icon: Cpu, title: 'IA locale', badge: 'Gratuit', text: 'Tourne sur ton Mac avec Ollama. Rien ne sort de chez toi. Plus lente et moins fine que Claude.' },
          { id: 'anthropic' as const, icon: Sparkles, title: 'Claude', badge: 'Payant', text: 'Le plus intelligent. Clé API Anthropic, facturée à l’usage (quelques centimes avec Haiku).' },
        ].map((p) => {
          const active = (s?.ai_provider ?? 'ollama') === p.id;
          return (
            <button
              key={p.id}
              disabled={!isMac || patch.isPending}
              onClick={() => !active && patch.mutate({ ai_provider: p.id })}
              className={cx('rounded-xl border p-3.5 text-left transition-all disabled:cursor-default', active ? 'border-signal/50 bg-signal/[0.06]' : 'border-line hover:border-line-strong')}
            >
              <div className="flex items-center gap-2">
                <p.icon size={15} className={active ? 'text-signal' : 'text-ink-3'} />
                <span className="text-[13.5px] font-medium">{p.title}</span>
                <Badge tone={p.id === 'ollama' ? 'ok' : 'neutral'}>{p.badge}</Badge>
              </div>
              <div className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{p.text}</div>
            </button>
          );
        })}
      </div>

      {/* État */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-4">
        <span className={cx('h-2 w-2 rounded-full', ai?.online ? 'bg-ok shadow-[0_0_8px_var(--color-ok)]' : 'bg-ink-3')} />
        <div className="min-w-0 flex-1 text-[13.5px]">
          {ai?.online ? (
            <>
              Opérationnelle · <span className="font-mono text-[12.5px]">{ai.model}</span>
            </>
          ) : (
            <span className="text-ink-2">{ai?.reason ?? 'Vérification…'}</span>
          )}
        </div>
        {isMac && ai?.online && (
          <Button size="sm" icon={<ShieldCheck size={13} />} loading={verify.isPending} onClick={() => verify.mutate(undefined)}>
            Tester
          </Button>
        )}
      </div>

      {isMac && (local ? <LocalSection ai={ai} settings={s} onModel={(m) => patch.mutate({ ollama_model: m })} /> : <ClaudeSection ai={ai} settings={s} onModel={(m) => patch.mutate({ ai_model: m })} />)}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Effort de réflexion" hint={local ? '« Approfondi » ou plus : l’IA locale réfléchit avant de répondre (plus juste, mais nettement plus lent).' : 'Plus d’effort = réponses plus fouillées, mais plus lentes et plus coûteuses.'}>
          <Select value={s?.ai_effort ?? 'medium'} onChange={(e) => patch.mutate({ ai_effort: e.target.value as Settings['ai_effort'] })}>
            {EFFORTS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-5 flex items-start gap-4 rounded-xl border border-line p-4">
        <Toggle checked={s?.ai_allow_writes ?? true} onChange={(v) => patch.mutate({ ai_allow_writes: v })} label="Autoriser l’IA à modifier mes données" />
        <div>
          <div className="text-[13.5px]">Autoriser NEXUS AI à agir</div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">Créer des tâches et projets, mémoriser, relier des éléments, enregistrer des données. Désactivé : l’IA peut seulement lire et proposer. Chaque action reste visible et tracée.</div>
        </div>
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
        {local
          ? 'IA locale : gratuite et sans limite. Tes données ne quittent jamais ton Mac. Elle est plus lente (surtout le premier message, le temps de charger le modèle) et moins fiable que Claude sur les analyses complexes.'
          : 'Claude : chaque message, analyse ou briefing consomme des tokens facturés sur ton compte Anthropic. Aucun appel n’est fait sans action de ta part (« Tester » est gratuit).'}
      </p>
    </Panel>
  );
}

function LocalSection({ ai, settings, onModel }: { ai?: AIStatus; settings?: Settings; onModel: (m: string) => void }) {
  const o = ai?.ollama;
  const [custom, setCustom] = useState('');
  const [pulling, setPulling] = useState<{ model: string; status: string; ratio: number | null } | null>(null);

  const pull = async (model: string) => {
    setPulling({ model, status: 'Démarrage…', ratio: null });
    try {
      let failed: string | null = null;
      await postSSE('/ai/ollama/pull', { model }, (event, data) => {
        const d = data as { status?: string; completed?: number; total?: number; message?: string };
        if (event === 'progress') setPulling({ model, status: pullStatus(d.status ?? ''), ratio: d.total ? (d.completed ?? 0) / d.total : null });
        if (event === 'error') failed = d.message ?? 'Échec du téléchargement';
      });
      if (failed) throw new Error(failed);
      toast(`Modèle ${model} installé`);
      if (settings?.ollama_model !== model) onModel(model);
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : 'Échec du téléchargement', 'error');
    } finally {
      setPulling(null);
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
    }
  };

  if (!o?.reachable) {
    return (
      <div className="mt-4 rounded-xl border border-line p-4">
        <div className="mb-2 text-[13.5px] font-medium">Installer Ollama (gratuit, 2 minutes)</div>
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-ink-2">
          <li>
            Télécharge Ollama pour Mac :{' '}
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ion underline">
              ollama.com/download <ExternalLink size={11} />
            </a>
          </li>
          <li>Glisse l’app dans Applications et ouvre-la (une icône de lama apparaît dans la barre des menus).</li>
          <li>Reviens ici : NEXUS la détecte tout seul, puis te propose de télécharger le modèle.</li>
        </ol>
      </div>
    );
  }

  const installed = o.models;
  const current = settings?.ollama_model ?? o.recommended;
  return (
    <div className="mt-4 space-y-4 rounded-xl border border-line p-4">
      <div className="text-[12.5px] text-ink-3">Ollama {o.version ?? ''} détecté · {installed.length} modèle(s) installé(s)</div>

      {installed.length > 0 && (
        <Field label="Modèle utilisé">
          <Select value={installed.some((m) => m.name === current) ? current : ''} onChange={(e) => e.target.value && onModel(e.target.value)}>
            {!installed.some((m) => m.name === current) && <option value="">{current} (pas encore téléchargé)</option>}
            {installed.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} · {m.parameter_size ?? ''} · {fmtGo(m.size)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div>
        <div className="label mb-2">Modèles conseillés pour ton Mac</div>
        <div className="space-y-2">
          {LOCAL_SUGGESTIONS.map((m) => {
            const have = installed.some((x) => x.name === m.name);
            return (
              <div key={m.name} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px]">{m.name}</div>
                  <div className="text-[12px] text-ink-3">
                    {m.hint} · {m.size}
                  </div>
                </div>
                {have ? (
                  current === m.name ? <Badge tone="ok">Utilisé</Badge> : <Button size="sm" onClick={() => onModel(m.name)}>Utiliser</Button>
                ) : (
                  <Button size="sm" variant="primary" icon={<Download size={13} />} disabled={pulling !== null} onClick={() => void pull(m.name)}>
                    Télécharger
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {pulling && (
        <div>
          <div className="mb-1.5 flex justify-between text-[12.5px]">
            <span>
              Téléchargement de <span className="font-mono">{pulling.model}</span> · {pulling.status}
            </span>
            {pulling.ratio !== null && <span className="num">{Math.round(pulling.ratio * 100)} %</span>}
          </div>
          <ProgressBar value={pulling.ratio ?? 0} />
          <div className="mt-1 text-[11.5px] text-ink-3">Garde cette page ouverte. Plusieurs Go : quelques minutes selon ta connexion.</div>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim()) void pull(custom.trim());
        }}
      >
        <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Autre modèle (ex. llama3.1:8b, mistral-nemo)" className="!h-9 font-mono text-[12.5px]" />
        <Button type="submit" size="md" disabled={!custom.trim() || pulling !== null} icon={<Download size={13} />}>
          Installer
        </Button>
      </form>
    </div>
  );
}

function ClaudeSection({ ai, settings, onModel }: { ai?: AIStatus; settings?: Settings; onModel: (m: string) => void }) {
  const [key, setKey] = useState('');
  const saveKey = useAction(() => api('/ai/key', { body: { apiKey: key } }), { success: 'Clé enregistrée localement' });
  const removeKey = useAction(() => api('/ai/key', { method: 'DELETE' }), { success: 'Clé supprimée' });
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
        <KeyRound size={16} className="text-ink-3" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px]">Clé API Anthropic</div>
          <div className="font-mono text-[11.5px] text-ink-3">
            {ai?.key.configured ? `${ai.key.masked} · ${ai.key.source === 'env' ? 'depuis la variable d’environnement' : 'stockée dans data/secrets.json'}` : 'non configurée'}
          </div>
        </div>
        {ai?.key.source === 'file' && (
          <Button size="sm" variant="ghost" onClick={() => confirm('Supprimer la clé enregistrée ?') && removeKey.mutate(undefined)}>
            Supprimer
          </Button>
        )}
      </div>
      {ai?.key.source !== 'env' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveKey.mutate(undefined, { onSuccess: () => setKey('') });
          }}
        >
          <Field label={ai?.key.configured ? 'Remplacer la clé' : 'Ajouter ta clé'} hint="Crée une clé sur console.anthropic.com. Elle reste sur ton Mac (fichier protégé, jamais renvoyé à l’interface).">
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" className="font-mono" />
              <Button type="submit" variant="primary" disabled={!key.startsWith('sk-ant-')} loading={saveKey.isPending}>
                Enregistrer
              </Button>
            </div>
          </Field>
        </form>
      )}
      <Field label="Modèle Claude" hint={CLAUDE_MODELS.find((m) => m.id === settings?.ai_model)?.hint}>
        <Select value={settings?.ai_model ?? ''} onChange={(e) => onModel(e.target.value)}>
          {CLAUDE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
