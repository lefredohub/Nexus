import { useEffect, useState } from 'react';
import { Check, Download, HardDrive, Trash2, AlertTriangle, Keyboard } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import type { AIStatus, Settings } from '../lib/types';
import { Button, Field, Input, Kbd, PageHeader, Panel, SectionHeader, Select } from '../components/ui';
import { toast } from '../components/Toast';
import { RemoteAccessPanel, ThisDevicePanel } from './RemoteAccess';
import { AISettingsPanel } from './AISettings';

export function SettingsPage() {
  const { data: s } = useApi<Settings>(['settings'], '/settings');
  const { data: ai } = useApi<AIStatus>(['ai-status'], '/ai/status');
  const isMac = ai?.mode !== 'remote';
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [confirmText, setConfirmText] = useState('');
  useEffect(() => {
    if (s) (setName(s.user_name), setCurrency(s.currency));
  }, [s]);

  const patch = useAction((body: Partial<Settings>) => api('/settings', { method: 'PATCH', body }), { success: 'Réglage enregistré' });
  const backup = useAction(() => api<{ file: string }>('/backup', { body: {} }), { success: (r) => `Sauvegarde créée : ${r.file.split('/').pop()}` });
  // Espace vide ? On propose de charger la démo (sinon elle n'est accessible qu'au tout premier lancement).
  const { data: demo } = useApi<{ empty: boolean }>(['demo'], '/demo');
  const loadDemo = useAction(() => api('/demo', { body: {} }), { success: 'Données de démonstration chargées' });
  const reset = useAction(() => api<{ backup: string }>('/reset', { body: { confirm: confirmText } }), { success: 'Espace réinitialisé (une sauvegarde a été créée)' });

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 md:px-8 md:py-9">
      <PageHeader eyebrow="Système" title="Réglages" subtitle="Tout est stocké localement, sur ta machine." />
      <div className="space-y-4">
        {/* IA : locale (Ollama) ou Claude */}
        <AISettingsPanel isMac={isMac} />

        {/* Accès depuis l'iPhone : réglable seulement sur le Mac */}
        {isMac ? <RemoteAccessPanel /> : <ThisDevicePanel />}

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

        {/* Données (sur le Mac uniquement) */}
        {isMac && (
        <Panel className="p-5 md:p-6">
          <SectionHeader title="Données" action={<HardDrive size={14} className="text-ink-4" />} />
          <p className="mb-4 text-[13px] text-ink-2">
            Base SQLite locale : <code className="font-mono text-[12px] text-ink">data/nexus.db</code>. Sauvegarde ce dossier pour tout conserver.
          </p>
          {demo?.empty && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-ion/30 bg-ion/[0.05] p-4">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">Ton espace est vide</div>
                <div className="text-[12.5px] text-ink-3">Charge des données fictives (projets, sport, finances, habitudes) pour découvrir NEXUS. Tu pourras tout effacer ensuite avec « Réinitialiser l’espace ».</div>
              </div>
              <Button variant="primary" loading={loadDemo.isPending} onClick={() => loadDemo.mutate(undefined)}>
                Charger la démo
              </Button>
            </div>
          )}
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
        )}

        {/* Raccourcis */}
        <Panel className="p-5 md:p-6">
          <SectionHeader title="Raccourcis clavier" action={<Keyboard size={14} className="text-ink-4" />} />
          <div className="grid gap-x-8 gap-y-2.5 text-[13px] sm:grid-cols-2">
            {[
              [['⌘', 'K'], 'Palette de commandes'],
              [['N'], 'Capture rapide'],
              [['G', 'C'], 'Command Center'],
              [['G', 'A'], 'Nexus AI'],
              [['G', 'J'], 'Jarvis (voix)'],
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
