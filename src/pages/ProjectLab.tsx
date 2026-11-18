import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CalendarClock, FolderKanban, Plus, Wallet } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { Link, navigate, useSearchParam } from '../lib/router';
import { cx, fmtDue, fmtMoney } from '../lib/format';
import type { Goal, ProjectSummary } from '../lib/types';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Panel, ProgressBar, Select, Skeleton, Tabs, Textarea } from '../components/ui';

export const STATUS_LABEL: Record<string, string> = { planning: 'Planification', active: 'Actif', paused: 'En pause', done: 'Terminé', archived: 'Archivé' };
export const HEALTH = { good: { label: 'Sain', tone: 'ok' }, watch: { label: 'À surveiller', tone: 'warn' }, critical: { label: 'Critique', tone: 'danger' } } as const;
const COLORS = ['#ff6b2c', '#8fb4ff', '#3ccf8e', '#e8b23a', '#e57fa8', '#b9a7ff', '#a5a49e'];

type Filter = 'current' | 'planning' | 'paused' | 'done' | 'all';

export function ProjectLab() {
  const [filter, setFilter] = useState<Filter>('current');
  const { data: projects, isLoading } = useApi<ProjectSummary[]>(['projects', 'all'], '/projects?archived=1');
  const newParam = useSearchParam('new');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (newParam) {
      setCreating(true);
      window.history.replaceState(null, '', '/projects');
    }
  }, [newParam]);

  const list = (projects ?? []).filter((p) =>
    filter === 'all' ? true : filter === 'current' ? p.status === 'active' : p.status === filter,
  );
  const counts = (s: Filter) => (projects ?? []).filter((p) => (s === 'all' ? true : s === 'current' ? p.status === 'active' : p.status === s)).length;
  const totals = (projects ?? []).filter((p) => p.status === 'active');
  const atRisk = totals.filter((p) => p.health !== 'good').length;

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-6 md:px-8 md:py-9">
      <PageHeader
        eyebrow="Project Lab"
        title="Laboratoire de projets"
        subtitle={projects ? `${totals.length} actifs · ${atRisk} à surveiller · progression moyenne ${totals.length ? Math.round((totals.reduce((s, p) => s + p.progress, 0) / totals.length) * 100) : 0} %` : ' '}
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            Nouveau projet
          </Button>
        }
      />
      <Tabs
        value={filter}
        onChange={setFilter}
        className="mb-6 max-w-full overflow-x-auto"
        items={(['current', 'planning', 'paused', 'done', 'all'] as Filter[]).map((f) => ({
          value: f,
          label: (
            <span>
              {f === 'current' ? 'Actifs' : f === 'all' ? 'Tous' : STATUS_LABEL[f]} <span className="ml-1 font-mono text-[10.5px] text-ink-3">{projects ? counts(f) : ''}</span>
            </span>
          ),
        }))}
      />
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState icon={<FolderKanban size={18} />} title="Aucun projet ici" text="Crée un projet, ou transforme une idée depuis l’Idea Engine." action={<Button icon={<Plus size={14} />} onClick={() => setCreating(true)}>Nouveau projet</Button>} />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
              <ProjectCard p={p} />
            </motion.div>
          ))}
        </div>
      )}
      <ProjectForm open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const due = fmtDue(p.due_date);
  const overBudget = p.budget_planned ? p.budget_spent / p.budget_planned : null;
  return (
    <Link to={`/projects/${p.id}`} className="panel panel-hover group relative flex h-full flex-col overflow-hidden p-5">
      <span className="absolute inset-x-0 top-0 h-[2px] opacity-70" style={{ background: `linear-gradient(90deg, ${p.color}, transparent)` }} />
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: p.color, boxShadow: `0 0 10px ${p.color}` }} />
        <span className="label !text-[10px]">{STATUS_LABEL[p.status]}</span>
        <span className="flex-1" />
        <Badge tone={HEALTH[p.health].tone}>{HEALTH[p.health].label}</Badge>
      </div>
      <h3 className="text-[16px] font-medium leading-snug tracking-[-0.01em]">{p.title}</h3>
      {p.objective && <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-3">{p.objective}</p>}
      <div className="mt-auto pt-5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[12px] text-ink-3">
            {p.milestones_total > 0 ? `${p.milestones_done}/${p.milestones_total} étapes` : `${p.tasks_done}/${p.tasks_done + p.tasks_open} tâches`}
          </span>
          <span className="num text-[13px]">{Math.round(p.progress * 100)} %</span>
        </div>
        <ProgressBar value={p.progress} color={p.color} />
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-3">
          {due && (
            <span className={cx('flex items-center gap-1.5', due.tone === 'late' && 'text-danger')}>
              <CalendarClock size={12} /> {due.text}
            </span>
          )}
          {p.budget_planned ? (
            <span className={cx('flex items-center gap-1.5', overBudget !== null && overBudget > 1 && 'text-danger')}>
              <Wallet size={12} /> {fmtMoney(p.budget_spent, p.currency)} / {fmtMoney(p.budget_planned, p.currency)}
            </span>
          ) : null}
          {p.tasks_overdue > 0 && (
            <span className="flex items-center gap-1.5 text-danger">
              <AlertTriangle size={12} /> {p.tasks_overdue} en retard
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ProjectForm({ open, onClose, project }: { open: boolean; onClose: () => void; project?: ProjectSummary }) {
  const { data: goals = [] } = useApi<Goal[]>(['goals'], '/goals', { enabled: open });
  const empty = { title: '', description: '', objective: '', status: 'planning', priority: 2, color: COLORS[0], budget_planned: '', currency: 'EUR', start_date: '', due_date: '', goal_id: '' };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (!open) return;
    setF(
      project
        ? {
            title: project.title,
            description: project.description,
            objective: project.objective,
            status: project.status,
            priority: project.priority,
            color: project.color,
            budget_planned: project.budget_planned?.toString() ?? '',
            currency: project.currency,
            start_date: project.start_date ?? '',
            due_date: project.due_date ?? '',
            goal_id: project.goal_id ?? '',
          }
        : empty,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = useAction(
    () => {
      const body = {
        ...f,
        priority: Number(f.priority),
        budget_planned: f.budget_planned === '' ? null : Number(f.budget_planned),
        start_date: f.start_date || null,
        due_date: f.due_date || null,
        goal_id: f.goal_id || null,
      };
      return project ? api(`/projects/${project.id}`, { method: 'PATCH', body }) : api<{ id: string }>('/projects', { body });
    },
    { success: project ? 'Projet mis à jour' : 'Projet créé' },
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={project ? 'Modifier le projet' : 'Nouveau projet'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!f.title.trim()}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: (r) => {
                  onClose();
                  if (!project) navigate(`/projects/${(r as { id: string }).id}`);
                },
              })
            }
          >
            {project ? 'Enregistrer' : 'Créer le projet'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Titre" className="sm:col-span-2">
          <Input value={f.title} onChange={set('title')} placeholder="Ex. Lancer ma newsletter" autoFocus />
        </Field>
        <Field label="Objectif" hint="Le résultat mesurable visé. C’est ce qui rend un projet évaluable." className="sm:col-span-2">
          <Input value={f.objective} onChange={set('objective')} placeholder="Ex. 500 abonnés d’ici juin" />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea rows={3} value={f.description} onChange={set('description')} />
        </Field>
        <Field label="Statut">
          <Select value={f.status} onChange={set('status')}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priorité">
          <Select value={f.priority} onChange={set('priority')}>
            <option value={1}>Haute</option>
            <option value={2}>Normale</option>
            <option value={3}>Basse</option>
          </Select>
        </Field>
        <Field label="Début">
          <Input type="date" value={f.start_date} onChange={set('start_date')} />
        </Field>
        <Field label="Échéance">
          <Input type="date" value={f.due_date} onChange={set('due_date')} />
        </Field>
        <Field label="Budget prévu">
          <Input type="number" min={0} value={f.budget_planned} onChange={set('budget_planned')} placeholder="Optionnel" />
        </Field>
        <Field label="Objectif lié">
          <Select value={f.goal_id} onChange={set('goal_id')}>
            <option value="">Aucun</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Couleur" className="sm:col-span-2">
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Couleur ${c}`}
                onClick={() => setF((x) => ({ ...x, color: c }))}
                className={cx('h-7 w-7 rounded-full transition-transform', f.color === c ? 'scale-110 ring-2 ring-white/60 ring-offset-2 ring-offset-overlay' : 'hover:scale-105')}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
