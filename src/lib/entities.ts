import { Target, FolderKanban, CheckSquare, Lightbulb, StickyNote, Brain, type LucideIcon } from 'lucide-react';
import type { EntityKind } from './types';

export const ENTITY: Record<EntityKind, { label: string; plural: string; icon: LucideIcon; color: string; href: (id: string) => string }> = {
  goal: { label: 'Objectif', plural: 'Objectifs', icon: Target, color: '#b8851c', href: () => '/analytics?tab=goals' },
  project: { label: 'Projet', plural: 'Projets', icon: FolderKanban, color: '#e0561c', href: (id) => `/projects/${id}` },
  task: { label: 'Tâche', plural: 'Tâches', icon: CheckSquare, color: '#8a8984', href: () => '/tasks' },
  idea: { label: 'Idée', plural: 'Idées', icon: Lightbulb, color: '#c24e85', href: (id) => `/ideas?id=${id}` },
  note: { label: 'Note', plural: 'Notes', icon: StickyNote, color: '#5585d8', href: (id) => `/graph?focus=note:${id}` },
  memory: { label: 'Souvenir', plural: 'Mémoire', icon: Brain, color: '#2a9d6d', href: () => '/ai?panel=memory' },
};
