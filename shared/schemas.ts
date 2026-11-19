/**
 * Schémas de validation partagés entre le serveur et l'interface.
 *
 * Chaque donnée qui entre dans NEXUS (formulaire, API, outil IA) passe par
 * l'un de ces schémas. C'est la seule source de vérité sur la forme des données :
 * si tu ajoutes un champ, ajoute-le ici d'abord.
 */
import { z } from 'zod';

// ─── Primitives ──────────────────────────────────────────────────────────────

/** Date calendaire au format AAAA-MM-JJ. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ');
const optionalDate = isoDate.nullable().optional();
const text = (max: number) => z.string().trim().max(max);
const title = z.string().trim().min(1, 'Titre requis').max(200);

export const PRIORITY = [1, 2, 3] as const; // 1 = haute, 3 = basse
export const priority = z.union([z.literal(1), z.literal(2), z.literal(3)]);

// ─── Objectifs ───────────────────────────────────────────────────────────────

export const GOAL_AREAS = ['career', 'finance', 'health', 'learning', 'personal', 'relationships'] as const;
export const GOAL_STATUS = ['active', 'achieved', 'paused', 'abandoned'] as const;

export const goalInput = z.object({
  title,
  description: text(4000).default(''),
  area: z.enum(GOAL_AREAS).default('personal'),
  metric_unit: text(30).nullable().optional(),
  start_value: z.number().finite().default(0),
  target_value: z.number().finite().nullable().optional(),
  current_value: z.number().finite().default(0),
  due_date: optionalDate,
  status: z.enum(GOAL_STATUS).default('active'),
});
export const goalPatch = goalInput.partial();

// ─── Projets ─────────────────────────────────────────────────────────────────

export const PROJECT_STATUS = ['planning', 'active', 'paused', 'done', 'archived'] as const;
export const RISK_SEVERITY = ['low', 'medium', 'high'] as const;

export const projectInput = z.object({
  title,
  description: text(8000).default(''),
  objective: text(2000).default(''),
  status: z.enum(PROJECT_STATUS).default('planning'),
  priority: priority.default(2),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ff6b2c'),
  budget_planned: z.number().finite().min(0).nullable().optional(),
  currency: z.string().trim().length(3).default('EUR'),
  start_date: optionalDate,
  due_date: optionalDate,
  notes: text(50000).default(''),
  goal_id: z.string().nullable().optional(),
});
export const projectPatch = projectInput.partial();

export const milestoneInput = z.object({
  title,
  done: z.boolean().default(false),
  due_date: optionalDate,
});
export const milestonePatch = milestoneInput.partial().extend({ position: z.number().int().min(0).optional() });

export const riskInput = z.object({
  title,
  severity: z.enum(RISK_SEVERITY).default('medium'),
  mitigation: text(2000).default(''),
  status: z.enum(['open', 'mitigated']).default('open'),
});
export const riskPatch = riskInput.partial();

export const expenseInput = z.object({
  label: title,
  amount: z.number().finite().positive('Montant positif attendu'),
  date: isoDate,
});

// ─── Tâches ──────────────────────────────────────────────────────────────────

export const TASK_STATUS = ['todo', 'doing', 'done'] as const;

export const taskInput = z.object({
  title,
  notes: text(8000).default(''),
  status: z.enum(TASK_STATUS).default('todo'),
  priority: priority.default(2),
  due_date: optionalDate,
  project_id: z.string().nullable().optional(),
  goal_id: z.string().nullable().optional(),
});
export const taskPatch = taskInput.partial();

// ─── Idées ───────────────────────────────────────────────────────────────────

export const IDEA_STATUS = ['inbox', 'analyzed', 'converted', 'archived'] as const;
export const ideaInput = z.object({
  content: z.string().trim().min(3, 'Décris ton idée en quelques mots').max(20000),
  title: text(200).nullable().optional(),
});
export const ideaPatch = z.object({
  content: z.string().trim().min(3).max(20000).optional(),
  title: text(200).nullable().optional(),
  status: z.enum(IDEA_STATUS).optional(),
});

/** Résultat d'analyse d'une idée produit par Claude (sortie structurée). */
export const IDEA_CATEGORIES = ['business', 'product', 'creative', 'personal', 'learning', 'health', 'finance', 'tech', 'other'] as const;
export const ideaAnalysis = z.object({
  title: z.string().describe('Titre court et explicite (max ~8 mots)'),
  summary: z.string().describe("Reformulation claire de l'idée en 2-3 phrases"),
  category: z.enum(IDEA_CATEGORIES),
  tags: z.array(z.string()).describe('3 à 6 mots-clés'),
  feasibility: z.object({ score: z.number().describe('0 à 10'), rationale: z.string() }),
  potential: z.object({ score: z.number().describe('0 à 10'), rationale: z.string() }),
  effort: z.enum(['low', 'medium', 'high']),
  risks: z.array(z.string()),
  open_questions: z.array(z.string()).describe('Questions critiques à trancher avant de se lancer'),
  plan: z.array(z.object({ title: z.string(), description: z.string() })).describe('3 à 7 étapes concrètes'),
  first_action: z.string().describe('Une action concrète réalisable en moins de 2 heures'),
  verdict: z.enum(['pursue', 'explore', 'park', 'drop']),
  verdict_reason: z.string(),
});
export type IdeaAnalysis = z.infer<typeof ideaAnalysis>;

/** Résultat d'analyse critique d'un projet produit par Claude. */
export const projectAnalysis = z.object({
  health_score: z.number().describe('0 à 100'),
  summary: z.string().describe('Diagnostic franc en 2-4 phrases'),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.object({ title: z.string(), detail: z.string(), severity: z.enum(RISK_SEVERITY) })),
  missing_risks: z.array(z.object({ title: z.string(), severity: z.enum(RISK_SEVERITY), mitigation: z.string() })),
  next_actions: z.array(z.object({ title: z.string(), priority: z.number().describe('1 haute, 2 normale, 3 basse'), rationale: z.string() })),
  questions: z.array(z.string()),
});
export type ProjectAnalysis = z.infer<typeof projectAnalysis>;

/** Briefing quotidien produit par Claude. */
export const briefingSchema = z.object({
  headline: z.string().describe('Une phrase qui résume la situation du jour'),
  focus: z.array(z.object({ title: z.string(), why: z.string() })).describe('2 à 4 priorités du jour'),
  alerts: z.array(z.string()).describe('Points de vigilance factuels (retards, budgets, habitudes)'),
  insight: z.string().describe('Une observation ou un conseil non évident tiré des données'),
});
export type Briefing = z.infer<typeof briefingSchema>;

// ─── Notes, mémoire, liens ───────────────────────────────────────────────────

export const noteInput = z.object({
  title,
  content: text(50000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  pinned: z.boolean().default(false),
});
export const notePatch = noteInput.partial();

export const MEMORY_KINDS = ['fact', 'preference', 'decision', 'insight', 'context'] as const;
export const memoryInput = z.object({
  content: z.string().trim().min(3).max(2000),
  kind: z.enum(MEMORY_KINDS).default('fact'),
  importance: z.number().int().min(1).max(5).default(3),
});
export const memoryPatch = memoryInput.partial();

export const ENTITY_KINDS = ['project', 'task', 'goal', 'idea', 'note', 'memory'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const entityRef = z.object({ kind: z.enum(ENTITY_KINDS), id: z.string().min(1) });
export const linkInput = z.object({
  source: entityRef,
  target: entityRef,
  label: text(80).default(''),
});

// ─── Analytics ───────────────────────────────────────────────────────────────

export const transactionInput = z.object({
  date: isoDate,
  amount: z.number().finite().refine((n) => n !== 0, 'Montant non nul'),
  category: z.string().trim().min(1).max(60).default('Divers'),
  label: text(200).default(''),
});

export const WORKOUT_TYPES = ['run', 'bike', 'swim', 'strength', 'walk', 'yoga', 'hiit', 'sport', 'other'] as const;
export const workoutInput = z.object({
  date: isoDate,
  type: z.enum(WORKOUT_TYPES).default('other'),
  duration_min: z.number().finite().positive().max(1440),
  distance_km: z.number().finite().min(0).nullable().optional(),
  intensity: z.number().int().min(1).max(5).default(3),
  notes: text(2000).default(''),
});

export const habitInput = z.object({
  name: z.string().trim().min(1).max(60),
  target_per_week: z.number().int().min(1).max(7).default(7),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7ee0b5'),
});
export const habitPatch = habitInput.partial().extend({ archived: z.boolean().optional() });

export const metricInput = z.object({
  name: z.string().trim().min(1).max(60),
  unit: text(20).default(''),
  category: z.enum(['health', 'productivity', 'finance', 'sport', 'custom']).default('custom'),
  target: z.number().finite().nullable().optional(),
  direction: z.enum(['up', 'down']).default('up'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#8fb8ff'),
});
export const metricEntryInput = z.object({
  date: isoDate,
  value: z.number().finite(),
  note: text(500).default(''),
});

export const csvImportInput = z.object({
  csv: z.string().min(1).max(2_000_000),
  delimiter: z.enum([',', ';', '\t']).optional(),
  columns: z.object({ date: z.string(), amount: z.string(), label: z.string().optional(), category: z.string().optional() }),
  dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']).default('YYYY-MM-DD'),
  invertSign: z.boolean().default(false),
});

// ─── Automatisations ─────────────────────────────────────────────────────────

export const AUTOMATION_EVENTS = [
  'task.created',
  'task.completed',
  'project.created',
  'idea.created',
  'workout.logged',
  'transaction.logged',
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export const automationTrigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({
    type: z.literal('schedule'),
    every: z.number().int().min(1).max(1000),
    unit: z.enum(['minutes', 'hours', 'days']),
    at: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  }),
  z.object({ type: z.literal('event'), event: z.enum(AUTOMATION_EVENTS) }),
]);
export type AutomationTrigger = z.infer<typeof automationTrigger>;

export const automationStep = z.object({
  id: z.string().min(1).max(40),
  type: z.string().min(1),
  name: text(80).default(''),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type AutomationStep = z.infer<typeof automationStep>;

export const automationInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: text(1000).default(''),
  enabled: z.boolean().default(true),
  trigger: automationTrigger.default({ type: 'manual' }),
  steps: z.array(automationStep).max(30).default([]),
});
export const automationPatch = automationInput.partial();

// ─── Conversations & réglages ────────────────────────────────────────────────

export const chatInput = z.object({
  conversationId: z.string().nullable().optional(),
  message: z.string().trim().min(1).max(30000),
  /** Mode vocal (Jarvis) : la réponse sera lue à voix haute, donc courte et sans mise en forme. */
  voice: z.boolean().optional(),
});

export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'] as const;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export const settingsPatch = z.object({
  user_name: text(60).optional(),
  ai_provider: z.enum(['anthropic', 'ollama']).optional(),
  /** Nom de modèle Ollama, ex. « qwen3:8b » ou « llama3.1:8b ». */
  ollama_model: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:\/-]{0,99}$/, 'Nom de modèle invalide').optional(),
  ai_model: z.enum(AI_MODELS).optional(),
  ai_effort: z.enum(EFFORTS).optional(),
  ai_allow_writes: z.boolean().optional(),
  currency: z.string().trim().length(3).optional(),
  onboarded: z.boolean().optional(),
});

export const apiKeyInput = z.object({
  apiKey: z.string().trim().regex(/^sk-ant-[A-Za-z0-9_\-]{20,}$/, 'Clé Anthropic invalide (doit commencer par sk-ant-)'),
});

// ─── Accès distant (iPhone) ──────────────────────────────────────────────────

export const REMOTE_MODES = ['off', 'lan', 'tailscale'] as const;
export const remotePatch = z.object({ mode: z.enum(REMOTE_MODES) });
export const pairInput = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Le code contient 6 chiffres'),
  name: z.string().trim().max(60).default(''),
});
