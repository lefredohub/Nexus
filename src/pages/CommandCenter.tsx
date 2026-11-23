import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowUpRight, Flame, RefreshCw, Sparkles, Zap, CheckCheck, Wallet, Bot, Workflow, User, Database, Plus } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { Link, navigate } from '../lib/router';
import { cx, fmtDue, fmtMoney, fmtPct, greeting, relTime, todayISO } from '../lib/format';
import type { AIStatus, Overview, Settings, StoredBriefing, ActivityItem } from '../lib/types';
import { Badge, Button, EmptyState, Panel, ProgressBar, Reveal, Ring, SectionHeader, Skeleton } from '../components/ui';
import { Sparkline } from '../components/charts';
import { Core } from '../components/Core';
import { TaskRow } from '../components/TaskRow';
import { Onboarding } from './Onboarding';

const HEALTH = { good: { label: 'Sain', tone: 'ok' }, watch: { label: 'À surveiller', tone: 'warn' }, critical: { label: 'Critique', tone: 'danger' } } as const;

function weekNumber(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y.getTime()) / 86_400_000 + 1) / 7);
}

export function CommandCenter() {
  const { data: o, isLoading } = useApi<Overview>(['overview'], '/overview');
  const { data: settings } = useApi<Settings>(['settings'], '/settings');
  const { data: demo } = useApi<{ empty: boolean }>(['demo'], '/demo');

  if (demo?.empty && settings && !settings.onboarded) return <Onboarding />;

  const now = new Date();
  const name = settings?.user_name?.trim();
  const dateLine = `${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · S${weekNumber(now)}`;

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-6 md:px-8 md:py-9">
      {/* ── En-tête ── */}
      <Reveal>
        <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="label mb-3 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_10px_#ff6b2c]" />
              <span>{dateLine}</span>
            </div>
            <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[46px]">
              {greeting(now)}
              {name ? <span className="text-ink-2">, {name}</span> : null}
              <span className="text-signal">.</span>
            </h1>
            {o && (
              <p className="mt-3 text-[14.5px] text-ink-2">
                {o.tasks.open} tâches ouvertes
                {o.tasks.overdue > 0 && (
                  <>
                    {' · '}
                    <span className="text-danger">{o.tasks.overdue} en retard</span>
                  </>
                )}
                {' · '}
                {o.projects.filter((p) => p.status === 'active').length} projets actifs
                {o.ideas_inbox > 0 && (
                  <>
                    {' · '}
                    <Link to="/ideas" className="text-ink underline decoration-ink-4 underline-offset-4 hover:decoration-signal">
                      {o.ideas_inbox} idée{o.ideas_inbox > 1 ? 's' : ''} à traiter
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" icon={<Sparkles size={14} />} onClick={() => navigate('/ai?new=1')}>
              Demander à NEXUS
            </Button>
          </div>
        </header>
      </Reveal>

      {demo?.empty && <DemoBanner />}

      {isLoading || !o ? (
        <div className="grid grid-cols-12 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="col-span-6 h-28 lg:col-span-3" />
          ))}
          <Skeleton className="col-span-12 h-64 lg:col-span-7" />
          <Skeleton className="col-span-12 h-64 lg:col-span-5" />
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {/* ── Indicateurs ── */}
          <Kpis o={o} currency={settings?.currency ?? 'EUR'} />

          {/* ── Briefing IA ── */}
          <Reveal delay={0.12} className="col-span-12 lg:col-span-7">
            <BriefingPanel />
          </Reveal>

          {/* ── Focus ── */}
          <Reveal delay={0.16} className="col-span-12 lg:col-span-5">
            <Panel className="h-full p-5">
              <SectionHeader index="02" title="Focus du jour" action={<Link to="/tasks" className="text-[12px] text-ink-3 hover:text-ink">Toutes les tâches →</Link>} />
              {o.focus.length === 0 ? (
                <EmptyState icon={<CheckCheck size={18} />} title="Rien d’urgent" text="Aucune tâche ouverte. Profites-en pour avancer un projet de fond." />
              ) : (
                <div className="-mx-2.5">
                  {o.focus.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              )}
            </Panel>
          </Reveal>

          {/* ── Projets ── */}
          <Reveal delay={0.2} className="col-span-12 lg:col-span-7">
            <Panel className="h-full p-5">
              <SectionHeader index="03" title="Projets en cours" action={<Link to="/projects" className="text-[12px] text-ink-3 hover:text-ink">Project Lab →</Link>} />
              {o.projects.length === 0 ? (
                <EmptyState title="Aucun projet actif" action={<Button size="sm" icon={<Plus size={14} />} onClick={() => navigate('/projects?new=1')}>Créer un projet</Button>} />
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {o.projects.slice(0, 6).map((p, i) => (
                    <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.05 }}>
                      <Link to={`/projects/${p.id}`} className="panel-hover group flex items-center gap-4 rounded-xl border border-line bg-white/[0.015] p-3.5">
                        <Ring value={p.progress} size={46} color={p.color}>
                          <span className="num text-[11px] text-ink-2">{Math.round(p.progress * 100)}</span>
                        </Ring>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-medium">{p.title}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge tone={HEALTH[p.health].tone}>{HEALTH[p.health].label}</Badge>
                            {p.due_date && <span className="font-mono text-[11px] text-ink-3">{fmtDue(p.due_date)?.text}</span>}
                          </div>
                        </div>
                        <ArrowUpRight size={15} className="text-ink-4 transition-colors group-hover:text-ink-2" />
                      </Link>
                    </motion.div>
                  ))}
                </div>
              )}
            </Panel>
          </Reveal>

          {/* ── Objectifs ── */}
          <Reveal delay={0.24} className="col-span-12 lg:col-span-5">
            <Panel className="h-full p-5">
              <SectionHeader index="04" title="Objectifs" action={<Link to="/analytics?tab=goals" className="text-[12px] text-ink-3 hover:text-ink">Gérer →</Link>} />
              {o.goals.length === 0 ? (
                <EmptyState title="Aucun objectif défini" text="Un objectif mesurable donne une direction à tes projets." />
              ) : (
                <div className="space-y-4">
                  {o.goals.slice(0, 5).map((g) => (
                    <div key={g.id}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13.5px]">{g.title}</span>
                        <span className="num shrink-0 text-[12px] text-ink-2">{g.target_value !== null ? fmtPct(g.progress) : '—'}</span>
                      </div>
                      <ProgressBar value={g.progress} color="var(--color-s4)" />
                      {g.target_value !== null && (
                        <div className="mt-1 font-mono text-[10.5px] text-ink-3">
                          {g.current_value} / {g.target_value} {g.metric_unit ?? ''}
                          {g.due_date && ` · échéance ${fmtDue(g.due_date)?.text}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </Reveal>

          {/* ── Habitudes ── */}
          <Reveal delay={0.28} className="col-span-12 md:col-span-6 lg:col-span-4">
            <HabitsToday o={o} />
          </Reveal>

          {/* ── Activité ── */}
          <Reveal delay={0.32} className="col-span-12 md:col-span-6 lg:col-span-8">
            <ActivityFeed items={o.activity as unknown as ActivityItem[]} />
          </Reveal>
        </div>
      )}
    </div>
  );
}

/** Espace vide après « Partir de zéro » : on peut encore charger la démo. */
function DemoBanner() {
  const load = useAction(() => api('/demo', { body: {} }), { success: 'Données de démonstration chargées' });
  return (
    <Reveal>
      <Panel className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">Ton espace est vide</div>
          <div className="text-[12.5px] text-ink-3">Envie de voir NEXUS rempli ? Charge des données fictives, tu pourras les effacer ensuite (Réglages → Données → Réinitialiser).</div>
        </div>
        <Button variant="primary" loading={load.isPending} onClick={() => load.mutate(undefined)}>
          Explorer avec une démo
        </Button>
      </Panel>
    </Reveal>
  );
}

function Kpis({ o, currency }: { o: Overview; currency: string }) {
  const velocity = o.velocity.map((v) => v.n);
  const tiles = [
    {
      label: 'Tâches ouvertes',
      value: o.tasks.open,
      sub: o.tasks.overdue ? `${o.tasks.overdue} en retard` : `${o.tasks.due_today} pour aujourd’hui`,
      subTone: o.tasks.overdue ? 'text-danger' : 'text-ink-3',
      icon: AlertTriangle,
    },
    {
      label: 'Terminées · 7 j',
      value: o.tasks.done_week,
      sub: '14 derniers jours',
      chart: <Sparkline values={velocity} color="var(--color-signal)" height={30} />,
      icon: Zap,
    },
    {
      label: 'Habitudes du jour',
      value: `${o.habits.done_today}/${o.habits.total}`,
      sub: o.habits.best_streak ? `meilleure série : ${o.habits.best_streak} j` : 'aucune série en cours',
      icon: Flame,
    },
    {
      label: 'Solde du mois',
      value: o.finance.month ? fmtMoney(o.finance.month.net, currency) : '—',
      sub: o.finance.savingsRate !== null ? `taux d’épargne ${fmtPct(o.finance.savingsRate)}` : 'aucune donnée',
      subTone: o.finance.month && o.finance.month.net < 0 ? 'text-danger' : 'text-ink-3',
      icon: Wallet,
    },
  ];
  return (
    <>
      {tiles.map((t, i) => (
        <Reveal key={t.label} delay={0.04 + i * 0.03} className="col-span-6 lg:col-span-3">
          <Panel className="flex h-full min-h-[118px] flex-col justify-between p-4" hud={i === 0}>
            <div className="flex items-center justify-between">
              <span className="label">{t.label}</span>
              <t.icon size={14} className="text-ink-4" />
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <div className="num text-[28px] font-medium leading-none md:text-[32px]">{t.value}</div>
                <div className={cx('mt-2 text-[11.5px]', t.subTone ?? 'text-ink-3')}>{t.sub}</div>
              </div>
              {t.chart && <div className="hidden w-20 shrink-0 sm:block md:w-24">{t.chart}</div>}
            </div>
          </Panel>
        </Reveal>
      ))}
    </>
  );
}

function BriefingPanel() {
  const { data: status } = useApi<AIStatus>(['ai-status'], '/ai/status');
  const { data: briefing, isLoading } = useApi<StoredBriefing | null>(['briefing'], '/ai/briefing');
  const generate = useAction((force: boolean) => api<StoredBriefing>('/ai/briefing', { body: { force } }));
  const online = status?.online;
  const thinking = generate.isPending;
  const b = briefing?.content;

  return (
    <Panel hud className="relative h-full overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-signal/10 blur-3xl" />
      <SectionHeader
        index="01"
        title="Briefing NEXUS"
        action={
          b && online ? (
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} className={thinking ? 'animate-spin' : ''} />} onClick={() => generate.mutate(true)} disabled={thinking}>
              Régénérer
            </Button>
          ) : null
        }
      />
      <div className="relative flex gap-4">
        <Core size={44} state={!online ? 'offline' : thinking ? 'thinking' : 'idle'} className="mt-0.5 hidden sm:block" />
        <div className="min-w-0 flex-1">
          {!online ? (
            <div>
              <p className="text-[15px] leading-relaxed text-ink-2">Le noyau IA est hors ligne. Active l’IA locale gratuite (Ollama) ou Claude dans Réglages.</p>
              <ul className="mt-4 space-y-2.5">
                {[
                  ['Briefing quotidien', 'ce qui compte aujourd’hui, ce qui dérape'],
                  ['Assistant connecté à tes données', 'il lit, propose, agit — et te contredit si besoin'],
                  ['Audit de projets et d’idées', 'faiblesses, risques, plan d’action'],
                  ['Workflows intelligents', 'étapes « Demander à Claude » dans l’Automation Lab'],
                ].map(([t, d]) => (
                  <li key={t} className="flex items-start gap-2.5 text-[13px]">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-signal" />
                    <span>
                      <span className="text-ink">{t}</span> <span className="text-ink-3">— {d}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Button className="mt-5" variant="primary" size="sm" onClick={() => navigate('/settings')}>
                Activer l’IA
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-2.5">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : thinking ? (
            <div className="py-2">
              <p className="text-[15px] text-ink-2">NEXUS analyse ta situation…</p>
              <p className="mt-1 text-[12px] text-ink-3">Projets, tâches, objectifs, habitudes, finances.</p>
            </div>
          ) : !b ? (
            <div>
              <p className="text-[15px] leading-relaxed text-ink-2">Ton briefing du jour n’a pas encore été généré. NEXUS va lire ta situation et te dire ce qui compte vraiment aujourd’hui.</p>
              <Button className="mt-4" variant="primary" size="sm" icon={<Sparkles size={14} />} onClick={() => generate.mutate(false)}>
                Générer le briefing
              </Button>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
              <p className="text-[18px] font-medium leading-snug tracking-[-0.01em] md:text-[19px]">{b.headline}</p>
              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {b.focus.map((f, i) => (
                  <div key={i} className="rounded-xl border border-line bg-white/[0.02] p-3">
                    <div className="flex items-start gap-2">
                      <span className="num mt-[1px] text-[11px] text-signal">{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        <div className="text-[13.5px] font-medium">{f.title}</div>
                        <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{f.why}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {b.alerts.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {b.alerts.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                      <AlertTriangle size={13} className="mt-[3px] shrink-0 text-warn" />
                      {a}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 border-t border-line pt-3 text-[13px] italic leading-relaxed text-ink-2">« {b.insight} »</div>
              <div className="mt-3 font-mono text-[10px] text-ink-3">
                {briefing.model} · {relTime(briefing.created_at)}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function HabitsToday({ o }: { o: Overview }) {
  const toggle = useAction(({ id, done }: { id: string; done: boolean }) => api(`/habits/${id}/checks/${todayISO()}`, { method: 'PUT', body: { done } }));
  return (
    <Panel className="h-full p-5">
      <SectionHeader index="05" title="Habitudes · aujourd’hui" action={<Link to="/analytics?tab=habits" className="text-[12px] text-ink-3 hover:text-ink">Suivi →</Link>} />
      {o.habits.items.length === 0 ? (
        <EmptyState title="Aucune habitude suivie" text="Ajoute-en dans Analytics." />
      ) : (
        <div className="space-y-1.5">
          {o.habits.items.map((h) => (
            <button
              key={h.id}
              onClick={() => toggle.mutate({ id: h.id, done: !h.done_today })}
              className={cx('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-300', h.done_today ? 'border-transparent bg-white/[0.05]' : 'border-line hover:border-line-strong')}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all"
                style={{ borderColor: h.color, background: h.done_today ? h.color : 'transparent', boxShadow: h.done_today ? `0 0 12px ${h.color}66` : 'none' }}
              >
                {h.done_today && <CheckCheck size={11} className="text-black" strokeWidth={3} />}
              </span>
              <span className={cx('flex-1 text-[13.5px]', h.done_today ? 'text-ink' : 'text-ink-2')}>{h.name}</span>
              {h.streak > 0 && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-ink-3">
                  <Flame size={11} className={h.streak >= 7 ? 'text-signal' : ''} />
                  {h.streak} j
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

const ACTOR_ICON = { user: User, ai: Bot, automation: Workflow, system: Database } as const;

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <Panel className="h-full p-5">
      <SectionHeader index="06" title="Activité récente" />
      {items.length === 0 ? (
        <EmptyState title="Pas encore d’activité" />
      ) : (
        <ol className="relative space-y-0.5 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-line">
          {shown.map((a) => {
            const Icon = ACTOR_ICON[a.actor as keyof typeof ACTOR_ICON] ?? User;
            return (
              <li key={a.id} className="relative flex items-start gap-3 py-1.5">
                <span className={cx('relative z-10 mt-[1px] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border bg-base', a.actor === 'ai' ? 'border-signal/40 text-signal' : a.actor === 'automation' ? 'border-ion/40 text-ion' : 'border-line text-ink-3')}>
                  <Icon size={11} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{a.title}</div>
                  {a.detail && <div className="truncate text-[12px] text-ink-3">{a.detail}</div>}
                </div>
                <span className="shrink-0 pt-0.5 font-mono text-[10.5px] text-ink-3">{relTime(a.created_at)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 8 && (
        <button onClick={() => setAll((v) => !v)} className="mt-2 text-[12px] text-ink-3 hover:text-ink">
          {all ? 'Réduire' : `Voir les ${items.length} événements`}
        </button>
      )}
    </Panel>
  );
}
