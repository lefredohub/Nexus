/**
 * Fonctions IA « à sortie structurée » : Claude renvoie un objet JSON validé
 * par un schéma Zod (analyse d'idée, analyse de projet, briefing du jour).
 */
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { getClient, baseParams, toAppError, type AIDeps } from './client';
import { AppError } from '../lib/errors';
import { ideaAnalysis, projectAnalysis, briefingSchema, type IdeaAnalysis, type ProjectAnalysis, type Briefing } from '../../shared/schemas';
import { getIdea, saveIdeaAnalysis, type Idea } from '../repos/ideas';
import { getProject, saveProjectAnalysis } from '../repos/projects';
import { listProjects } from '../repos/projects';
import { listMemories } from '../repos/notes';
import { overviewForAI } from '../repos/overview';
import { get, run, nowISO, todayISO, parseJSON } from '../db/client';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));

async function structured<S extends z.ZodType>(deps: AIDeps, schema: S, system: string, prompt: string, effort?: string): Promise<{ data: z.infer<S>; model: string }> {
  const client = getClient(deps);
  try {
    const res = await client.beta.messages.parse({
      ...baseParams(deps, { effort }),
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { ...baseParams(deps, { effort }).output_config, format: betaZodOutputFormat(schema) },
    });
    if (res.stop_reason === 'refusal') throw new AppError(422, 'refusal', 'Le modèle a refusé cette demande.');
    if (res.stop_reason === 'max_tokens') throw new AppError(502, 'truncated', 'Réponse tronquée : réessaie.');
    if (!res.parsed_output) throw new AppError(502, 'invalid_output', "La réponse de l'IA n'a pas pu être interprétée.");
    return { data: res.parsed_output as z.infer<S>, model: res.model };
  } catch (err) {
    throw toAppError(err);
  }
}

const memoryDigest = (deps: AIDeps) =>
  listMemories(deps.db, 30)
    .map((m) => `- ${m.content}`)
    .join('\n') || '(aucun)';

// ─── Idea Engine ─────────────────────────────────────────────────────────────

export async function analyzeIdea(deps: AIDeps, ideaId: string): Promise<Idea> {
  const idea = getIdea(deps.db, ideaId);
  const existing = listProjects(deps.db).map((p) => `- ${p.title} (${p.status})`).join('\n') || '(aucun)';
  const { data } = await structured(
    deps,
    ideaAnalysis,
    "Tu es le moteur d'analyse d'idées de NEXUS. Tu évalues les idées avec rigueur et honnêteté : une idée faible doit recevoir un score faible et un verdict « park » ou « drop », argumenté. Tu tiens compte du contexte de la personne (ses projets en cours, sa charge, ses contraintes connues). Réponds en français.",
    `Idée brute déposée par l'utilisateur :
"""
${idea.content}
"""

Ce que NEXUS sait de l'utilisateur :
${memoryDigest(deps)}

Projets existants (pour repérer doublons, synergies ou dispersion) :
${existing}

Analyse cette idée : reformule-la, catégorise-la, évalue faisabilité et potentiel (0-10, argumentés), liste les risques et les questions critiques, propose un plan de 3 à 7 étapes concrètes et une première action réalisable en moins de 2 heures. Donne un verdict : pursue (s'y mettre), explore (creuser d'abord), park (mettre de côté), drop (abandonner).`,
    'high',
  );
  const clean: IdeaAnalysis = {
    ...data,
    feasibility: { ...data.feasibility, score: Math.round(clamp(data.feasibility.score, 0, 10) * 10) / 10 },
    potential: { ...data.potential, score: Math.round(clamp(data.potential.score, 0, 10) * 10) / 10 },
  };
  return saveIdeaAnalysis(deps.db, ideaId, clean);
}

// ─── Project Lab ─────────────────────────────────────────────────────────────

export async function analyzeProject(deps: AIDeps, projectId: string): Promise<ProjectAnalysis> {
  const p = getProject(deps.db, projectId);
  const snapshot = {
    titre: p.title,
    statut: p.status,
    priorite: p.priority,
    description: p.description,
    objectif: p.objective,
    debut: p.start_date,
    echeance: p.due_date,
    progression_pct: Math.round(p.progress * 100),
    budget: { prevu: p.budget_planned, depense: p.budget_spent, devise: p.currency },
    etapes: p.milestones.map((m) => ({ titre: m.title, faite: !!m.done, echeance: m.due_date })),
    risques: p.risks.map((r) => ({ titre: r.title, gravite: r.severity, statut: r.status, attenuation: r.mitigation })),
    taches: p.tasks.map((t) => ({ titre: t.title, statut: t.status, priorite: t.priority, echeance: t.due_date })),
    notes: p.notes.slice(0, 6000),
    objectif_lie: p.goal_title,
  };
  const { data, model } = await structured(
    deps,
    projectAnalysis,
    "Tu es l'auditeur de projets de NEXUS. Ton travail est d'identifier sans complaisance les faiblesses d'un projet : objectif flou ou non mesurable, étapes manquantes, échéances irréalistes, budget sous-estimé, risques ignorés, dépendances, absence de prochaine action claire. Tu t'appuies uniquement sur les données fournies et tu signales ce qui manque. Réponds en français.",
    `Date du jour : ${todayISO()}

Contexte de l'utilisateur :
${memoryDigest(deps)}

Projet à auditer (JSON) :
${JSON.stringify(snapshot, null, 2)}

Produis : un score de santé 0-100, un diagnostic franc, les forces, les faiblesses (avec gravité), les risques non identifiés (avec atténuation), 3 à 6 prochaines actions concrètes priorisées, et les questions que le porteur doit trancher.`,
    'high',
  );
  const clean: ProjectAnalysis = {
    ...data,
    health_score: Math.round(clamp(data.health_score, 0, 100)),
    next_actions: data.next_actions.map((a) => ({ ...a, priority: clamp(Math.round(a.priority), 1, 3) })),
  };
  saveProjectAnalysis(deps.db, projectId, model, clean);
  return clean;
}

// ─── Briefing quotidien ──────────────────────────────────────────────────────

export interface StoredBriefing { date: string; content: Briefing; model: string; created_at: string }

export function getCachedBriefing(deps: AIDeps): StoredBriefing | null {
  const row = get<{ date: string; content: string; model: string; created_at: string }>(deps.db, 'SELECT * FROM briefings WHERE date = :d', { d: todayISO() });
  return row ? { ...row, content: parseJSON<Briefing>(row.content, null as never) } : null;
}

export async function generateBriefing(deps: AIDeps, force = false): Promise<StoredBriefing> {
  if (!force) {
    const cached = getCachedBriefing(deps);
    if (cached) return cached;
  }
  const hour = new Date().getHours();
  const { data, model } = await structured(
    deps,
    briefingSchema,
    "Tu es NEXUS. Tu rédiges le briefing de l'utilisateur : court, factuel, actionnable, sans flatterie. Tu pointes ce qui compte vraiment aujourd'hui et ce qui dérape. Réponds en français.",
    `Moment de la journée : ${hour < 12 ? 'matin' : hour < 18 ? 'après-midi' : 'soir'}.

Ce que NEXUS sait de l'utilisateur :
${memoryDigest(deps)}

Situation :
${overviewForAI(deps.db)}

Rédige le briefing : une phrase d'accroche, 2 à 4 priorités (avec pourquoi), les alertes factuelles, et une observation non évidente tirée des données. S'il y a peu de données, dis-le et propose comment démarrer.`,
    'medium',
  );
  const now = nowISO();
  run(deps.db, 'INSERT INTO briefings (date, content, model, created_at) VALUES (:d, :c, :m, :now) ON CONFLICT(date) DO UPDATE SET content = excluded.content, model = excluded.model, created_at = excluded.created_at', {
    d: todayISO(),
    c: JSON.stringify(data),
    m: model,
    now,
  });
  return { date: todayISO(), content: data, model, created_at: now };
}
