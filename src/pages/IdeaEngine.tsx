import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArrowRight, Lightbulb, Sparkles, Trash2, Rocket, HelpCircle, ShieldAlert, Footprints, FolderKanban } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { Link, navigate, useSearchParam } from '../lib/router';
import { cx, relTime } from '../lib/format';
import type { AIStatus, Idea, ProjectDetail } from '../lib/types';
import { Badge, Button, EmptyState, PageHeader, Panel, Skeleton, Tabs, Textarea, Kbd } from '../components/ui';
import { Core } from '../components/Core';

const VERDICT = {
  pursue: { label: 'Foncer', tone: 'ok' },
  explore: { label: 'Explorer', tone: 'ion' },
  park: { label: 'En réserve', tone: 'warn' },
  drop: { label: 'Abandonner', tone: 'danger' },
} as const;
const CATEGORY: Record<string, string> = { business: 'Business', product: 'Produit', creative: 'Créatif', personal: 'Personnel', learning: 'Apprentissage', health: 'Santé', finance: 'Finances', tech: 'Tech', other: 'Autre' };
const EFFORT: Record<string, string> = { low: 'Effort faible', medium: 'Effort moyen', high: 'Effort élevé' };

type Filter = 'inbox' | 'analyzed' | 'converted' | 'archived';

export function IdeaEngine() {
  const [filter, setFilter] = useState<Filter>('inbox');
  const { data: ideas = [], isLoading } = useApi<Idea[]>(['ideas', filter], `/ideas?status=${filter}`);
  const { data: allIdeas = [] } = useApi<Idea[]>(['ideas', 'active'], '/ideas');
  const idParam = useSearchParam('id');
  const [selected, setSelected] = useState<string | null>(idParam);
  const [draft, setDraft] = useState('');
  const create = useAction(() => api<Idea>('/ideas', { body: { content: draft } }), { success: 'Idée déposée' });

  useEffect(() => {
    if (idParam) setSelected(idParam);
  }, [idParam]);
  useEffect(() => {
    if (!selected && ideas.length) setSelected(ideas[0].id);
  }, [ideas, selected]);

  const counts = (s: Filter) => allIdeas.filter((i) => i.status === s).length;

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-6 md:px-8 md:py-9">
      <PageHeader eyebrow="Idea Engine" title="De l’intuition au plan" subtitle="Dépose une idée brute. NEXUS la comprend, l’évalue sans complaisance et la transforme en projet si elle le mérite." />

      {/* Capture */}
      <Panel hud className="mb-6 p-4">
        <Textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim().length >= 3) {
              e.preventDefault();
              create.mutate(undefined, { onSuccess: (i) => (setDraft(''), setFilter('inbox'), setSelected(i.id)) });
            }
          }}
          placeholder="Une idée, même floue, même à moitié formulée…"
          className="!border-0 !bg-transparent !text-[15px] !shadow-none"
        />
        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-[12px] text-ink-3">
            <Kbd>⌘↵</Kbd> pour déposer
          </span>
          <Button variant="primary" icon={<Lightbulb size={14} />} disabled={draft.trim().length < 3} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (i) => (setDraft(''), setFilter('inbox'), setSelected(i.id)) })}>
            Déposer l’idée
          </Button>
        </div>
      </Panel>

      <Tabs
        value={filter}
        onChange={(f) => (setFilter(f), setSelected(null))}
        className="mb-5 max-w-full overflow-x-auto"
        items={(['inbox', 'analyzed', 'converted', 'archived'] as Filter[]).map((f) => ({
          value: f,
          label: (
            <span>
              {{ inbox: 'Inbox', analyzed: 'Analysées', converted: 'Devenues projets', archived: 'Archivées' }[f]}
              {f !== 'archived' && <span className="ml-1.5 font-mono text-[10.5px] text-ink-3">{counts(f)}</span>}
            </span>
          ),
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-4">
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : ideas.length === 0 ? (
            <Panel>
              <EmptyState icon={<Lightbulb size={18} />} title="Rien ici" text={filter === 'inbox' ? 'Ton inbox d’idées est vide.' : undefined} />
            </Panel>
          ) : (
            ideas.map((i) => (
              <button key={i.id} onClick={() => setSelected(i.id)} className={cx('panel panel-hover block w-full p-4 text-left', selected === i.id && '!border-signal/40 !bg-signal/[0.04]')}>
                <div className="mb-1.5 flex items-center gap-2">
                  {i.analysis ? <Badge tone={VERDICT[i.analysis.verdict].tone}>{VERDICT[i.analysis.verdict].label}</Badge> : <Badge>Brute</Badge>}
                  {i.analysis && <span className="font-mono text-[10.5px] text-ink-3">F {i.analysis.feasibility.score} · P {i.analysis.potential.score}</span>}
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-ink-3">{relTime(i.created_at)}</span>
                </div>
                <div className="line-clamp-1 text-[13.5px] font-medium">{i.title ?? i.content}</div>
                {i.title && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{i.content}</div>}
              </button>
            ))
          )}
        </div>
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            {selected && ideas.some((i) => i.id === selected) ? (
              <motion.div key={selected} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <IdeaDetail idea={ideas.find((i) => i.id === selected)!} onGone={() => setSelected(null)} />
              </motion.div>
            ) : (
              ideas.length > 0 && (
                <Panel className="flex h-64 items-center justify-center text-[13px] text-ink-3">
                  Sélectionne une idée
                </Panel>
              )
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Score({ label, value, rationale, color }: { label: string; value: number; rationale: string; color: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="num text-[26px] leading-none">
          {value}
          <span className="text-[13px] text-ink-3">/10</span>
        </span>
      </div>
      <div className="mt-3 flex gap-[3px]">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.span key={i} initial={{ opacity: 0, scaleY: 0.3 }} animate={{ opacity: 1, scaleY: 1 }} transition={{ delay: i * 0.04 }} className="h-2 flex-1 rounded-[2px]" style={{ background: i < Math.round(value) ? color : 'rgb(255 255 255 / 0.07)' }} />
        ))}
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">{rationale}</p>
    </div>
  );
}

function IdeaDetail({ idea, onGone }: { idea: Idea; onGone: () => void }) {
  const { data: status } = useApi<AIStatus>(['ai-status'], '/ai/status');
  const analyze = useAction(() => api(`/ideas/${idea.id}/analyze`, { body: {} }), { success: 'Analyse terminée' });
  const convert = useAction(() => api<ProjectDetail>(`/ideas/${idea.id}/convert`, { body: {} }), { success: 'Projet créé à partir de l’idée' });
  const archive = useAction(() => api(`/ideas/${idea.id}`, { method: 'PATCH', body: { status: 'archived' } }), { success: 'Idée archivée' });
  const del = useAction(() => api(`/ideas/${idea.id}`, { method: 'DELETE' }), { success: 'Idée supprimée' });
  const a = idea.analysis;
  const online = status?.online;

  return (
    <Panel className="p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {a && <Badge tone={VERDICT[a.verdict].tone}>{VERDICT[a.verdict].label}</Badge>}
        {a && <Badge>{CATEGORY[a.category] ?? a.category}</Badge>}
        {a && <Badge>{EFFORT[a.effort]}</Badge>}
        {a?.tags.map((t) => (
          <span key={t} className="font-mono text-[10.5px] text-ink-3">
            #{t}
          </span>
        ))}
      </div>
      <h2 className="text-[22px] font-semibold leading-snug tracking-[-0.02em]">{idea.title ?? 'Idée brute'}</h2>
      <blockquote className="mt-3 border-l-2 border-line-strong pl-4 text-[14px] italic leading-relaxed text-ink-2">{idea.content}</blockquote>

      {analyze.isPending ? (
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-signal/20 bg-signal/[0.04] p-5">
          <Core size={40} state="thinking" />
          <div>
            <div className="text-[14px]">NEXUS analyse ton idée…</div>
            <div className="text-[12px] text-ink-3">Faisabilité, potentiel, risques, plan, verdict.</div>
          </div>
        </div>
      ) : a ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 space-y-5">
          <p className="text-[14.5px] leading-relaxed">{a.summary}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Score label="Faisabilité" value={a.feasibility.score} rationale={a.feasibility.rationale} color="var(--color-s2)" />
            <Score label="Potentiel" value={a.potential.score} rationale={a.potential.rationale} color="var(--color-s1)" />
          </div>
          <div className="rounded-xl border border-line p-4">
            <div className="label mb-1.5">Verdict</div>
            <div className="text-[14px] leading-relaxed">{a.verdict_reason}</div>
          </div>
          <div>
            <div className="label mb-3 flex items-center gap-2">
              <Footprints size={12} /> Plan proposé
            </div>
            <ol className="space-y-2.5">
              {a.plan.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-[10.5px] text-ink-2">{i + 1}</span>
                  <div>
                    <div className="text-[13.5px] font-medium">{s.title}</div>
                    <div className="text-[12.5px] text-ink-3">{s.description}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl border border-signal/25 bg-signal/[0.05] p-4">
            <div className="label mb-1 !text-signal">Première action · moins de 2 h</div>
            <div className="text-[14px]">{a.first_action}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="label mb-2 flex items-center gap-2">
                <ShieldAlert size={12} /> Risques
              </div>
              <ul className="space-y-1.5 text-[13px] text-ink-2">
                {a.risks.map((r, i) => (
                  <li key={i}>— {r}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="label mb-2 flex items-center gap-2">
                <HelpCircle size={12} /> Questions critiques
              </div>
              <ul className="space-y-1.5 text-[13px] text-ink-2">
                {a.open_questions.map((q, i) => (
                  <li key={i}>— {q}</li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-line-strong p-5 text-center">
          <p className="text-[13.5px] text-ink-2">{online ? 'Cette idée n’a pas encore été analysée.' : 'Active l’IA pour faire analyser tes idées.'}</p>
          {online ? (
            <Button className="mt-3" variant="primary" icon={<Sparkles size={14} />} onClick={() => analyze.mutate(undefined)}>
              Analyser avec NEXUS
            </Button>
          ) : (
            <Link to="/settings" className="mt-3 inline-block text-[13px] text-signal">
              Activer l’IA →
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {idea.status === 'converted' && idea.project_id ? (
          <Button variant="primary" icon={<FolderKanban size={14} />} onClick={() => navigate(`/projects/${idea.project_id}`)}>
            Voir le projet
          </Button>
        ) : (
          <Button variant={a ? 'primary' : 'secondary'} icon={<Rocket size={14} />} loading={convert.isPending} onClick={() => convert.mutate(undefined, { onSuccess: (p) => navigate(`/projects/${p.id}`) })}>
            Transformer en projet
          </Button>
        )}
        {a && online && (
          <Button variant="ghost" icon={<Sparkles size={13} />} onClick={() => analyze.mutate(undefined)}>
            Réanalyser
          </Button>
        )}
        <span className="flex-1" />
        {idea.status !== 'archived' && (
          <Button variant="ghost" size="sm" icon={<Archive size={13} />} onClick={() => archive.mutate(undefined, { onSuccess: onGone })}>
            Archiver
          </Button>
        )}
        <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={() => confirm('Supprimer définitivement cette idée ?') && del.mutate(undefined, { onSuccess: onGone })}>
          Supprimer
        </Button>
      </div>
      {!a && idea.status !== 'converted' && (
        <div className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
          <ArrowRight size={12} /> Sans analyse, le projet est créé avec la description brute de l’idée.
        </div>
      )}
    </Panel>
  );
}
