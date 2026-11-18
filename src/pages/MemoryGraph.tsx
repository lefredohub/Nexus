/**
 * Memory Graph : réseau de connaissances interactif (simulation de forces d3-force,
 * rendu SVG). Glisser un nœud, zoomer à la molette, déplacer le fond, cliquer pour
 * explorer et relier.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Link2, Maximize2, Plus, Search, Trash2, X, Unlink } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { Link, useSearchParam } from '../lib/router';
import { cx } from '../lib/format';
import { ENTITY } from '../lib/entities';
import type { EntityKind, GraphEdge, GraphNode, Note } from '../lib/types';
import { Button, Field, IconButton, Input, Modal, Textarea, Toggle } from '../components/ui';

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & GraphEdge;

const KINDS: EntityKind[] = ['goal', 'project', 'idea', 'note', 'memory', 'task'];
const radius = (n: GraphNode) => (n.kind === 'goal' ? 9 : n.kind === 'project' ? 8 : n.kind === 'task' ? 3.5 : 5.5) + Math.min(10, Math.sqrt(n.weight) * 2.2);

export function MemoryGraph() {
  const [withTasks, setWithTasks] = useState(false);
  const { data } = useApi<{ nodes: GraphNode[]; edges: GraphEdge[] }>(['graph', withTasks], `/graph${withTasks ? '?tasks=1' : ''}`);
  const [hidden, setHidden] = useState<Set<EntityKind>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const focusParam = useSearchParam('focus');

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [, setTick] = useState(0);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // (Re)construit la simulation quand les données changent, en conservant les positions connues.
  useEffect(() => {
    if (!data) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: SimNode[] = data.nodes
      .filter((n) => !hidden.has(n.kind))
      .map((n) => {
        const p = prev.get(n.id);
        return { ...n, x: p?.x ?? (Math.random() - 0.5) * 300, y: p?.y ?? (Math.random() - 0.5) * 300, vx: p?.vx, vy: p?.vy };
      });
    const ids = new Set(nodes.map((n) => n.id));
    const links: SimLink[] = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e }));
    nodesRef.current = nodes;
    linksRef.current = links;
    simRef.current?.stop();
    let frame = 0;
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => (l.implicit ? 95 : 125)).strength(0.5))
      .force('charge', forceManyBody<SimNode>().strength((d) => (d.kind === 'task' ? -60 : -420)))
      .force('collide', forceCollide<SimNode>().radius((d) => radius(d) + (d.kind === 'task' ? 8 : 26)))
      .force('center', forceCenter(0, 0))
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.05))
      .alpha(prev.size ? 0.4 : 1)
      .alphaDecay(0.03)
      .on('tick', () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => setTick((t) => t + 1));
      });
    simRef.current = sim;
    return () => {
      sim.stop();
      cancelAnimationFrame(frame);
    };
  }, [data, hidden]);

  // Focus demandé via l'URL (?focus=project:prj_xxx)
  useEffect(() => {
    if (!focusParam || !data) return;
    const t = setTimeout(() => {
      const n = nodesRef.current.find((x) => x.id === focusParam);
      if (n) {
        setSelected(n.id);
        setView((v) => ({ ...v, x: -(n.x ?? 0) * v.k, y: -(n.y ?? 0) * v.k }));
      }
    }, 900);
    return () => clearTimeout(t);
  }, [focusParam, data]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of linksRef.current) {
      const s = typeof l.source === 'object' ? (l.source as SimNode).id : (l.source as string);
      const t = typeof l.target === 'object' ? (l.target as SimNode).id : (l.target as string);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hidden, linksRef.current.length]);

  const active = hover ?? selected;
  const isLit = (id: string) => !active || id === active || neighbors.get(active)?.has(id);
  const matches = query.trim().length >= 2 ? new Set(nodesRef.current.filter((n) => n.label.toLowerCase().includes(query.toLowerCase())).map((n) => n.id)) : null;

  // ── Interactions : zoom molette, déplacement du fond, glisser un nœud ──
  const drag = useRef<{ mode: 'pan' | 'node'; id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const toWorld = (clientX: number, clientY: number) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - size.w / 2 - view.x) / view.k, y: (clientY - r.top - size.h / 2 - view.y) / view.k };
  };
  const onWheel = (e: React.WheelEvent) => {
    const r = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left - size.w / 2;
    const my = e.clientY - r.top - size.h / 2;
    const k = Math.max(0.25, Math.min(3, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView((v) => ({ k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }));
  };
  const onPointerDown = (e: React.PointerEvent, nodeId?: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode: nodeId ? 'node' : 'pan', id: nodeId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    if (nodeId) {
      const n = nodesRef.current.find((x) => x.id === nodeId)!;
      n.fx = n.x;
      n.fy = n.y;
      simRef.current?.alphaTarget(0.25).restart();
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    if (d.mode === 'pan') setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    else {
      const n = nodesRef.current.find((x) => x.id === d.id)!;
      const w = toWorld(e.clientX, e.clientY);
      n.fx = w.x;
      n.fy = w.y;
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'node') {
      const n = nodesRef.current.find((x) => x.id === d.id);
      if (n) (n.fx = null), (n.fy = null);
      simRef.current?.alphaTarget(0);
      if (!d.moved) setSelected((s) => (s === d.id ? null : d.id!));
    } else if (!d.moved) setSelected(null);
  };

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const counts = useMemo(() => {
    const c: Partial<Record<EntityKind, number>> = {};
    data?.nodes.forEach((n) => (c[n.kind] = (c[n.kind] ?? 0) + 1));
    return c;
  }, [data]);

  return (
    <div className="relative flex h-full flex-col">
      {/* Barre d'outils */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-4 md:p-6">
        <div className="pointer-events-auto">
          <div className="label mb-1.5 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_10px_#ff6b2c]" />
            Memory Graph
          </div>
          <h1 className="text-[24px] font-semibold tracking-[-0.03em] md:text-[28px]">Réseau de connaissances</h1>
          <div className="mt-1 font-mono text-[11px] text-ink-3">
            {nodes.length} nœuds · {links.length} connexions
          </div>
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Trouver un nœud…" className="!h-9 !w-[200px] !pl-8 backdrop-blur" />
          </div>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Note
          </Button>
        </div>
      </div>

      {/* Légende / filtres */}
      <div className="absolute bottom-4 left-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-1.5 md:bottom-6 md:left-6">
        {KINDS.filter((k) => k !== 'task' || withTasks).map((k) => {
          const meta = ENTITY[k];
          const off = hidden.has(k);
          return (
            <button
              key={k}
              onClick={() => setHidden((h) => {
                const n = new Set(h);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })}
              className={cx('flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] backdrop-blur transition-all', off ? 'border-line text-ink-3 opacity-50' : 'border-line-strong bg-base/70 text-ink-2')}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: meta.color, boxShadow: off ? 'none' : `0 0 8px ${meta.color}` }} />
              {meta.plural}
              <span className="font-mono text-[10px] text-ink-3">{counts[k] ?? 0}</span>
            </button>
          );
        })}
        <label className="ml-1 flex h-7 items-center gap-2 rounded-full border border-line bg-base/70 px-2.5 text-[11.5px] text-ink-2 backdrop-blur">
          <Toggle checked={withTasks} onChange={setWithTasks} label="Afficher les tâches" />
          Tâches
        </label>
        <IconButton label="Recentrer" className="border border-line bg-base/70 backdrop-blur" onClick={() => setView({ x: 0, y: 0, k: 1 })}>
          <Maximize2 size={13} />
        </IconButton>
      </div>

      {/* Canevas */}
      <div
        ref={containerRef}
        className="relative flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <svg width={size.w} height={size.h} className="absolute inset-0">
          <defs>
            <radialGradient id="node-halo">
              <stop offset="0%" stopColor="white" stopOpacity="0.25" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g transform={`translate(${size.w / 2 + view.x},${size.h / 2 + view.y}) scale(${view.k})`}>
            {links.map((l) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              if (s.x === undefined || t.x === undefined) return null;
              const lit = active && (s.id === active || t.id === active);
              const dim = active && !lit;
              return (
                <g key={l.id}>
                  <line
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={lit ? '#ff6b2c' : 'white'}
                    strokeOpacity={dim ? 0.03 : lit ? 0.7 : l.implicit ? 0.08 : 0.18}
                    strokeWidth={(lit ? 1.4 : 1) / Math.sqrt(view.k)}
                    strokeDasharray={l.implicit ? '3 4' : undefined}
                  />
                  {lit && l.label && (
                    <text x={(s.x + t.x!) / 2} y={(s.y! + t.y!) / 2 - 4} textAnchor="middle" className="fill-ink-2 font-mono" style={{ fontSize: 10 / view.k }}>
                      {l.label}
                    </text>
                  )}
                </g>
              );
            })}
            {nodes.map((n) => {
              if (n.x === undefined) return null;
              const r = radius(n);
              const color = n.kind === 'project' && n.color ? n.color : ENTITY[n.kind].color;
              const lit = isLit(n.id);
              const match = matches?.has(n.id);
              const showLabel = n.id === active || match || (lit && active) || (n.kind !== 'task' && (nodes.length < 45 || view.k > 1.15)) || n.kind === 'goal' || (n.kind === 'project' && view.k > 0.7);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  opacity={matches ? (match ? 1 : 0.15) : lit ? 1 : 0.14}
                  style={{ transition: 'opacity .25s' }}
                  className="cursor-pointer"
                  onPointerDown={(e) => onPointerDown(e, n.id)}
                  onPointerEnter={() => !drag.current && setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                >
                  {(n.id === active || match) && <circle r={r * 3} fill="url(#node-halo)" />}
                  <circle r={r + 4} fill={color} opacity={0.12} />
                  <circle r={r} fill={n.kind === 'memory' || n.kind === 'note' ? 'var(--color-base)' : color} stroke={color} strokeWidth={n.kind === 'memory' || n.kind === 'note' ? 2 : 0} />
                  {n.id === selected && <circle r={r + 7} fill="none" stroke="#ff6b2c" strokeWidth={1.2 / view.k} strokeDasharray="3 3" />}
                  {showLabel && (
                    <text y={r + 13 / view.k + 2} textAnchor="middle" className="pointer-events-none fill-ink font-sans" style={{ fontSize: Math.max(9, 11.5 / view.k), paintOrder: 'stroke', stroke: 'var(--color-void)', strokeWidth: 3 / view.k }}>
                      {n.label.length > 28 ? `${n.label.slice(0, 26)}…` : n.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {data && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-center text-[13px] text-ink-3">
            Le graphe est vide. Crée des projets, idées, notes — ou laisse NEXUS AI mémoriser des informations.
          </div>
        )}
      </div>

      <AnimatePresence>{selectedNode && <NodePanel key={selectedNode.id} node={selectedNode} all={data?.nodes ?? []} onClose={() => setSelected(null)} />}</AnimatePresence>
      <NoteModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NodePanel({ node, all, onClose }: { node: GraphNode; all: GraphNode[]; onClose: () => void }) {
  const meta = ENTITY[node.kind];
  const { data: links = [] } = useApi<{ link_id: string; kind: EntityKind; id: string; title: string | null; label: string }[]>(['links', node.kind, node.ref_id], `/links?kind=${node.kind}&id=${node.ref_id}`);
  const { data: note } = useApi<Note>(['note', node.ref_id], `/notes/${node.ref_id}`, { enabled: node.kind === 'note' });
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const link = useAction(() => {
    const t = all.find((n) => n.label === target || n.id === target);
    if (!t) throw new Error('Choisis un élément dans la liste');
    return api('/links', { body: { source: { kind: node.kind, id: node.ref_id }, target: { kind: t.kind, id: t.ref_id }, label } });
  }, { success: 'Éléments reliés' });
  const unlink = useAction((id: string) => api(`/links/${id}`, { method: 'DELETE' }));
  const delNote = useAction(() => api(`/notes/${node.ref_id}`, { method: 'DELETE' }), { success: 'Note supprimée' });
  const Icon = meta.icon;
  return (
    <motion.aside
      initial={{ x: 30, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 30, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="panel absolute bottom-4 right-4 top-28 z-20 flex w-[min(360px,calc(100%-2rem))] flex-col overflow-hidden bg-overlay/90 backdrop-blur-xl md:right-6"
    >
      <div className="flex items-start gap-3 border-b border-line p-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}>
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="label !text-[10px]">{meta.label}{node.status ? ` · ${node.status}` : ''}</div>
          <div className="mt-0.5 text-[14.5px] font-medium leading-snug">{note?.title ?? node.label}</div>
        </div>
        <IconButton label="Fermer" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {note?.content && <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{note.content}</p>}
        <div>
          <div className="label mb-2">Connexions · {links.length}</div>
          {links.length === 0 && <div className="text-[12.5px] text-ink-3">Aucun lien explicite.</div>}
          <div className="space-y-1">
            {links.map((l) => {
              const m = ENTITY[l.kind];
              const LIcon = m?.icon;
              return (
                <div key={l.link_id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-white/[0.04]">
                  {LIcon && <LIcon size={12} style={{ color: m.color }} />}
                  <span className="flex-1 truncate">{l.title}</span>
                  {l.label && <span className="font-mono text-[10px] text-ink-3">{l.label}</span>}
                  <button aria-label="Supprimer le lien" onClick={() => unlink.mutate(l.link_id)} className="text-ink-4 opacity-0 hover:text-danger group-hover:opacity-100">
                    <Unlink size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="label mb-2">Relier à…</div>
          <Input list="graph-nodes" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Chercher un élément" className="!h-9" />
          <datalist id="graph-nodes">
            {all.filter((n) => n.id !== node.id).map((n) => (
              <option key={n.id} value={n.label}>
                {ENTITY[n.kind].label}
              </option>
            ))}
          </datalist>
          <div className="mt-2 flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nature du lien (optionnel)" className="!h-9 min-w-0 flex-1" maxLength={80} />
            <Button icon={<Link2 size={13} />} disabled={!target} loading={link.isPending} onClick={() => link.mutate(undefined, { onSuccess: () => (setTarget(''), setLabel('')) })}>
              Relier
            </Button>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line p-3">
        {node.kind === 'note' ? (
          <Button variant="danger" size="sm" icon={<Trash2 size={12} />} onClick={() => confirm('Supprimer cette note ?') && delNote.mutate(undefined, { onSuccess: onClose })}>
            Supprimer
          </Button>
        ) : (
          <span />
        )}
        {node.kind !== 'note' && (
          <Link to={meta.href(node.ref_id)} className="flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
            Ouvrir <ArrowUpRight size={13} />
          </Link>
        )}
      </div>
    </motion.aside>
  );
}

function NoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const save = useAction(() => api('/notes', { body: { title, content, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) } }), { success: 'Note ajoutée au graphe' });
  useEffect(() => {
    if (open) (setTitle(''), setContent(''), setTags(''));
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvelle note"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!title.trim()} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Créer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Titre">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Contenu">
          <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Réflexion, principe, référence…" />
        </Field>
        <Field label="Étiquettes" hint="Séparées par des virgules">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
