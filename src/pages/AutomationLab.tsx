import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Bot, Brain, CheckSquare, ChevronDown, ChevronUp, Clock, FlaskConical, Gauge, GitBranch, Globe, Hand, Play, Plus, Save, StickyNote, Trash2, Workflow, Zap, X, CircleCheck, CircleX, CircleDashed, CirclePause } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { cx, relTime } from '../lib/format';
import type { Automation, AutomationRun, StepCatalogItem } from '../lib/types';
import { Badge, Button, EmptyState, Field, IconButton, Input, Modal, PageHeader, Panel, Select, SectionHeader, Textarea, Toggle } from '../components/ui';

type Draft = Pick<Automation, 'name' | 'description' | 'enabled' | 'trigger' | 'steps'>;

const STEP_ICON: Record<string, typeof Bell> = { create_task: CheckSquare, create_note: StickyNote, notify: Bell, remember: Brain, log_metric: Gauge, ai_prompt: Bot, http_request: Globe, condition: GitBranch };
const CATEGORY_COLOR: Record<string, string> = { nexus: '#8fb4ff', ai: '#ff6b2c', logic: '#e8b23a', external: '#3ccf8e' };
const EVENT_LABEL: Record<string, string> = {
  'task.created': 'Une tâche est créée',
  'task.completed': 'Une tâche est terminée',
  'project.created': 'Un projet est créé',
  'idea.created': 'Une idée est déposée',
  'workout.logged': 'Une séance est enregistrée',
  'transaction.logged': 'Une opération est enregistrée',
};
const EVENT_VARS: Record<string, string[]> = {
  'task.created': ['trigger.task.title', 'trigger.task.priority', 'trigger.task.project_title'],
  'task.completed': ['trigger.task.title', 'trigger.task.project_title'],
  'project.created': ['trigger.project.title', 'trigger.project.objective'],
  'idea.created': ['trigger.idea.content'],
  'workout.logged': ['trigger.workout.type', 'trigger.workout.duration_min'],
  'transaction.logged': ['trigger.transaction.amount', 'trigger.transaction.category', 'trigger.transaction.label'],
};

function triggerText(t: Automation['trigger']): string {
  if (t.type === 'manual') return 'Lancement manuel';
  if (t.type === 'event') return EVENT_LABEL[t.event] ?? t.event;
  const unit = { minutes: 'minute', hours: 'heure', days: 'jour' }[t.unit];
  return `Toutes les ${t.every > 1 ? `${t.every} ${unit}s` : unit}${t.unit === 'days' && t.at ? ` à ${t.at}` : ''}`;
}

export function AutomationLab({ selectedId }: { selectedId?: string }) {
  const { data: automations = [] } = useApi<Automation[]>(['automations'], '/automations');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!selectedId && automations.length) navigate(`/automations/${automations[0].id}`, { replace: true });
  }, [selectedId, automations]);

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-6 md:px-8 md:py-9">
      <PageHeader
        eyebrow="Automation Lab"
        title="Workflows"
        subtitle="Conçois des enchaînements : un déclencheur, des étapes, des données qui circulent. Simule avant d’exécuter."
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            Nouveau workflow
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-3">
          {automations.length === 0 && (
            <Panel>
              <EmptyState icon={<Workflow size={18} />} title="Aucun workflow" />
            </Panel>
          )}
          {automations.map((a) => (
            <Link key={a.id} to={`/automations/${a.id}`} className={cx('panel panel-hover block p-3.5', a.id === selectedId && '!border-signal/40 !bg-signal/[0.04]')}>
              <div className="flex items-center gap-2">
                <span className={cx('h-1.5 w-1.5 rounded-full', a.enabled ? 'bg-ok shadow-[0_0_6px_var(--color-ok)]' : 'bg-ink-4')} />
                <span className="flex-1 truncate text-[13.5px] font-medium">{a.name}</span>
                {a.last_status === 'error' && <CircleX size={13} className="text-danger" />}
              </div>
              <div className="mt-1 truncate pl-3.5 text-[11.5px] text-ink-3">{triggerText(a.trigger)}</div>
              <div className="mt-1 pl-3.5 font-mono text-[10px] text-ink-3">
                {a.steps.length} étape{a.steps.length > 1 ? 's' : ''} · {a.run_count ?? 0} exécution{(a.run_count ?? 0) > 1 ? 's' : ''}
              </div>
            </Link>
          ))}
        </div>
        <div className="lg:col-span-9">{selectedId && <Editor key={selectedId} id={selectedId} />}</div>
      </div>
      <CreateModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const create = useAction(() => api<Automation>('/automations', { body: { name, trigger: { type: 'manual' }, steps: [] } }), { success: 'Workflow créé' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau workflow"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => create.mutate(undefined, { onSuccess: (a) => (onClose(), setName(''), navigate(`/automations/${a.id}`)) })}>
            Créer
          </Button>
        </>
      }
    >
      <Field label="Nom">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Revue du dimanche" autoFocus />
      </Field>
    </Modal>
  );
}

function Editor({ id }: { id: string }) {
  const { data } = useApi<Automation & { runs: AutomationRun[] }>(['automation', id], `/automations/${id}`);
  const { data: catalog } = useApi<{ steps: StepCatalogItem[]; events: string[] }>(['automation-catalog'], '/automations/catalog');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string | 'trigger' | null>('trigger');
  const [adding, setAdding] = useState(false);
  const [lastRun, setLastRun] = useState<AutomationRun | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft({ name: data.name, description: data.description, enabled: data.enabled, trigger: data.trigger, steps: data.steps });
  }, [data, draft]);

  const dirty = useMemo(() => data && draft && JSON.stringify({ name: data.name, description: data.description, enabled: data.enabled, trigger: data.trigger, steps: data.steps }) !== JSON.stringify(draft), [data, draft]);
  const save = useAction(() => api<Automation>(`/automations/${id}`, { method: 'PATCH', body: draft }), { success: 'Workflow enregistré' });
  const runIt = useAction((dryRun: boolean) => api<AutomationRun>(`/automations/${id}/run`, { body: { dryRun } }), { success: (r) => (r.dry_run ? 'Simulation terminée' : r.status === 'success' ? 'Exécution réussie' : r.status === 'stopped' ? 'Arrêt sur condition' : 'Exécution en échec') });
  const del = useAction(() => api(`/automations/${id}`, { method: 'DELETE' }), { success: 'Workflow supprimé' });

  if (!draft || !catalog) return <Panel className="h-96 animate-pulse" />;
  const byType = new Map(catalog.steps.map((s) => [s.type, s]));
  const runLog = lastRun?.log ?? [];
  const statusOf = (stepId: string) => runLog.find((l) => l.step_id === stepId)?.status;
  const running = runIt.isPending;

  const setStep = (sid: string, patch: Partial<Draft['steps'][number]>) => setDraft((d) => d && { ...d, steps: d.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const steps = [...d.steps];
      const j = i + dir;
      if (j < 0 || j >= steps.length) return d;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });
  const addStep = (type: string) => {
    const base = type.replace(/_.*/, '');
    let n = 1;
    while (draft.steps.some((s) => s.id === `${base}${n}`)) n++;
    const sid = `${base}${n}`;
    setDraft({ ...draft, steps: [...draft.steps, { id: sid, type, name: byType.get(type)?.label ?? type, config: {} }] });
    setSelected(sid);
    setAdding(false);
  };

  const selectedStep = draft.steps.find((s) => s.id === selected);
  const prevVars = (sid?: string) => {
    const idx = sid ? draft.steps.findIndex((s) => s.id === sid) : draft.steps.length;
    const fromTrigger = draft.trigger.type === 'event' ? EVENT_VARS[draft.trigger.event] ?? [] : draft.trigger.type === 'schedule' ? ['trigger.scheduled_at'] : [];
    return ['today', 'now', ...fromTrigger, ...draft.steps.slice(0, Math.max(0, idx)).map((s) => `steps.${s.id}.output`)];
  };

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full bg-transparent text-[22px] font-semibold tracking-[-0.02em] outline-none" aria-label="Nom" />
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description…" className="w-full bg-transparent text-[13.5px] text-ink-2 outline-none placeholder:text-ink-3" aria-label="Description" />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="Activé" />
            {draft.enabled ? 'Activé' : 'Désactivé'}
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" icon={<Save size={14} />} disabled={!dirty || !draft.name.trim()} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Enregistrer
          </Button>
          <Button icon={<FlaskConical size={14} />} disabled={Boolean(dirty) || running || draft.steps.length === 0} onClick={() => runIt.mutate(true, { onSuccess: setLastRun })} title={dirty ? 'Enregistre avant de simuler' : 'Résout les variables et valide chaque étape sans effet réel'}>
            Simuler
          </Button>
          <Button icon={<Play size={14} />} disabled={Boolean(dirty) || running || draft.steps.length === 0} onClick={() => confirm('Exécuter réellement ce workflow ? Les étapes auront des effets (création, appels API…).') && runIt.mutate(false, { onSuccess: setLastRun })}>
            Exécuter
          </Button>
          {dirty && <span className="text-[12px] text-warn">Modifications non enregistrées</span>}
          <span className="flex-1" />
          <IconButton label="Supprimer le workflow" onClick={() => confirm('Supprimer ce workflow et son historique ?') && del.mutate(undefined, { onSuccess: () => navigate('/automations') })}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-12">
        {/* Canevas du flux */}
        <Panel className="relative overflow-hidden p-6 xl:col-span-7">
          <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
          <div className="relative mx-auto flex max-w-[420px] flex-col items-stretch">
            <FlowNode
              active={selected === 'trigger'}
              onClick={() => setSelected('trigger')}
              icon={draft.trigger.type === 'manual' ? Hand : draft.trigger.type === 'schedule' ? Clock : Zap}
              color="#ff6b2c"
              kicker="Déclencheur"
              title={triggerText(draft.trigger)}
            />
            {draft.steps.map((s, i) => {
              const def = byType.get(s.type);
              const st = statusOf(s.id);
              return (
                <div key={s.id} className="flex flex-col items-stretch">
                  <Connector live={running} status={st} />
                  <FlowNode
                    active={selected === s.id}
                    onClick={() => setSelected(s.id)}
                    icon={STEP_ICON[s.type] ?? Workflow}
                    color={CATEGORY_COLOR[def?.category ?? 'nexus']}
                    kicker={`${String(i + 1).padStart(2, '0')} · ${def?.label ?? s.type}`}
                    title={s.name || def?.label || s.type}
                    status={st}
                    tag={s.id}
                    actions={
                      <div className="flex flex-col">
                        <button aria-label="Monter" onClick={(e) => (e.stopPropagation(), move(i, -1))} className="text-ink-4 hover:text-ink">
                          <ChevronUp size={13} />
                        </button>
                        <button aria-label="Descendre" onClick={(e) => (e.stopPropagation(), move(i, 1))} className="text-ink-4 hover:text-ink">
                          <ChevronDown size={13} />
                        </button>
                      </div>
                    }
                  />
                </div>
              );
            })}
            <Connector />
            <button onClick={() => setAdding(true)} className="mx-auto flex h-10 items-center gap-2 rounded-full border border-dashed border-line-strong px-4 text-[12.5px] text-ink-2 transition-colors hover:border-signal/60 hover:text-ink">
              <Plus size={14} /> Ajouter une étape
            </button>
          </div>
        </Panel>

        {/* Inspecteur */}
        <Panel className="p-5 xl:col-span-5">
          {selected === 'trigger' ? (
            <TriggerEditor trigger={draft.trigger} events={catalog.events} onChange={(t) => setDraft({ ...draft, trigger: t })} />
          ) : selectedStep ? (
            <StepEditor
              step={selectedStep}
              def={byType.get(selectedStep.type)}
              vars={prevVars(selectedStep.id)}
              onChange={(patch) => setStep(selectedStep.id, patch)}
              onDelete={() => (setDraft({ ...draft, steps: draft.steps.filter((s) => s.id !== selectedStep.id) }), setSelected('trigger'))}
            />
          ) : (
            <EmptyState title="Sélectionne un nœud" />
          )}
        </Panel>
      </div>

      <RunHistory runs={data?.runs ?? []} highlight={lastRun?.id} />

      <Modal open={adding} onClose={() => setAdding(false)} title="Ajouter une étape" wide>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalog.steps.map((s) => {
            const Icon = STEP_ICON[s.type] ?? Workflow;
            return (
              <button key={s.type} onClick={() => addStep(s.type)} className="panel panel-hover flex items-start gap-3 p-3.5 text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${CATEGORY_COLOR[s.category]}1f`, color: CATEGORY_COLOR[s.category] }}>
                  <Icon size={15} />
                </span>
                <div>
                  <div className="text-[13.5px] font-medium">{s.label}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">{s.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}

function Connector({ live, status }: { live?: boolean; status?: string }) {
  const color = status === 'error' ? 'var(--color-danger)' : status === 'success' || status === 'simulated' ? 'var(--color-signal)' : 'rgb(255 255 255 / 0.14)';
  return (
    <div className="relative mx-auto h-8 w-px" style={{ background: color }}>
      {live && <motion.span className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-signal shadow-[0_0_10px_#ff6b2c]" initial={{ top: 0, opacity: 0 }} animate={{ top: '100%', opacity: [0, 1, 0] }} transition={{ duration: 0.9, repeat: Infinity }} />}
    </div>
  );
}

function FlowNode({ icon: Icon, color, kicker, title, active, onClick, status, tag, actions }: { icon: typeof Bell; color: string; kicker: string; title: string; active: boolean; onClick: () => void; status?: string; tag?: string; actions?: React.ReactNode }) {
  const StatusIcon = status === 'success' ? CircleCheck : status === 'error' ? CircleX : status === 'simulated' ? CircleDashed : status === 'stopped' ? CirclePause : null;
  return (
    <motion.div
      layout
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={cx('panel relative flex cursor-pointer items-center gap-3 p-3.5 transition-all', active ? '!border-signal/50 shadow-[0_0_0_3px_rgb(255_107_44/0.1)]' : 'hover:!border-line-strong')}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: `${color}1f`, color, boxShadow: active ? `0 0 18px ${color}40` : 'none' }}>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="label !text-[9.5px]">{kicker}</div>
        <div className="truncate text-[13.5px] font-medium">{title}</div>
      </div>
      {tag && <span className="hidden font-mono text-[10px] text-ink-3 sm:inline">{tag}</span>}
      {StatusIcon && <StatusIcon size={15} className={cx(status === 'error' ? 'text-danger' : status === 'stopped' ? 'text-warn' : 'text-signal')} />}
      {actions}
    </motion.div>
  );
}

function TriggerEditor({ trigger, events, onChange }: { trigger: Automation['trigger']; events: string[]; onChange: (t: Automation['trigger']) => void }) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Déclencheur" />
      <Field label="Type">
        <Select
          value={trigger.type}
          onChange={(e) => {
            const t = e.target.value;
            onChange(t === 'manual' ? { type: 'manual' } : t === 'schedule' ? { type: 'schedule', every: 1, unit: 'days', at: '08:00' } : { type: 'event', event: 'task.completed' });
          }}
        >
          <option value="manual">Manuel</option>
          <option value="schedule">Planifié</option>
          <option value="event">Sur événement</option>
        </Select>
      </Field>
      {trigger.type === 'schedule' && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Tous les">
            <Input type="number" min={1} value={trigger.every} onChange={(e) => onChange({ ...trigger, every: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
          <Field label="Unité">
            <Select value={trigger.unit} onChange={(e) => onChange({ ...trigger, unit: e.target.value as 'minutes' | 'hours' | 'days' })}>
              <option value="minutes">minutes</option>
              <option value="hours">heures</option>
              <option value="days">jours</option>
            </Select>
          </Field>
          {trigger.unit === 'days' && (
            <Field label="À">
              <Input type="time" value={trigger.at ?? '08:00'} onChange={(e) => onChange({ ...trigger, at: e.target.value })} />
            </Field>
          )}
        </div>
      )}
      {trigger.type === 'event' && (
        <Field label="Événement">
          <Select value={trigger.event} onChange={(e) => onChange({ ...trigger, event: e.target.value as typeof trigger.event })}>
            {events.map((ev) => (
              <option key={ev} value={ev}>
                {EVENT_LABEL[ev] ?? ev}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <p className="text-[12px] leading-relaxed text-ink-3">
        {trigger.type === 'schedule'
          ? 'Les workflows planifiés s’exécutent tant que NEXUS est lancé sur ta machine.'
          : trigger.type === 'event'
            ? 'Le workflow réagit aux actions faites dans NEXUS (par toi ou par l’IA). Les actions faites par un workflow ne déclenchent pas d’autres workflows, pour éviter les boucles.'
            : 'Lance ce workflow avec le bouton « Exécuter ».'}
      </p>
    </div>
  );
}

function StepEditor({ step, def, vars, onChange, onDelete }: { step: Draft['steps'][number]; def?: StepCatalogItem; vars: string[]; onChange: (p: Partial<Draft['steps'][number]>) => void; onDelete: () => void }) {
  if (!def) return <EmptyState title={`Étape inconnue : ${step.type}`} action={<Button variant="danger" onClick={onDelete}>Retirer</Button>} />;
  const value = (k: string) => (step.config[k] === undefined || step.config[k] === null ? '' : String(step.config[k]));
  const set = (k: string, v: string) => onChange({ config: { ...step.config, [k]: v } });
  return (
    <div className="space-y-4">
      <SectionHeader title={def.label} action={<Badge tone={def.sideEffect ? 'warn' : 'neutral'}>{def.sideEffect ? 'Effet réel' : 'Sans effet'}</Badge>} />
      <p className="-mt-1 text-[12.5px] text-ink-3">{def.description}</p>
      <Field label="Nom de l’étape">
        <Input value={step.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      {def.fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.help}>
          {f.type === 'textarea' ? (
            <Textarea rows={4} value={value(f.key)} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className="font-mono text-[12.5px]" />
          ) : f.type === 'select' ? (
            <Select value={value(f.key)} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">—</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input type={f.type === 'number' ? 'number' : 'text'} value={value(f.key)} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
          )}
        </Field>
      ))}
      <div>
        <div className="label mb-1.5">Variables disponibles</div>
        <div className="flex flex-wrap gap-1.5">
          {vars.map((v) => (
            <button key={v} onClick={() => navigator.clipboard?.writeText(`{{${v}}}`)} title="Copier" className="rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2 hover:border-signal/50 hover:text-ink">
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-between border-t border-line pt-3">
        <span className="font-mono text-[10.5px] text-ink-3">id : {step.id}</span>
        <Button size="sm" variant="danger" icon={<X size={13} />} onClick={onDelete}>
          Retirer l’étape
        </Button>
      </div>
    </div>
  );
}

function RunHistory({ runs, highlight }: { runs: AutomationRun[]; highlight?: string }) {
  const [open, setOpen] = useState<string | null>(highlight ?? null);
  useEffect(() => {
    if (highlight) setOpen(highlight);
  }, [highlight]);
  const TONE = { success: 'ok', error: 'danger', stopped: 'warn', running: 'ion' } as const;
  const LABEL = { success: 'Réussi', error: 'Échec', stopped: 'Arrêté', running: 'En cours' } as const;
  return (
    <Panel className="p-5">
      <SectionHeader title="Historique d’exécution" />
      {runs.length === 0 && <div className="text-[13px] text-ink-3">Aucune exécution. Commence par une simulation.</div>}
      <div className="space-y-1.5">
        {runs.map((r) => (
          <div key={r.id} className={cx('rounded-xl border border-line', r.id === highlight && '!border-signal/40')}>
            <button onClick={() => setOpen((o) => (o === r.id ? null : r.id))} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px]">
              <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
              {r.dry_run && <Badge>Simulation</Badge>}
              <span className="flex-1 truncate text-ink-3">{r.error ?? `${r.log.length} étape(s)`}</span>
              <span className="font-mono text-[10.5px] text-ink-3">{relTime(r.started_at)}</span>
            </button>
            <AnimatePresence>
              {open === r.id && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className="space-y-2 border-t border-line p-3">
                    {r.log.map((l) => (
                      <div key={l.step_id} className="rounded-lg bg-black/20 p-2.5 font-mono text-[11.5px]">
                        <div className="flex items-center gap-2">
                          <span className={cx(l.status === 'error' ? 'text-danger' : l.status === 'stopped' ? 'text-warn' : l.status === 'simulated' ? 'text-ion' : 'text-ok')}>●</span>
                          <span className="text-ink">{l.name}</span>
                          <span className="text-ink-3">{l.type}</span>
                          <span className="flex-1" />
                          <span className="text-ink-3">{l.duration_ms} ms</span>
                        </div>
                        {l.note && <div className="mt-1 text-ink-3">{l.note}</div>}
                        {l.error && <div className="mt-1 text-danger">{l.error}</div>}
                        {l.input !== undefined && <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap text-ink-3">→ {JSON.stringify(l.input, null, 1)}</pre>}
                        {l.output !== undefined && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-ink-2">← {typeof l.output === 'string' ? l.output : JSON.stringify(l.output, null, 1)}</pre>}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </Panel>
  );
}
