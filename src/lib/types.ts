/**
 * Types partagés avec le serveur (imports de type uniquement : aucun code serveur
 * n'est embarqué dans l'interface).
 */
export type { Task } from '../../server/repos/tasks';
export type { ProjectSummary, ProjectDetail, Milestone, Risk, Expense } from '../../server/repos/projects';
export type { Goal } from '../../server/repos/goals';
export type { Idea } from '../../server/repos/ideas';
export type { Note, Memory } from '../../server/repos/notes';
export type { GraphNode, GraphEdge } from '../../server/repos/graph';
export type { SearchHit } from '../../server/repos/search';
export type { Transaction, Workout, HabitWithStats, Metric, MetricEntry } from '../../server/repos/analytics';
export type { Automation, AutomationRun, StepLog } from '../../server/automations/engine';
export type { StepField } from '../../server/automations/steps';
export type { ChatEvent } from '../../server/ai/agent';
export type { ToolEffect } from '../../server/ai/tools';
export type { Settings } from '../../server/repos/settings';
export type { StoredBriefing } from '../../server/ai/structured';
export type { IdeaAnalysis, ProjectAnalysis, Briefing, EntityKind } from '../../shared/schemas';

import type { getOverview } from '../../server/repos/overview';
import type { analyticsDashboard, listMetrics } from '../../server/repos/analytics';
import type { conversationView } from '../../server/ai/agent';
import type { Conversation } from '../../server/repos/conversations';

export type Overview = ReturnType<typeof getOverview>;
export type AnalyticsData = ReturnType<typeof analyticsDashboard>;
export type MetricWithEntries = ReturnType<typeof listMetrics>[number];
export type ConversationView = ReturnType<typeof conversationView>;
export type ConversationSummary = Conversation;
export interface ActivityItem { id: string; kind: string; title: string; detail: string; actor: string; entity_kind: string | null; entity_id: string | null; created_at: string }
export interface AIStatus { key: { configured: boolean; source: 'env' | 'file' | null; masked: string | null }; model: string; effort: string; allowWrites: boolean }
export interface StepCatalogItem { type: string; label: string; description: string; category: string; sideEffect: boolean; fields: import('../../server/automations/steps').StepField[] }
