import { useEffect, useState } from 'react';
import { Check, Download, HardDrive, KeyRound, ShieldCheck, Trash2, AlertTriangle, Keyboard } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import type { AIStatus, Settings } from '../lib/types';
import { Badge, Button, Field, Input, Kbd, PageHeader, Panel, SectionHeader, Select, Toggle } from '../components/ui';
import { Core } from '../components/Core';
import { toast } from '../components/Toast';

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Recommandé · raisonnement solide, coût modéré' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Plus rapide et moins cher' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Très économique, analyses plus légères' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', hint: 'Le plus capable · nettement plus cher' },
];
const EFFORTS = [
  { id: 'low', label: 'Rapide' },
  { id: 'medium', label: 'Équilibré' },
  { id: 'high', label: 'Approfondi' },
  { id: 'xhigh', label: 'Très approfondi' },
  { id: 'max', label: 'Maximal' },
];

export function SettingsPage() {
  const { data: s } = useApi<Settings>(['settings'], '/settings');
  const { data: ai } = useApi<AIStatus>(['ai-status'], '/ai/status');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [key, setKey] = useState('');
  const [confirmText, setConfirmText] = useState('');
  useEffect(() => {
    if (s) (setName(s.user_name), setCurrency(s.currency));
  }, [s]);

  const patch = useAction((body: Partial<Settings>) => api('/settings', { method: 'PATCH', body }), { success: 'Réglage enregistré' });
  const saveKey = useAction(() => api('/ai/key', { body: { apiKey: key } }), { success: 'Clé enregistrée localement' });
  const removeKey = useAction(() => api('/ai/key', { method: 'DELETE' }), { success: 'Clé supprimée' });
  const verify = useAction(() => api<{ ok: boolean; model: string; name: string }>('/ai/verify', { body: {} }), { success: (r) => `Connexion réussie · ${r.name}` });
  const backup = useAction(() => api<{ file: string }>('/backup', { body: {} }), { success: (r) => `Sauvegarde créée : ${r.file.split('/').pop()}` });
  const reset = useAction(() => api<{ backup: string }>('/reset', { body: { confirm: confirmText } }), { success: 'Espace réinitialisé (une sauvegarde a été créée)' });

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 md:px-8 md:py-9">
      <PageHeader eyebrow="Système" title="Réglages" subtitle="Tout est stocké localement, sur ta machine." />
      <div className="space-y-4">
        {/* IA */}
        <Panel hud className="p-5 md:p-6">
          <SectionHeader title="Intelligence artificielle" action={<Core size={26} state={ai?.key.configured ? 'idle' : 'offline'} />} />
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-4">
            <KeyRound size={16} className="text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px]">Clé API Anthropic</div>
              <div className="font-mono text-[11.5px] text-ink-3">
                {ai?.key.configured ? `${ai.key.masked} · ${ai.key.source === 'env' ? 'depuis la variable d’environnement' : 'stockée dans data/secrets.json'}` : 'non configurée'}
              </div>
            </div>
            {ai?.key.configured ? <Badge tone="ok">Active</Badge> : <Badge>Hors ligne</Badge>}
            {ai?.key.configured && (
              <Button size="sm" icon={<ShieldCheck size={13} />} loading={verify.isPending} onClick={() => verify.mutate(undefined)}>
                Tester
              </Button>
            )}
            {ai?.key.source === 'file' && (
              <Button size="sm" variant="ghost" onClick={() => confirm('Supprimer la clé enregistrée ?') && removeKey.mutate(undefined)}>
                Supprimer
              </Button>
            )}
          </div>
          {ai?.key.source !== 'env' && (
            <form
              className="mb-6"
              onSubmit={(e) => {
                e.preventDefault();
                saveKey.mutate(undefined, { onSuccess: () => setKey('') });
              }}
            >
              <Field label={ai?.key.configured ? 'Remplacer la clé' : 'Ajouter ta clé'} hint="Crée une clé sur console.anthropic.com. Elle reste sur ta machine (fichier protégé, jamais renvoyé à l’interface) et n’est utilisée que lorsque tu sollicites l’IA.">
                <div className="flex gap-2">
                  <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" className="font-mono" />
                  <Button type="submit" variant="primary" disabled={!key.startsWith('sk-ant-')} loading={saveKey.isPending}>
                    Enregistrer
                  </Button>
                </div>
              </Field>
            </form>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Modèle" hint={MODELS.find((m) => m.id === s?.ai_model)?.hint}>
              <Select value={s?.ai_model ?? ''} onChange={(e) => patch.mutate({ ai_model: e.target.value })}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Effort de réflexion" hint="Plus d’effort = réponses plus fouillées, mais plus lentes et plus coûteuses.">
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
              <div className="mt-0.5 text-[12.5px] text-ink-3">Créer des tâches et projets, mémoriser, relier des éléments, enregistrer des données. Désactivé : l’IA peut seulement lire et proposer. Chaque action reste visible dans la conversation et le flux d’activité.</div>
            </div>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
            Coûts : chaque message, analyse ou briefing consomme des tokens facturés sur ton compte Anthropic. Aucun appel n’est fait sans action de ta part (le bouton « Tester » utilise l’API Models, gratuite).
          </p>
        </Panel>

        {/* Profil */}
        <Panel className="p-5 md:p-6">
          <SectionHeader title="Profil" />
          <div className="grid gap-4 sm:grid-cols-[1fr_160px_auto] sm:items-end">
            <Field label="Prénom">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </Field>
            <Field label="Devise">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {['EUR', 'USD', 'GBP', 'CHF', 'CAD'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Button icon={<Check size={14} />} onClick={() => patch.mutate({ user_name: name.trim(), currency })}>
              Enregistrer
            </Button>
          </div>
        </Panel>

        {/* Données */}
        <Panel className="p-5 md:p-6">
          <SectionHeader title="Données" action={<HardDrive size={14} className="text-ink-4" />} />
          <p className="mb-4 text-[13px] text-ink-2">
            Base SQLite locale : <code className="font-mono text-[12px] text-ink">data/nexus.db</code>. Sauvegarde ce dossier pour tout conserver.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export" className="focus-ring inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-white/[0.05] px-3.5 text-[13px] font-medium hover:bg-white/[0.08]" onClick={() => toast('Export JSON en cours de téléchargement')}>
              <Download size={14} /> Exporter en JSON
            </a>
            <Button icon={<HardDrive size={14} />} loading={backup.isPending} onClick={() => backup.mutate(undefined)}>
              Créer une sauvegarde
            </Button>
          </div>
          <div className="mt-6 rounded-xl border border-danger/25 bg-danger/[0.04] p-4">
            <div className="flex items-center gap-2 text-[13.5px] font-medium text-danger">
              <AlertTriangle size={14} /> Réinitialiser l’espace
            </div>
            <p className="mt-1 text-[12.5px] text-ink-2">Efface projets, tâches, idées, notes, mémoire, analytics, conversations et workflows. Une sauvegarde complète est créée automatiquement avant (dossier data/backups). Réglages et clé API conservés.</p>
            <div className="mt-3 flex gap-2">
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Tape EFFACER pour confirmer" className="!h-9 max-w-[260px]" />
              <Button variant="danger" icon={<Trash2 size={14} />} disabled={confirmText !== 'EFFACER'} loading={reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: () => setConfirmText('') })}>
                Réinitialiser
              </Button>
            </div>
          </div>
        </Panel>

        {/* Raccourcis */}
        <Panel className="p-5 md:p-6">
          <SectionHeader title="Raccourcis clavier" action={<Keyboard size={14} className="text-ink-4" />} />
          <div className="grid gap-x-8 gap-y-2.5 text-[13px] sm:grid-cols-2">
            {[
              [['⌘', 'K'], 'Palette de commandes'],
              [['N'], 'Capture rapide'],
              [['G', 'C'], 'Command Center'],
              [['G', 'A'], 'Nexus AI'],
              [['G', 'M'], 'Memory Graph'],
              [['G', 'P'], 'Project Lab'],
              [['G', 'T'], 'Tâches'],
              [['G', 'S'], 'Analytics'],
              [['G', 'I'], 'Idea Engine'],
              [['G', 'L'], 'Automation Lab'],
            ].map(([keys, label]) => (
              <div key={label as string} className="flex items-center justify-between">
                <span className="text-ink-2">{label as string}</span>
                <span className="flex gap-1">
                  {(keys as string[]).map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
