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
export interface AIStatus {
  /** « ollama » = IA locale gratuite ; « anthropic » = Claude. */
  provider: 'ollama' | 'anthropic';
  /** L'IA est-elle utilisable maintenant ? */
  online: boolean;
  /** Raison si elle ne l'est pas. */
  reason: string | null;
  model: string;
  ollama: { reachable: boolean; version: string | null; models: { name: string; size: number; parameter_size: string | null }[]; modelInstalled: boolean; recommended: string } | null;
  key: { configured: boolean; source: 'env' | 'file' | null; masked: string | null };
  effort: string;
  allowWrites: boolean;
  mode?: 'local' | 'remote';
}
export interface AuthStatus { mode: 'local' | 'remote'; authenticated: boolean; device: { id: string; name: string; created_at: string; last_seen_at: string } | null }
export interface RemoteInfo {
  mode: 'off' | 'lan' | 'tailscale';
  status: { mode: string; running: boolean; port: number; error: string | null; lanUrls: string[]; tailscale: { installed: boolean; dnsName: string | null; url: string | null } } | null;
  baseUrl: string | null;
  devices: { id: string; name: string; user_agent: string; created_at: string; last_seen_at: string }[];
  pairing: { code: string; expiresAt: string } | null;
}
export interface StepCatalogItem { type: string; label: string; description: string; category: string; sideEffect: boolean; fields: import('../../server/automations/steps').StepField[] }
