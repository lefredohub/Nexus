import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Check, Pencil, Plus, ShieldAlert, Sparkles, Trash2, Wallet, Target, Link2, ListChecks, Milestone as MilestoneIcon, NotebookPen, CircleDot } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { cx, fmtDate, fmtDue, fmtMoney, relTime, todayISO } from '../lib/format';
import type { AIStatus, ProjectAnalysis, ProjectDetail } from '../lib/types';
import { ENTITY } from '../lib/entities';
import { Badge, Button, EmptyState, IconButton, Input, Panel, ProgressBar, Ring, SectionHeader, Select, Skeleton, Textarea } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { Core } from '../components/Core';
import { HEALTH, ProjectForm, STATUS_LABEL } from './ProjectLab';

const SEVERITY = { high: { label: 'Élevé', tone: 'danger' }, medium: { label: 'Moyen', tone: 'warn' }, low: { label: 'Faible', tone: 'neutral' } } as const;

export function ProjectDetailPage({ id }: { id: string }) {
  const { data: p, isLoading, error } = useApi<ProjectDetail>(['project', id], `/projects/${id}`);
  const [editing, setEditing] = useState(false);
  const status = useAction((s: string) => api(`/projects/${id}`, { method: 'PATCH', body: { status: s } }));
  const remove = useAction(() => api(`/projects/${id}`, { method: 'DELETE' }), { success: 'Projet supprimé' });

  if (error) return <EmptyState title="Projet introuvable" action={<Button onClick={() => navigate('/projects')}>Retour</Button>} />;
  if (isLoading || !p)
    return (
      <div className="mx-auto max-w-[1320px] space-y-4 px-4 py-9 md:px-8">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    );

  const budgetRatio = p.budget_planned ? p.budget_spent / p.budget_planned : 0;
  const due = fmtDue(p.due_date);

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-6 md:px-8 md:py-9">
      <Link to="/projects" className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> Project Lab
      </Link>

      {/* En-tête */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color, boxShadow: `0 0 12px ${p.color}` }} />
            <Badge tone={HEALTH[p.health].tone}>{HEALTH[p.health].label}</Badge>
            {p.goal_title && (
              <Badge tone="neutral">
                <Target size={10} /> {p.goal_title}
              </Badge>
            )}
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] md:text-[36px]">{p.title}</h1>
          {p.objective && <p className="mt-2 max-w-3xl text-[15px] text-ink-2">{p.objective}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Select value={p.status} onChange={(e) => status.mutate(e.target.value)} className="!h-9 !w-auto !py-0 text-[13px]">
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Button icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
            Modifier
          </Button>
          <IconButton
            label="Supprimer le projet"
            onClick={() => {
              if (confirm(`Supprimer définitivement « ${p.title} » ? Les tâches liées seront conservées sans projet.`)) remove.mutate(undefined, { onSuccess: () => navigate('/projects') });
            }}
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      </header>

      {/* Chiffres clés */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Panel className="flex items-center gap-4 p-4" hud>
          <Ring value={p.progress} size={54} stroke={3.5} color={p.color}>
            <span className="num text-[13px]">{Math.round(p.progress * 100)}</span>
          </Ring>
          <div>
            <div className="label">Progression</div>
            <div className="mt-1 text-[12.5px] text-ink-2">{p.milestones_total ? `${p.milestones_done}/${p.milestones_total} étapes` : `${p.tasks_done}/${p.tasks_done + p.tasks_open} tâches`}</div>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="label">Échéance</div>
          <div className={cx('num mt-2 text-[20px]', due?.tone === 'late' && 'text-danger')}>{p.due_date ? fmtDate(p.due_date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
          <div className="mt-1 text-[12px] text-ink-3">{due?.text ?? 'non définie'}</div>
        </Panel>
        <Panel className="p-4">
          <div className="label">Budget</div>
          <div className={cx('num mt-2 text-[20px]', budgetRatio > 1 && 'text-danger')}>{fmtMoney(p.budget_spent, p.currency)}</div>
          {p.budget_planned ? (
            <>
              <ProgressBar value={Math.min(1, budgetRatio)} color={budgetRatio > 1 ? 'var(--color-danger)' : budgetRatio > 0.9 ? 'var(--color-warn)' : 'var(--color-s2)'} className="mt-2" />
              <div className="mt-1 text-[12px] text-ink-3">sur {fmtMoney(p.budget_planned, p.currency)} prévus</div>
            </>
          ) : (
            <div className="mt-1 text-[12px] text-ink-3">aucun budget prévu</div>
          )}
        </Panel>
        <Panel className="p-4">
          <div className="label">Tâches</div>
          <div className="num mt-2 text-[20px]">{p.tasks_open}</div>
          <div className={cx('mt-1 text-[12px]', p.tasks_overdue ? 'text-danger' : 'text-ink-3')}>{p.tasks_overdue ? `${p.tasks_overdue} en retard` : `${p.tasks_done} terminées`}</div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          {p.description && (
            <Panel className="p-5">
              <SectionHeader title="Description" />
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{p.description}</p>
            </Panel>
          )}
          <Milestones p={p} />
          <ProjectTasks p={p} />
          <Notes p={p} />
        </div>
        <div className="space-y-4 lg:col-span-5">
          <AnalysisPanel p={p} />
          <Risks p={p} />
          <Budget p={p} />
          <Connections p={p} />
        </div>
      </div>

      <ProjectForm open={editing} onClose={() => setEditing(false)} project={p} />
    </div>
  );
}

function Milestones({ p }: { p: ProjectDetail }) {
  const [title, setTitle] = useState('');
  const add = useAction(() => api(`/projects/${p.id}/milestones`, { body: { title } }));
  const toggle = useAction(({ id, done }: { id: string; done: boolean }) => api(`/milestones/${id}`, { method: 'PATCH', body: { done } }));
  const del = useAction((id: string) => api(`/milestones/${id}`, { method: 'DELETE' }));
  return (
    <Panel className="p-5">
      <SectionHeader title={`Étapes · ${p.milestones_done}/${p.milestones_total}`} action={<MilestoneIcon size={14} className="text-ink-4" />} />
      <ol className="relative">
        {p.milestones.map((m, i) => (
          <li key={m.id} className="group relative flex items-start gap-3 pb-3 last:pb-0">
            {i < p.milestones.length - 1 && <span className={cx('absolute left-[10px] top-6 h-[calc(100%-18px)] w-px', m.done ? 'bg-signal/40' : 'bg-line')} />}
            <button
              aria-label={m.done ? 'Rouvrir l’étape' : 'Valider l’étape'}
              onClick={() => toggle.mutate({ id: m.id, done: !m.done })}
              className={cx('relative z-10 mt-0.5 flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-full border transition-all', m.done ? 'border-signal bg-signal text-black' : 'border-line-strong bg-base hover:border-signal')}
            >
              {m.done ? <Check size={11} strokeWidth={3} /> : <span className="num text-[9.5px] text-ink-3">{i + 1}</span>}
            </button>
            <div className={cx('flex-1 pt-0.5 text-[13.5px]', m.done ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{m.title}</div>
            <button aria-label="Supprimer l’étape" onClick={() => del.mutate(m.id)} className="mt-1 text-ink-4 opacity-0 hover:text-danger group-hover:opacity-100">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ol>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) add.mutate(undefined, { onSuccess: () => setTitle('') });
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ajouter une étape…" className="!h-9" />
        <Button type="submit" size="md" icon={<Plus size={14} />} disabled={!title.trim()}>
          Ajouter
        </Button>
      </form>
    </Panel>
  );
}

function ProjectTasks({ p }: { p: ProjectDetail }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const add = useAction(() => api('/tasks', { body: { title, project_id: p.id, due_date: due || null } }));
  const del = useAction((id: string) => api(`/tasks/${id}`, { method: 'DELETE' }));
  const open = p.tasks.filter((t) => t.status !== 'done');
  const done = p.tasks.filter((t) => t.status === 'done');
  const [showDone, setShowDone] = useState(false);
  return (
    <Panel className="p-5">
      <SectionHeader title={`Prochaines actions · ${open.length}`} action={<ListChecks size={14} className="text-ink-4" />} />
      {open.length === 0 && <div className="py-3 text-[13px] text-ink-3">Aucune action ouverte. Un projet sans prochaine action n’avance pas : ajoute-en une.</div>}
      <div className="-mx-2.5">
        {open.map((t) => (
          <TaskRow key={t.id} task={t} showProject={false} onDelete={(x) => del.mutate(x.id)} />
        ))}
      </div>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) add.mutate(undefined, { onSuccess: () => (setTitle(''), setDue('')) });
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvelle action…" className="!h-9 min-w-0 flex-1" />
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="!h-9 !w-[150px]" aria-label="Échéance" />
        <Button type="submit" icon={<Plus size={14} />} disabled={!title.trim()}>
          Ajouter
        </Button>
      </form>
      {done.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <button onClick={() => setShowDone((v) => !v)} className="text-[12px] text-ink-3 hover:text-ink">
            {showDone ? 'Masquer' : 'Afficher'} les {done.length} tâches terminées
          </button>
          {showDone && (
            <div className="-mx-2.5 mt-2">
              {done.map((t) => (
                <TaskRow key={t.id} task={t} showProject={false} onDelete={(x) => del.mutate(x.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Notes({ p }: { p: ProjectDetail }) {
  const [text, setText] = useState(p.notes);
  useEffect(() => setText(p.notes), [p.notes]);
  const save = useAction(() => api(`/projects/${p.id}`, { method: 'PATCH', body: { notes: text } }), { success: 'Notes enregistrées' });
  const dirty = text !== p.notes;
  return (
    <Panel className="p-5">
      <SectionHeader title="Notes" action={dirty ? <Button size="sm" variant="primary" onClick={() => save.mutate(undefined)} loading={save.isPending}>Enregistrer</Button> : <NotebookPen size={14} className="text-ink-4" />} />
      <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => dirty && save.mutate(undefined)} placeholder="Réflexions, décisions, liens utiles…" className="!bg-transparent font-[inherit] leading-relaxed" />
    </Panel>
  );
}

function AnalysisPanel({ p }: { p: ProjectDetail }) {
  const { data: status } = useApi<AIStatus>(['ai-status'], '/ai/status');
  const analyze = useAction(() => api<ProjectAnalysis>(`/projects/${p.id}/analyze`, { body: {} }), { success: 'Analyse terminée' });
  const apply = useAction((body: { tasks: { title: string; priority: number }[]; risks: { title: string; severity: string; mitigation: string }[] }) => api(`/projects/${p.id}/apply`, { body }), { success: 'Ajouté au projet' });
  const a = p.analysis?.analysis;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const online = status?.online;
  const running = analyze.isPending;

  const togglePick = (k: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  return (
    <Panel hud className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-signal/10 blur-3xl" />
      <SectionHeader
        title="Audit IA"
        action={
          online && a ? (
            <Button size="sm" variant="ghost" icon={<Sparkles size={13} />} loading={running} onClick={() => analyze.mutate(undefined)}>
              Relancer
            </Button>
          ) : null
        }
      />
      {!online ? (
        <div className="text-[13px] text-ink-2">
          Active l’IA pour qu’elle audite ce projet et en révèle les faiblesses.{' '}
          <Link to="/settings" className="text-signal">
            Activer l’IA →
          </Link>
        </div>
      ) : running ? (
        <div className="flex items-center gap-3 py-4">
          <Core size={34} state="thinking" />
          <div>
            <div className="text-[13.5px]">Audit en cours…</div>
            <div className="text-[12px] text-ink-3">Objectif, étapes, budget, risques, échéances.</div>
          </div>
        </div>
      ) : !a ? (
        <div>
          <p className="text-[13.5px] leading-relaxed text-ink-2">NEXUS passe le projet au crible : objectif flou, étapes manquantes, budget, risques ignorés. Sans complaisance.</p>
          <Button className="mt-4" variant="primary" size="sm" icon={<Sparkles size={14} />} onClick={() => analyze.mutate(undefined)}>
            Analyser ce projet
          </Button>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="flex items-center gap-4">
            <Ring value={a.health_score / 100} size={58} stroke={4} color={a.health_score >= 70 ? 'var(--color-ok)' : a.health_score >= 45 ? 'var(--color-warn)' : 'var(--color-danger)'}>
              <span className="num text-[15px]">{a.health_score}</span>
            </Ring>
            <p className="flex-1 text-[13.5px] leading-relaxed">{a.summary}</p>
          </div>

          {a.weaknesses.length > 0 && (
            <div className="mt-5">
              <div className="label mb-2">Faiblesses</div>
              <div className="space-y-2">
                {a.weaknesses.map((w, i) => (
                  <div key={i} className="rounded-lg border border-line bg-white/[0.02] p-2.5">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      <Badge tone={SEVERITY[w.severity].tone}>{SEVERITY[w.severity].label}</Badge>
                      {w.title}
                    </div>
                    <div className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{w.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(a.next_actions.length > 0 || a.missing_risks.length > 0) && (
            <div className="mt-5">
              <div className="label mb-2">Suggestions à intégrer</div>
              <div className="space-y-1">
                {a.next_actions.map((n, i) => {
                  const k = `t${i}`;
                  return (
                    <label key={k} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                      <input type="checkbox" checked={picked.has(k)} onChange={() => togglePick(k)} className="mt-1 accent-[#ff6b2c]" />
                      <div className="text-[13px]">
                        <span className="mr-1.5 font-mono text-[10.5px] text-ink-3">ACTION P{n.priority}</span>
                        {n.title}
                        <div className="text-[12px] text-ink-3">{n.rationale}</div>
                      </div>
                    </label>
                  );
                })}
                {a.missing_risks.map((r, i) => {
                  const k = `r${i}`;
                  return (
                    <label key={k} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                      <input type="checkbox" checked={picked.has(k)} onChange={() => togglePick(k)} className="mt-1 accent-[#ff6b2c]" />
                      <div className="text-[13px]">
                        <span className="mr-1.5 font-mono text-[10.5px] text-warn">RISQUE</span>
                        {r.title}
                        <div className="text-[12px] text-ink-3">{r.mitigation}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <Button
                className="mt-3"
                size="sm"
                disabled={picked.size === 0}
                loading={apply.isPending}
                icon={<Plus size={13} />}
                onClick={() =>
                  apply.mutate(
                    {
                      tasks: a.next_actions.filter((_, i) => picked.has(`t${i}`)).map((n) => ({ title: n.title.slice(0, 200), priority: n.priority })),
                      risks: a.missing_risks.filter((_, i) => picked.has(`r${i}`)).map((r) => ({ title: r.title.slice(0, 200), severity: r.severity, mitigation: r.mitigation })),
                    },
                    { onSuccess: () => setPicked(new Set()) },
                  )
                }
              >
                Ajouter la sélection au projet ({picked.size})
              </Button>
            </div>
          )}

          {a.questions.length > 0 && (
            <div className="mt-5">
              <div className="label mb-2">Questions à trancher</div>
              <ul className="space-y-1.5 text-[13px] text-ink-2">
                {a.questions.map((q, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-signal">?</span>
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 font-mono text-[10px] text-ink-3">
            {p.analysis?.model} · {relTime(p.analysis!.created_at)}
          </div>
        </motion.div>
      )}
    </Panel>
  );
}

function Risks({ p }: { p: ProjectDetail }) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('medium');
  const add = useAction(() => api(`/projects/${p.id}/risks`, { body: { title, severity } }));
  const update = useAction(({ id, status }: { id: string; status: string }) => api(`/risks/${id}`, { method: 'PATCH', body: { status } }));
  const del = useAction((id: string) => api(`/risks/${id}`, { method: 'DELETE' }));
  return (
    <Panel className="p-5">
      <SectionHeader title={`Risques · ${p.risks.filter((r) => r.status === 'open').length} ouverts`} action={<ShieldAlert size={14} className="text-ink-4" />} />
      <div className="space-y-2">
        {p.risks.map((r) => (
          <div key={r.id} className={cx('group rounded-lg border border-line p-2.5', r.status === 'mitigated' && 'opacity-50')}>
            <div className="flex items-center gap-2">
              <Badge tone={SEVERITY[r.severity].tone}>{SEVERITY[r.severity].label}</Badge>
              <span className={cx('flex-1 text-[13px]', r.status === 'mitigated' && 'line-through')}>{r.title}</span>
              <button onClick={() => update.mutate({ id: r.id, status: r.status === 'open' ? 'mitigated' : 'open' })} className="text-[11px] text-ink-3 hover:text-ink">
                {r.status === 'open' ? 'Maîtrisé' : 'Rouvrir'}
              </button>
              <button aria-label="Supprimer le risque" onClick={() => del.mutate(r.id)} className="text-ink-4 opacity-0 hover:text-danger group-hover:opacity-100">
                <Trash2 size={12} />
              </button>
            </div>
            {r.mitigation && <div className="mt-1.5 pl-1 text-[12px] text-ink-3">↳ {r.mitigation}</div>}
          </div>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), title.trim() && add.mutate(undefined, { onSuccess: () => setTitle('') }))}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouveau risque…" className="!h-9 min-w-0 flex-1" />
        <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="!h-9 !w-[110px] !py-0 text-[12.5px]">
          <option value="high">Élevé</option>
          <option value="medium">Moyen</option>
          <option value="low">Faible</option>
        </Select>
        <Button type="submit" disabled={!title.trim()} aria-label="Ajouter le risque">
          <Plus size={14} />
        </Button>
      </form>
    </Panel>
  );
}

function Budget({ p }: { p: ProjectDetail }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const add = useAction(() => api(`/projects/${p.id}/expenses`, { body: { label, amount: Number(amount), date: todayISO() } }));
  const del = useAction((id: string) => api(`/expenses/${id}`, { method: 'DELETE' }));
  return (
    <Panel className="p-5">
      <SectionHeader title="Dépenses" action={<Wallet size={14} className="text-ink-4" />} />
      {p.expenses.length === 0 && <div className="pb-2 text-[13px] text-ink-3">Aucune dépense enregistrée.</div>}
      <div className="space-y-1">
        {p.expenses.map((e) => (
          <div key={e.id} className="group flex items-center gap-3 rounded-lg px-1 py-1.5 text-[13px]">
            <span className="font-mono text-[11px] text-ink-3">{fmtDate(e.date)}</span>
            <span className="flex-1 truncate">{e.label}</span>
            <span className="num">{fmtMoney(e.amount, p.currency, 2)}</span>
            <button aria-label="Supprimer la dépense" onClick={() => del.mutate(e.id)} className="text-ink-4 opacity-0 hover:text-danger group-hover:opacity-100">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), label.trim() && Number(amount) > 0 && add.mutate(undefined, { onSuccess: () => (setLabel(''), setAmount('')) }))}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé" className="!h-9 min-w-0 flex-1" />
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} step="0.01" placeholder="Montant" className="!h-9 !w-[110px]" />
        <Button type="submit" disabled={!label.trim() || !(Number(amount) > 0)} aria-label="Ajouter la dépense">
          <Plus size={14} />
        </Button>
      </form>
    </Panel>
  );
}

function Connections({ p }: { p: ProjectDetail }) {
  const { data: links = [] } = useApi<{ link_id: string; kind: keyof typeof ENTITY; id: string; title: string | null; label: string }[]>(['links', 'project', p.id], `/links?kind=project&id=${p.id}`);
  return (
    <Panel className="p-5">
      <SectionHeader title="Connexions" action={<Link to={`/graph?focus=project:${p.id}`} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><Link2 size={12} /> Graphe</Link>} />
      {links.length === 0 ? (
        <div className="text-[13px] text-ink-3">Aucun lien. Relie ce projet à des notes, idées ou objectifs depuis le Memory Graph.</div>
      ) : (
        <div className="space-y-1">
          {links.map((l) => {
            const meta = ENTITY[l.kind];
            const Icon = meta?.icon ?? CircleDot;
            return (
              <Link key={l.link_id} to={meta ? meta.href(l.id) : '/graph'} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-white/[0.04]">
                <Icon size={13} style={{ color: meta?.color }} />
                <span className="flex-1 truncate">{l.title}</span>
                {l.label && <span className="font-mono text-[10.5px] text-ink-3">{l.label}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
