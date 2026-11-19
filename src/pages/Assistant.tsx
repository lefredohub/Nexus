import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Brain, ChevronDown, ChevronRight, MessageSquarePlus, PanelLeft, Square, Trash2, Wrench, AlertTriangle, ArrowUpRight, Check, X, Plus, Pencil } from 'lucide-react';
import { api, ApiError, streamChat, useAction, useApi, queryClient } from '../lib/api';
import { Link, navigate, useSearchParam } from '../lib/router';
import { cx, relTime } from '../lib/format';
import { ENTITY } from '../lib/entities';
import type { AIStatus, ChatEvent, ConversationSummary, ConversationView, EntityKind, Memory, ToolEffect } from '../lib/types';
import { Badge, Button, Drawer, EmptyState, IconButton, Select, Textarea } from '../components/ui';
import { Core } from '../components/Core';
import { Markdown } from '../components/Markdown';

type Part = ConversationView['turns'][number]['parts'][number];
interface Turn { id: string; role: 'user' | 'assistant'; parts: Part[]; error?: string; streaming?: boolean }

const TOOL_LABELS: Record<string, string> = {
  get_overview: 'Lecture de la situation',
  search_knowledge: 'Recherche dans la mémoire',
  list_projects: 'Liste des projets',
  get_project: 'Lecture du projet',
  list_tasks: 'Liste des tâches',
  list_goals: 'Lecture des objectifs',
  list_ideas: 'Lecture des idées',
  get_analytics: 'Lecture des analytics',
  list_memories: 'Lecture de la mémoire',
  get_connections: 'Exploration du graphe',
  create_task: 'Création de tâche',
  update_task: 'Mise à jour de tâche',
  create_project: 'Création de projet',
  update_project: 'Mise à jour de projet',
  add_project_items: 'Enrichissement du projet',
  create_goal: 'Création d’objectif',
  update_goal: 'Mise à jour d’objectif',
  capture_idea: 'Capture d’idée',
  create_note: 'Création de note',
  remember: 'Mémorisation',
  forget: 'Oubli',
  link_items: 'Création de lien',
  log_transaction: 'Opération financière',
  log_workout: 'Séance de sport',
  check_habit: 'Habitude',
  log_metric: 'Métrique',
};

const SUGGESTIONS = [
  'Fais le point sur ma situation : qu’est-ce qui mérite mon attention cette semaine ?',
  'Quel projet est le plus à risque, et pourquoi ?',
  'J’ai envie de lancer un nouveau projet. Challenge-moi avant que je me lance.',
  'Qu’est-ce que tu sais de moi ?',
];

export function Assistant({ conversationId }: { conversationId?: string }) {
  const { data: status } = useApi<AIStatus>(['ai-status'], '/ai/status');
  const { data: conversations = [] } = useApi<ConversationSummary[]>(['conversations'], '/conversations');
  const { data: view } = useApi<ConversationView>(['conversation', conversationId], `/conversations/${conversationId}`, { enabled: Boolean(conversationId) });
  const [live, setLive] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const panelParam = useSearchParam('panel');
  const [memoryOpen, setMemoryOpen] = useState(panelParam === 'memory');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = live.some((t) => t.streaming);
  const qParam = useSearchParam('q');
  const newParam = useSearchParam('new');
  const autoSent = useRef<string | null>(null);

  // Nouvelle conversation demandée : on repart d'un écran vide.
  useEffect(() => {
    if (newParam && conversationId === undefined) setLive([]);
  }, [newParam, conversationId]);
  // Dès que la version enregistrée arrive du serveur, elle remplace le tour « en direct ».
  useEffect(() => {
    if (!streaming) setLive((ts) => (ts.some((t) => t.error) ? ts : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  useEffect(() => {
    if (!streaming) setLive((ts) => (ts.some((t) => t.error) ? [] : ts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const turns: Turn[] = useMemo(() => [...(view?.turns ?? []).map((t) => ({ id: t.id, role: t.role, parts: t.parts })), ...live], [view, live]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
  }, [turns, streaming]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput('');
    const userTurn: Turn = { id: `u-${Date.now()}`, role: 'user', parts: [{ type: 'text', text: message }] };
    const aiTurn: Turn = { id: `a-${Date.now()}`, role: 'assistant', parts: [], streaming: true };
    setLive([userTurn, aiTurn]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let convId = conversationId ?? null;

    const update = (fn: (t: Turn) => Turn) => setLive((ts) => ts.map((t) => (t.id === aiTurn.id ? fn(t) : t)));
    const appendText = (type: 'text' | 'thinking', delta: string) =>
      update((t) => {
        const parts = [...t.parts];
        const last = parts[parts.length - 1];
        if (last && last.type === type) parts[parts.length - 1] = { ...last, text: last.text + delta };
        else parts.push({ type, text: delta });
        return { ...t, parts };
      });

    const onEvent = (e: ChatEvent) => {
      switch (e.type) {
        case 'start':
          if (!convId) {
            convId = e.conversationId;
            window.history.replaceState(null, '', `/ai/${e.conversationId}`);
          }
          break;
        case 'thinking':
          appendText('thinking', e.delta);
          break;
        case 'text':
          appendText('text', e.delta);
          break;
        case 'tool_start':
          update((t) => ({ ...t, parts: [...t.parts, { type: 'tool', id: e.id, name: e.name, input: e.input }] }));
          break;
        case 'tool_result':
          update((t) => ({ ...t, parts: t.parts.map((p) => (p.type === 'tool' && p.id === e.id ? { ...p, ok: e.ok, summary: e.summary, effect: e.effect } : p)) }));
          if (e.effect) void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'conversation' });
          break;
        case 'refusal':
          update((t) => ({ ...t, error: e.message }));
          break;
        case 'error':
          update((t) => ({ ...t, error: e.message }));
          break;
        case 'done':
          break;
      }
    };

    try {
      await streamChat({ conversationId: convId, message }, onEvent, ctrl.signal);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) update((t) => ({ ...t, error: err instanceof ApiError ? err.message : 'Connexion interrompue.' }));
    } finally {
      update((t) => ({ ...t, streaming: false }));
      abortRef.current = null;
      await queryClient.invalidateQueries();
      if (convId && convId !== conversationId) {
        navigate(`/ai/${convId}`, { replace: true });
      } else {
        // Le serveur a enregistré le tour : la vue persistée remplace le tour en direct.
        setLive((ts) => (ts.some((t) => t.error) ? ts : []));
      }
    }
  };

  // Question transmise depuis la palette de commandes.
  useEffect(() => {
    if (qParam && newParam && status?.online && autoSent.current !== qParam) {
      autoSent.current = qParam;
      window.history.replaceState(null, '', '/ai');
      void send(qParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam, newParam, status?.online]);

  const online = status?.online;
  const deleteConv = useAction((id: string) => api(`/conversations/${id}`, { method: 'DELETE' }), { success: 'Conversation supprimée' });

  return (
    <div className="flex h-full">
      {/* Conversations */}
      <aside className={cx('fixed inset-y-0 left-0 z-40 w-[268px] shrink-0 flex-col border-r border-line bg-base/95 backdrop-blur-xl md:static md:z-auto md:flex md:bg-base/30', sidebar ? 'flex' : 'hidden')}>
        <div className="flex items-center justify-between px-4 pb-3 pt-5">
          <span className="label">Conversations</span>
          <IconButton label="Nouvelle conversation" onClick={() => (setLive([]), setSidebar(false), navigate('/ai?new=1'))}>
            <MessageSquarePlus size={16} />
          </IconButton>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {conversations.length === 0 && <div className="px-3 py-6 text-[12.5px] text-ink-3">Aucune conversation pour l’instant.</div>}
          {conversations.map((c) => (
            <div key={c.id} className={cx('group flex items-center rounded-lg transition-colors', c.id === conversationId ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]')}>
              <Link to={`/ai/${c.id}`} onClick={() => setSidebar(false)} className="min-w-0 flex-1 px-3 py-2">
                <div className={cx('truncate text-[13px]', c.id === conversationId ? 'text-ink' : 'text-ink-2')}>{c.title}</div>
                <div className="font-mono text-[10px] text-ink-3">{relTime(c.updated_at)}</div>
              </Link>
              <button
                aria-label="Supprimer la conversation"
                onClick={() => {
                  if (confirm('Supprimer cette conversation ?')) {
                    deleteConv.mutate(c.id);
                    if (c.id === conversationId) navigate('/ai');
                  }
                }}
                className="mr-2 text-ink-4 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      {sidebar && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebar(false)} />}

      {/* Fil */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:px-6">
          <IconButton label="Conversations" className="md:hidden" onClick={() => setSidebar(true)}>
            <PanelLeft size={16} />
          </IconButton>
          <Core size={26} state={!online ? 'offline' : streaming ? 'thinking' : 'idle'} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">{view?.conversation.title ?? 'Nexus AI'}</div>
            <div className="font-mono text-[10.5px] text-ink-3">
              {online ? `${status?.model} · effort ${status?.effort} · ${status?.allowWrites ? 'lecture + écriture' : 'lecture seule'}` : `hors ligne — ${status?.reason ?? 'IA indisponible'}`}
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={<Brain size={14} />} onClick={() => setMemoryOpen(true)}>
            <span className="hidden sm:inline">Mémoire</span>
          </Button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[780px] px-4 py-8 md:px-6">
            {turns.length === 0 ? (
              <Welcome online={Boolean(online)} onPick={(s) => void send(s)} onFill={setInput} />
            ) : (
              <div className="space-y-8">
                {turns.map((t) => (t.role === 'user' ? <UserBubble key={t.id} text={(t.parts[0] as { text: string })?.text ?? ''} /> : <AssistantTurn key={t.id} turn={t} />))}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-line bg-base/40 px-4 pb-4 pt-3 backdrop-blur md:px-6">
          <div className="mx-auto max-w-[780px]">
            <div className={cx('panel flex items-end gap-2 p-2 transition-shadow', streaming && 'shadow-[0_0_0_1px_rgb(255_107_44/0.25)]')}>
              <Textarea
                rows={1}
                value={input}
                disabled={!online}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={online ? 'Parle à NEXUS… (Maj+Entrée pour un retour à la ligne)' : 'IA hors ligne : voir Réglages → Intelligence artificielle'}
                className="!min-h-[40px] flex-1 !border-0 !bg-transparent !shadow-none"
              />
              {streaming ? (
                <Button variant="secondary" className="!h-10 !w-10 !p-0" aria-label="Arrêter" onClick={() => abortRef.current?.abort()}>
                  <Square size={13} fill="currentColor" />
                </Button>
              ) : (
                <Button variant="primary" className="!h-10 !w-10 !p-0" aria-label="Envoyer" disabled={!input.trim() || !online} onClick={() => void send(input)}>
                  <ArrowUp size={17} />
                </Button>
              )}
            </div>
            <div className="mt-2 text-center font-mono text-[10px] text-ink-3">NEXUS peut se tromper. Ses actions sont visibles et tracées dans l’activité.</div>
          </div>
        </div>
      </section>

      <MemoryDrawer open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}

function Welcome({ online, onPick, onFill }: { online: boolean; onPick: (s: string) => void; onFill: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center pt-[6vh] text-center">
      <Core size={72} state={online ? 'idle' : 'offline'} />
      <h2 className="mt-6 text-[26px] font-semibold tracking-[-0.03em]">Que veux-tu éclaircir ?</h2>
      <p className="mt-2 max-w-md text-[14px] text-ink-2">NEXUS connaît tes projets, tâches, objectifs et habitudes. Il peut agir pour toi — et il te dira quand ton raisonnement ne tient pas.</p>
      {online ? (
        <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s, i) => (
            <motion.button
              key={s}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              onClick={() => (i === 2 ? onFill('Je veux lancer ') : onPick(s))}
              className="panel panel-hover px-4 py-3 text-left text-[13px] text-ink-2 hover:text-ink"
            >
              {s}
            </motion.button>
          ))}
        </div>
      ) : (
        <Button className="mt-6" variant="primary" onClick={() => navigate('/settings')}>
          Activer l’IA
        </Button>
      )}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-line bg-white/[0.06] px-4 py-2.5 text-[14px] leading-relaxed">{text}</div>
    </motion.div>
  );
}

function AssistantTurn({ turn }: { turn: Turn }) {
  const lastText = turn.parts.map((p, i) => (p.type === 'text' ? i : -1)).filter((i) => i >= 0).pop();
  const empty = turn.parts.length === 0;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3.5">
      <Core size={26} state={turn.streaming ? 'thinking' : 'idle'} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-3">
        {empty && turn.streaming && <div className="pt-1 text-[13px] text-ink-3">NEXUS réfléchit…</div>}
        {turn.parts.map((p, i) =>
          p.type === 'text' ? (
            <div key={i} className={cx(turn.streaming && i === lastText && 'caret')}>
              <Markdown text={p.text} />
            </div>
          ) : p.type === 'thinking' ? (
            <Thinking key={i} text={p.text} live={Boolean(turn.streaming) && i === turn.parts.length - 1} />
          ) : (
            <ToolCard key={i} part={p} />
          ),
        )}
        {turn.error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.07] px-3.5 py-2.5 text-[13px] text-ink">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" />
            {turn.error}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-white/[0.015]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink-3 hover:text-ink-2">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="label !text-[10px]">{live ? 'Raisonnement en cours' : 'Raisonnement'}</span>
        {!open && <span className="truncate italic">{text.replace(/\s+/g, ' ').slice(0, 90)}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="whitespace-pre-wrap px-3 pb-3 text-[12.5px] leading-relaxed text-ink-3">{text}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function effectHref(e: ToolEffect): string | null {
  if (e.action === 'deleted') return null;
  if (e.kind in ENTITY) return ENTITY[e.kind as EntityKind].href(e.id);
  return '/analytics';
}

function ToolCard({ part }: { part: Extract<Part, { type: 'tool' }> }) {
  const pending = part.ok === undefined;
  const write = ['create_', 'update_', 'add_', 'capture_', 'remember', 'forget', 'link_', 'log_', 'check_'].some((p) => part.name.startsWith(p));
  const href = part.effect ? effectHref(part.effect) : null;
  return (
    <div className={cx('flex items-center gap-3 rounded-xl border px-3 py-2 text-[12.5px]', part.ok === false ? 'border-danger/25 bg-danger/[0.05]' : write && part.ok ? 'border-signal/25 bg-signal/[0.05]' : 'border-line bg-white/[0.015]')}>
      <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', write ? 'bg-signal/15 text-signal' : 'bg-white/[0.05] text-ink-3')}>
        {pending ? <Wrench size={12} className="animate-pulse" /> : part.ok ? <Check size={12} /> : <X size={12} className="text-danger" />}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-ink-2">{TOOL_LABELS[part.name] ?? part.name}</span>
        {part.summary && <span className="text-ink-3"> — {part.summary}</span>}
      </div>
      {href && part.ok && (
        <Link to={href} className="flex shrink-0 items-center gap-1 text-ink-3 hover:text-ink">
          Ouvrir <ArrowUpRight size={12} />
        </Link>
      )}
    </div>
  );
}

const MEMORY_KIND = { fact: 'Fait', preference: 'Préférence', decision: 'Décision', insight: 'Observation', context: 'Contexte' } as const;

function MemoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: memories = [] } = useApi<Memory[]>(['memories'], '/memories', { enabled: open });
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<keyof typeof MEMORY_KIND>('fact');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const add = useAction(() => api('/memories', { body: { content: draft, kind, importance: 3 } }), { success: 'Souvenir ajouté' });
  const del = useAction((id: string) => api(`/memories/${id}`, { method: 'DELETE' }));
  const save = useAction(({ id, content }: { id: string; content: string }) => api(`/memories/${id}`, { method: 'PATCH', body: { content } }));
  return (
    <Drawer open={open} onClose={onClose} width={480}>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <Brain size={16} className="text-s3" /> Mémoire long terme
          </div>
          <div className="mt-0.5 text-[12px] text-ink-3">Ce que NEXUS sait de toi. Tu gardes le contrôle total.</div>
        </div>
        <IconButton label="Fermer" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="border-b border-line p-4">
        <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ajoute une information que NEXUS doit retenir…" />
        <div className="mt-2 flex gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as keyof typeof MEMORY_KIND)} className="!h-8 !py-0 text-[12.5px]">
            {Object.entries(MEMORY_KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" icon={<Plus size={13} />} disabled={draft.trim().length < 3} loading={add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => setDraft('') })}>
            Ajouter
          </Button>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {memories.length === 0 && <EmptyState icon={<Brain size={18} />} title="Mémoire vide" text="NEXUS retiendra ce qui compte au fil de vos échanges." />}
        {memories.map((m) => (
          <div key={m.id} className="group rounded-xl border border-line bg-white/[0.02] p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <Badge tone={m.source === 'ai' ? 'signal' : 'neutral'}>{MEMORY_KIND[m.kind as keyof typeof MEMORY_KIND] ?? m.kind}</Badge>
              <span className="font-mono text-[10px] text-ink-3">{'●'.repeat(m.importance)}{'○'.repeat(5 - m.importance)}</span>
              <span className="flex-1" />
              <button aria-label="Modifier" onClick={() => (setEditing(m.id), setEditText(m.content))} className="text-ink-4 opacity-0 hover:text-ink group-hover:opacity-100">
                <Pencil size={12} />
              </button>
              <button aria-label="Supprimer" onClick={() => del.mutate(m.id)} className="text-ink-4 opacity-0 hover:text-danger group-hover:opacity-100">
                <Trash2 size={12} />
              </button>
            </div>
            {editing === m.id ? (
              <div>
                <Textarea rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Annuler
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => save.mutate({ id: m.id, content: editText }, { onSuccess: () => setEditing(null) })}>
                    Enregistrer
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-[13px] leading-relaxed">{m.content}</div>
            )}
            <div className="mt-1.5 font-mono text-[10px] text-ink-3">
              {m.source === 'ai' ? 'retenu par NEXUS' : 'ajouté par toi'} · {relTime(m.created_at)}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
