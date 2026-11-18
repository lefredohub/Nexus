/**
 * Outils que NEXUS AI peut utiliser.
 *
 * Contrôle d'accès :
 * - chaque outil est classé `read` (lecture) ou `write` (modification) ;
 * - si l'écriture est désactivée dans Réglages, les outils `write` refusent
 *   de s'exécuter et l'IA reçoit un message d'erreur explicite ;
 * - toute écriture est tracée dans le flux d'activité avec l'acteur « ai ».
 *
 * Note technique : la liste d'outils envoyée à l'API reste IDENTIQUE quel que
 * soit le réglage (l'historique de conversation doit rester stable pour que
 * le raisonnement du modèle soit réutilisable). Le contrôle se fait donc à
 * l'exécution, pas en masquant les outils.
 */
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type { DB } from '../db/client';
import { todayISO } from '../db/client';
import { ENTITY_KINDS, GOAL_AREAS, MEMORY_KINDS, PROJECT_STATUS, RISK_SEVERITY, TASK_STATUS, WORKOUT_TYPES, isoDate, type EntityKind } from '../../shared/schemas';
import { overviewForAI } from '../repos/overview';
import { search } from '../repos/search';
import { listProjects, getProject, createProject, updateProject, addMilestone, addRisk } from '../repos/projects';
import { listTasks, createTask, updateTask } from '../repos/tasks';
import { listGoals, createGoal, updateGoal } from '../repos/goals';
import { listIdeas, createIdea } from '../repos/ideas';
import { createNote, listMemories, createMemory, deleteMemory } from '../repos/notes';
import { createLink, linksFor } from '../repos/links';
import { financeSummary, sportSummary, listHabits, listMetrics, createTransaction, createWorkout, setHabitCheck, addMetricEntry } from '../repos/analytics';

export interface ToolContext {
  db: DB;
  allowWrites: boolean;
}

/** Référence vers une entité créée/modifiée, affichée comme « carte d'action » dans l'interface. */
export interface ToolEffect {
  kind: EntityKind | 'transaction' | 'workout' | 'habit' | 'metric';
  id: string;
  title: string;
  action: 'created' | 'updated' | 'deleted' | 'linked';
}

export interface ToolOutcome {
  ok: boolean;
  /** Contenu renvoyé au modèle (JSON compact). */
  content: string;
  effect?: ToolEffect;
  summary: string;
}

interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  access: 'read' | 'write';
  schema: S;
  run: (input: z.output<S>, ctx: ToolContext) => { data: unknown; summary: string; effect?: ToolEffect };
}

const def = <S extends z.ZodType>(t: ToolDef<S>) => t as unknown as ToolDef;

const pct = (n: number) => Math.round(n * 100);
const id = z.string().min(3);
const optDate = isoDate.optional().describe('Date AAAA-MM-JJ');

export const TOOLS: ToolDef[] = [
  // ── Lecture ────────────────────────────────────────────────────────────────
  def({
    name: 'get_overview',
    description: "Photo à jour de la situation de l'utilisateur : tâches, projets, objectifs, habitudes, finances, sport. À utiliser pour toute question générale (« où j'en suis ? »).",
    access: 'read',
    schema: z.object({}),
    run: (_i, { db }) => ({ data: overviewForAI(db), summary: "Vue d'ensemble consultée" }),
  }),
  def({
    name: 'search_knowledge',
    description: "Recherche plein texte dans toute la mémoire de NEXUS (projets, tâches, objectifs, idées, notes, souvenirs). À utiliser dès que l'utilisateur fait référence à quelque chose de passé ou demande « est-ce que j'avais… ».",
    access: 'read',
    schema: z.object({
      query: z.string().min(2).describe('Mots-clés'),
      kinds: z.array(z.enum(ENTITY_KINDS)).optional().describe('Restreindre à certains types'),
    }),
    run: (i, { db }) => {
      const hits = search(db, i.query, { kinds: i.kinds, limit: 15 });
      return { data: hits.map((h) => ({ kind: h.kind, id: h.ref_id, title: h.title, extrait: h.snippet })), summary: `${hits.length} résultat(s) pour « ${i.query} »` };
    },
  }),
  def({
    name: 'list_projects',
    description: 'Liste les projets avec progression, santé, budget et échéance.',
    access: 'read',
    schema: z.object({ status: z.enum(PROJECT_STATUS).optional() }),
    run: (i, { db }) => {
      const ps = listProjects(db, { status: i.status, includeArchived: i.status === 'archived' });
      return {
        data: ps.map((p) => ({ id: p.id, title: p.title, status: p.status, priority: p.priority, progress_pct: pct(p.progress), health: p.health, due_date: p.due_date, budget: p.budget_planned ? `${p.budget_spent}/${p.budget_planned} ${p.currency}` : null, tasks_open: p.tasks_open, tasks_overdue: p.tasks_overdue })),
        summary: `${ps.length} projet(s)`,
      };
    },
  }),
  def({
    name: 'get_project',
    description: "Détail complet d'un projet : description, objectif, étapes, risques, budget, dépenses, tâches, notes, dernière analyse.",
    access: 'read',
    schema: z.object({ project_id: id }),
    run: (i, { db }) => {
      const p = getProject(db, i.project_id);
      return {
        data: {
          id: p.id, title: p.title, status: p.status, priority: p.priority, description: p.description, objective: p.objective, notes: p.notes.slice(0, 4000),
          start_date: p.start_date, due_date: p.due_date, progress_pct: pct(p.progress), health: p.health, goal: p.goal_title,
          budget: { planned: p.budget_planned, spent: p.budget_spent, currency: p.currency },
          milestones: p.milestones.map((m) => ({ id: m.id, title: m.title, done: !!m.done, due_date: m.due_date })),
          risks: p.risks.map((r) => ({ id: r.id, title: r.title, severity: r.severity, status: r.status, mitigation: r.mitigation })),
          tasks: p.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date })),
          last_analysis: p.analysis ? { date: p.analysis.created_at, health_score: p.analysis.analysis.health_score, summary: p.analysis.analysis.summary } : null,
        },
        summary: `Projet « ${p.title} » consulté`,
      };
    },
  }),
  def({
    name: 'list_tasks',
    description: 'Liste des tâches filtrées. status "open" = toutes les tâches non terminées.',
    access: 'read',
    schema: z.object({
      status: z.enum(['todo', 'doing', 'done', 'open']).optional(),
      project_id: id.optional(),
      due_before: optDate,
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: (i, { db }) => {
      const ts = listTasks(db, { ...i, limit: i.limit ?? 50 });
      return { data: ts.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, project: t.project_title, notes: t.notes.slice(0, 300) })), summary: `${ts.length} tâche(s)` };
    },
  }),
  def({
    name: 'list_goals',
    description: 'Liste des objectifs avec progression chiffrée.',
    access: 'read',
    schema: z.object({ include_inactive: z.boolean().optional() }),
    run: (i, { db }) => {
      const gs = listGoals(db, { includeInactive: i.include_inactive });
      return { data: gs.map((g) => ({ id: g.id, title: g.title, area: g.area, status: g.status, progress_pct: pct(g.progress), current: g.current_value, target: g.target_value, unit: g.metric_unit, due_date: g.due_date, description: g.description })), summary: `${gs.length} objectif(s)` };
    },
  }),
  def({
    name: 'list_ideas',
    description: "Liste des idées (inbox, analysées, converties) avec les scores d'analyse.",
    access: 'read',
    schema: z.object({ status: z.enum(['inbox', 'analyzed', 'converted', 'archived']).optional() }),
    run: (i, { db }) => {
      const xs = listIdeas(db, i);
      return { data: xs.map((x) => ({ id: x.id, title: x.title, content: x.content.slice(0, 500), status: x.status, feasibility: x.analysis?.feasibility.score, potential: x.analysis?.potential.score, verdict: x.analysis?.verdict })), summary: `${xs.length} idée(s)` };
    },
  }),
  def({
    name: 'get_analytics',
    description: 'Données chiffrées personnelles : finances (6 mois), sport (12 semaines), habitudes (séries), métriques suivies.',
    access: 'read',
    schema: z.object({ domain: z.enum(['finance', 'sport', 'habits', 'metrics', 'all']) }),
    run: (i, { db }) => {
      const out: Record<string, unknown> = {};
      if (i.domain === 'finance' || i.domain === 'all') out.finance = financeSummary(db, 6);
      if (i.domain === 'sport' || i.domain === 'all') out.sport = sportSummary(db, 12);
      if (i.domain === 'habits' || i.domain === 'all') out.habits = listHabits(db, 60).map((h) => ({ id: h.id, name: h.name, streak: h.streak, week_count: h.week_count, target_per_week: h.target_per_week, rate_30d_pct: pct(h.rate_30d), done_today: h.done_today }));
      if (i.domain === 'metrics' || i.domain === 'all') out.metrics = listMetrics(db, 90).map((m) => ({ id: m.id, name: m.name, unit: m.unit, target: m.target, last: m.last?.value ?? null, delta_90d: m.delta, points: m.entries.slice(-20).map((e) => [e.date, e.value]) }));
      return { data: out, summary: `Analytics « ${i.domain} » consultées` };
    },
  }),
  def({
    name: 'list_memories',
    description: "Tout ce que NEXUS a mémorisé sur l'utilisateur (faits, préférences, décisions).",
    access: 'read',
    schema: z.object({}),
    run: (_i, { db }) => {
      const ms = listMemories(db, 150);
      return { data: ms.map((m) => ({ id: m.id, kind: m.kind, importance: m.importance, content: m.content, date: m.created_at.slice(0, 10) })), summary: `${ms.length} souvenir(s)` };
    },
  }),
  def({
    name: 'get_connections',
    description: "Éléments reliés à une entité dans le Memory Graph.",
    access: 'read',
    schema: z.object({ kind: z.enum(ENTITY_KINDS), id }),
    run: (i, { db }) => {
      const ls = linksFor(db, i.kind, i.id);
      return { data: ls, summary: `${ls.length} connexion(s)` };
    },
  }),

  // ── Écriture ───────────────────────────────────────────────────────────────
  def({
    name: 'create_task',
    description: 'Crée une tâche. Priorité 1 = haute, 2 = normale, 3 = basse.',
    access: 'write',
    schema: z.object({
      title: z.string().min(1).max(200),
      notes: z.string().max(4000).optional(),
      priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      due_date: optDate,
      project_id: id.optional(),
      goal_id: id.optional(),
    }),
    run: (i, { db }) => {
      const t = createTask(db, i, 'ai');
      return { data: { id: t.id, title: t.title }, summary: `Tâche créée : ${t.title}`, effect: { kind: 'task', id: t.id, title: t.title, action: 'created' } };
    },
  }),
  def({
    name: 'update_task',
    description: "Modifie une tâche (statut, priorité, échéance, titre, notes, projet). Pour marquer terminée : status = 'done'.",
    access: 'write',
    schema: z.object({
      task_id: id,
      title: z.string().min(1).max(200).optional(),
      status: z.enum(TASK_STATUS).optional(),
      priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      due_date: isoDate.nullable().optional(),
      notes: z.string().max(4000).optional(),
      project_id: id.nullable().optional(),
    }),
    run: ({ task_id, ...patch }, { db }) => {
      const t = updateTask(db, task_id, patch, 'ai');
      return { data: { id: t.id, title: t.title, status: t.status }, summary: `Tâche mise à jour : ${t.title}`, effect: { kind: 'task', id: t.id, title: t.title, action: 'updated' } };
    },
  }),
  def({
    name: 'create_project',
    description: 'Crée un projet structuré, avec étapes et risques optionnels. Utilise-le pour transformer une idée mûre en projet.',
    access: 'write',
    schema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(8000).optional(),
      objective: z.string().max(2000).optional().describe('Résultat mesurable visé'),
      status: z.enum(PROJECT_STATUS).optional(),
      priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      start_date: optDate,
      due_date: optDate,
      budget_planned: z.number().min(0).optional(),
      goal_id: id.optional(),
      milestones: z.array(z.string().min(1).max(200)).max(20).optional().describe('Étapes ordonnées'),
      risks: z.array(z.object({ title: z.string().min(1).max(200), severity: z.enum(RISK_SEVERITY).optional(), mitigation: z.string().max(2000).optional() })).max(15).optional(),
    }),
    run: ({ milestones, risks, ...input }, { db }) => {
      const p = createProject(db, input, 'ai', { milestones, risks });
      return { data: { id: p.id, title: p.title, milestones: p.milestones.length, risks: p.risks.length }, summary: `Projet créé : ${p.title}`, effect: { kind: 'project', id: p.id, title: p.title, action: 'created' } };
    },
  }),
  def({
    name: 'update_project',
    description: "Modifie les champs d'un projet (statut, description, objectif, échéance, budget, notes…).",
    access: 'write',
    schema: z.object({
      project_id: id,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(8000).optional(),
      objective: z.string().max(2000).optional(),
      status: z.enum(PROJECT_STATUS).optional(),
      priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      due_date: isoDate.nullable().optional(),
      budget_planned: z.number().min(0).nullable().optional(),
      notes: z.string().max(50000).optional(),
      goal_id: id.nullable().optional(),
    }),
    run: ({ project_id, ...patch }, { db }) => {
      const p = updateProject(db, project_id, patch, 'ai');
      return { data: { id: p.id, title: p.title, status: p.status }, summary: `Projet mis à jour : ${p.title}`, effect: { kind: 'project', id: p.id, title: p.title, action: 'updated' } };
    },
  }),
  def({
    name: 'add_project_items',
    description: 'Ajoute des étapes et/ou des risques à un projet existant.',
    access: 'write',
    schema: z.object({
      project_id: id,
      milestones: z.array(z.string().min(1).max(200)).max(20).optional(),
      risks: z.array(z.object({ title: z.string().min(1).max(200), severity: z.enum(RISK_SEVERITY).optional(), mitigation: z.string().max(2000).optional() })).max(15).optional(),
    }),
    run: (i, { db }) => {
      const p = getProject(db, i.project_id);
      i.milestones?.forEach((title) => addMilestone(db, p.id, { title }));
      i.risks?.forEach((r) => addRisk(db, p.id, r));
      return { data: { added_milestones: i.milestones?.length ?? 0, added_risks: i.risks?.length ?? 0 }, summary: `Projet enrichi : ${p.title}`, effect: { kind: 'project', id: p.id, title: p.title, action: 'updated' } };
    },
  }),
  def({
    name: 'create_goal',
    description: 'Crée un objectif, idéalement mesurable (valeur cible + unité).',
    access: 'write',
    schema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(4000).optional(),
      area: z.enum(GOAL_AREAS).optional(),
      metric_unit: z.string().max(30).optional(),
      start_value: z.number().optional(),
      target_value: z.number().optional(),
      current_value: z.number().optional(),
      due_date: optDate,
    }),
    run: (i, { db }) => {
      const g = createGoal(db, i, 'ai');
      return { data: { id: g.id, title: g.title }, summary: `Objectif créé : ${g.title}`, effect: { kind: 'goal', id: g.id, title: g.title, action: 'created' } };
    },
  }),
  def({
    name: 'update_goal',
    description: "Met à jour un objectif (valeur actuelle, statut, échéance…).",
    access: 'write',
    schema: z.object({
      goal_id: id,
      current_value: z.number().optional(),
      target_value: z.number().nullable().optional(),
      status: z.enum(['active', 'achieved', 'paused', 'abandoned']).optional(),
      due_date: isoDate.nullable().optional(),
      description: z.string().max(4000).optional(),
    }),
    run: ({ goal_id, ...patch }, { db }) => {
      const g = updateGoal(db, goal_id, patch, 'ai');
      return { data: { id: g.id, progress_pct: pct(g.progress) }, summary: `Objectif mis à jour : ${g.title}`, effect: { kind: 'goal', id: g.id, title: g.title, action: 'updated' } };
    },
  }),
  def({
    name: 'capture_idea',
    description: "Dépose une idée brute dans l'Idea Engine (inbox).",
    access: 'write',
    schema: z.object({ content: z.string().min(3).max(20000), title: z.string().max(200).optional() }),
    run: (i, { db }) => {
      const x = createIdea(db, i, 'ai');
      return { data: { id: x.id }, summary: `Idée capturée`, effect: { kind: 'idea', id: x.id, title: x.title ?? x.content.slice(0, 60), action: 'created' } };
    },
  }),
  def({
    name: 'create_note',
    description: 'Crée une note de connaissance (réflexion, synthèse, référence) dans le Memory Graph.',
    access: 'write',
    schema: z.object({ title: z.string().min(1).max(200), content: z.string().max(50000), tags: z.array(z.string().max(40)).max(20).optional() }),
    run: (i, { db }) => {
      const n = createNote(db, i, 'ai');
      return { data: { id: n.id }, summary: `Note créée : ${n.title}`, effect: { kind: 'note', id: n.id, title: n.title, action: 'created' } };
    },
  }),
  def({
    name: 'remember',
    description: "Mémorise durablement une information sur l'utilisateur (préférence, fait, décision, contexte). N'enregistre que ce qui sera utile plus tard, formulé de façon autonome et datée si pertinent.",
    access: 'write',
    schema: z.object({
      content: z.string().min(3).max(2000),
      kind: z.enum(MEMORY_KINDS),
      importance: z.number().int().min(1).max(5).describe('5 = essentiel'),
    }),
    run: (i, { db }) => {
      const m = createMemory(db, i, 'ai');
      return { data: { id: m.id }, summary: 'Information mémorisée', effect: { kind: 'memory', id: m.id, title: m.content.slice(0, 80), action: 'created' } };
    },
  }),
  def({
    name: 'forget',
    description: "Supprime un souvenir devenu faux ou obsolète (à la demande de l'utilisateur ou en cas de contradiction avérée).",
    access: 'write',
    schema: z.object({ memory_id: id }),
    run: (i, { db }) => {
      deleteMemory(db, i.memory_id);
      return { data: { deleted: i.memory_id }, summary: 'Souvenir supprimé', effect: { kind: 'memory', id: i.memory_id, title: 'Souvenir supprimé', action: 'deleted' } };
    },
  }),
  def({
    name: 'link_items',
    description: 'Relie deux éléments dans le Memory Graph (ex. une note et un projet, une idée et un objectif).',
    access: 'write',
    schema: z.object({
      source_kind: z.enum(ENTITY_KINDS),
      source_id: id,
      target_kind: z.enum(ENTITY_KINDS),
      target_id: id,
      label: z.string().max(80).optional().describe('Nature du lien, ex. « inspire », « bloque », « contribue à »'),
    }),
    run: (i, { db }) => {
      const l = createLink(db, { source: { kind: i.source_kind, id: i.source_id }, target: { kind: i.target_kind, id: i.target_id }, label: i.label ?? '' });
      return { data: { link_id: l.id }, summary: 'Éléments reliés', effect: { kind: i.source_kind, id: i.source_id, title: `Lien ${i.source_kind} → ${i.target_kind}`, action: 'linked' } };
    },
  }),
  def({
    name: 'log_transaction',
    description: 'Enregistre une opération financière. Montant positif = revenu, négatif = dépense.',
    access: 'write',
    schema: z.object({ amount: z.number(), category: z.string().min(1).max(60), label: z.string().max(200).optional(), date: optDate }),
    run: (i, { db }) => {
      const t = createTransaction(db, { ...i, date: i.date ?? todayISO() }, 'ai');
      return { data: { id: t.id }, summary: `Opération ${t.amount > 0 ? '+' : ''}${t.amount} (${t.category})`, effect: { kind: 'transaction', id: t.id, title: `${t.label || t.category} ${t.amount}`, action: 'created' } };
    },
  }),
  def({
    name: 'log_workout',
    description: 'Enregistre une séance de sport.',
    access: 'write',
    schema: z.object({
      type: z.enum(WORKOUT_TYPES),
      duration_min: z.number().positive(),
      distance_km: z.number().min(0).optional(),
      intensity: z.number().int().min(1).max(5).optional(),
      notes: z.string().max(2000).optional(),
      date: optDate,
    }),
    run: (i, { db }) => {
      const w = createWorkout(db, { ...i, date: i.date ?? todayISO() }, 'ai');
      return { data: { id: w.id }, summary: `Séance ${w.type} · ${w.duration_min} min`, effect: { kind: 'workout', id: w.id, title: `${w.type} ${w.duration_min} min`, action: 'created' } };
    },
  }),
  def({
    name: 'check_habit',
    description: "Coche (ou décoche) une habitude pour un jour. Utilise get_analytics domain=habits pour obtenir les identifiants.",
    access: 'write',
    schema: z.object({ habit_id: id, date: optDate, done: z.boolean().optional() }),
    run: (i, { db }) => {
      const done = setHabitCheck(db, i.habit_id, i.date ?? todayISO(), i.done ?? true, 'ai');
      return { data: { done }, summary: done ? 'Habitude cochée' : 'Habitude décochée', effect: { kind: 'habit', id: i.habit_id, title: 'Habitude', action: 'updated' } };
    },
  }),
  def({
    name: 'log_metric',
    description: "Ajoute une valeur à une métrique suivie (poids, sommeil…). Utilise get_analytics domain=metrics pour les identifiants.",
    access: 'write',
    schema: z.object({ metric_id: id, value: z.number(), date: optDate, note: z.string().max(500).optional() }),
    run: (i, { db }) => {
      const e = addMetricEntry(db, i.metric_id, { value: i.value, date: i.date ?? todayISO(), note: i.note ?? '' }, 'ai');
      return { data: { id: e.id }, summary: `Métrique enregistrée : ${e.value}`, effect: { kind: 'metric', id: i.metric_id, title: `Valeur ${e.value}`, action: 'created' } };
    },
  }),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function isWriteTool(name: string): boolean {
  return BY_NAME.get(name)?.access === 'write';
}

/** Définitions envoyées à l'API (JSON Schema généré depuis Zod, ordre stable). */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.schema, { io: 'input' }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: t.name,
      description: `${t.description}${t.access === 'write' ? ' [MODIFIE LES DONNÉES]' : ''}`,
      input_schema: schema as Anthropic.Beta.BetaTool['input_schema'],
      eager_input_streaming: true,
    };
  });
}

/** Exécute un outil demandé par le modèle, avec validation et contrôle d'accès. */
export function executeTool(name: string, rawInput: unknown, ctx: ToolContext): ToolOutcome {
  const tool = BY_NAME.get(name);
  if (!tool) return { ok: false, content: `Outil inconnu : ${name}`, summary: `Outil inconnu : ${name}` };
  if (tool.access === 'write' && !ctx.allowWrites) {
    return {
      ok: false,
      content: "Refusé : l'utilisateur a désactivé les modifications par l'IA (mode lecture seule). Propose l'action en texte à la place.",
      summary: 'Écriture bloquée (mode lecture seule)',
    };
  }
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
    return { ok: false, content: `Paramètres invalides — ${issues}`, summary: 'Paramètres invalides' };
  }
  try {
    const { data, summary, effect } = tool.run(parsed.data, ctx);
    return { ok: true, content: typeof data === 'string' ? data : JSON.stringify(data), summary, effect };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, content: `Erreur : ${message}`, summary: `Échec : ${message}` };
  }
}
