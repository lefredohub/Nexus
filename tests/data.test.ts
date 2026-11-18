import { describe, expect, it } from 'vitest';
import { testDb } from './helpers';
import { all, todayISO, addDays } from '../server/db/client';
import { SCHEMA_VERSION } from '../server/db/migrations';
import { createTask, updateTask, listTasks, focusTasks } from '../server/repos/tasks';
import { createProject, getProject, addMilestone, updateMilestone, addExpense, listProjects, computeHealth, deleteProject } from '../server/repos/projects';
import { createGoal, updateGoal, goalProgress } from '../server/repos/goals';
import { createIdea, convertIdeaToProject, saveIdeaAnalysis, getIdea } from '../server/repos/ideas';
import { createNote, createMemory } from '../server/repos/notes';
import { createLink, linksFor } from '../server/repos/links';
import { buildGraph } from '../server/repos/graph';
import { search, toFtsQuery } from '../server/repos/search';
import { computeStreak, parseAmount, parseDate, parseCSV, importTransactionsCSV, createHabit, setHabitCheck, listHabits, financeSummary, createTransaction } from '../server/repos/analytics';
import { loadDemoData, isEmpty } from '../server/db/seed';
import type { IdeaAnalysis } from '../shared/schemas';

describe('base de données', () => {
  it('applique toutes les migrations', () => {
    const db = testDb();
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
  });

  it('les données de démo se chargent dans une base vide uniquement', () => {
    const db = testDb();
    expect(isEmpty(db)).toBe(true);
    loadDemoData(db);
    expect(isEmpty(db)).toBe(false);
    expect(listProjects(db).length).toBeGreaterThan(2);
  });
});

describe('tâches', () => {
  it('valide les entrées', () => {
    const db = testDb();
    expect(() => createTask(db, { title: '' })).toThrow();
    expect(() => createTask(db, { title: 'ok', due_date: '18/11/2026' })).toThrow();
  });

  it('gère la complétion et la date de fin', () => {
    const db = testDb();
    const t = createTask(db, { title: 'Écrire' });
    expect(t.completed_at).toBeNull();
    const done = updateTask(db, t.id, { status: 'done' });
    expect(done.completed_at).not.toBeNull();
    expect(updateTask(db, t.id, { status: 'todo' }).completed_at).toBeNull();
  });

  it('priorise le focus : en cours, puis retard, puis priorité', () => {
    const db = testDb();
    createTask(db, { title: 'basse', priority: 3 });
    createTask(db, { title: 'retard', priority: 2, due_date: addDays(todayISO(), -2) });
    createTask(db, { title: 'en cours', status: 'doing', priority: 3 });
    createTask(db, { title: 'haute', priority: 1 });
    expect(focusTasks(db).map((t) => t.title)).toEqual(['en cours', 'retard', 'haute', 'basse']);
    expect(listTasks(db, { status: 'open' })).toHaveLength(4);
  });
});

describe('projets', () => {
  it('calcule la progression à partir des étapes, sinon des tâches', () => {
    const db = testDb();
    const p = createProject(db, { title: 'P' }, 'user', { milestones: ['a', 'b', 'c', 'd'] });
    expect(getProject(db, p.id).progress).toBe(0);
    updateMilestone(db, p.milestones[0].id, { done: true });
    expect(getProject(db, p.id).progress).toBe(0.25);

    const q = createProject(db, { title: 'Q' });
    createTask(db, { title: 't1', project_id: q.id, status: 'done' });
    createTask(db, { title: 't2', project_id: q.id });
    expect(getProject(db, q.id).progress).toBe(0.5);
  });

  it('signale un dépassement de budget et des retards dans la santé', () => {
    const db = testDb();
    const p = createProject(db, { title: 'Budget', status: 'active', budget_planned: 100 });
    expect(getProject(db, p.id).health).toBe('good');
    addExpense(db, p.id, { label: 'x', amount: 150, date: todayISO() });
    expect(getProject(db, p.id).budget_spent).toBe(150);
    expect(getProject(db, p.id).health).not.toBe('good');
    expect(
      computeHealth({ ...getProject(db, p.id), tasks_overdue: 3, due_date: addDays(todayISO(), -1), progress: 0.2 }),
    ).toBe('critical');
  });

  it('supprimer un projet conserve ses tâches (sans projet)', () => {
    const db = testDb();
    const p = createProject(db, { title: 'X' });
    const t = createTask(db, { title: 't', project_id: p.id });
    addMilestone(db, p.id, { title: 'm' });
    deleteProject(db, p.id);
    expect(listTasks(db).find((x) => x.id === t.id)?.project_id).toBeNull();
    expect(all(db, 'SELECT * FROM milestones')).toHaveLength(0);
  });
});

describe('objectifs', () => {
  it('calcule la progression entre départ et cible', () => {
    expect(goalProgress({ status: 'active', start_value: 10, target_value: 20, current_value: 15 })).toBe(0.5);
    expect(goalProgress({ status: 'active', start_value: 0, target_value: null, current_value: 5 })).toBe(0);
    expect(goalProgress({ status: 'achieved', start_value: 0, target_value: 10, current_value: 0 })).toBe(1);
    expect(goalProgress({ status: 'active', start_value: 100, target_value: 80, current_value: 90 })).toBe(0.5); // objectif à la baisse
    const db = testDb();
    const g = createGoal(db, { title: 'G', target_value: 10 });
    expect(updateGoal(db, g.id, { current_value: 12 }).progress).toBe(1);
  });
});

describe('idées', () => {
  const analysis: IdeaAnalysis = {
    title: 'Atelier IA',
    summary: 'Résumé',
    category: 'business',
    tags: ['ia'],
    feasibility: { score: 7, rationale: 'ok' },
    potential: { score: 6, rationale: 'ok' },
    effort: 'medium',
    risks: ['Pas de demande'],
    open_questions: ['Prix ?'],
    plan: [{ title: 'Sonder 10 personnes', description: '' }, { title: 'Créer le programme', description: '' }],
    first_action: 'Écrire le message de sondage',
    verdict: 'explore',
    verdict_reason: 'À valider',
  };

  it('convertit une idée analysée en projet structuré et lié', () => {
    const db = testDb();
    const i = createIdea(db, { content: 'Faire des ateliers IA' });
    saveIdeaAnalysis(db, i.id, analysis);
    expect(getIdea(db, i.id).status).toBe('analyzed');
    const p = convertIdeaToProject(db, i.id);
    expect(p.title).toBe('Atelier IA');
    expect(p.milestones.map((m) => m.title)).toEqual(['Sonder 10 personnes', 'Créer le programme']);
    expect(p.risks).toHaveLength(1);
    expect(p.tasks[0].title).toBe('Écrire le message de sondage');
    expect(getIdea(db, i.id).status).toBe('converted');
    expect(linksFor(db, 'idea', i.id)[0].id).toBe(p.id);
    expect(() => convertIdeaToProject(db, i.id)).toThrow(/déjà/);
  });
});

describe('mémoire, liens et recherche', () => {
  it('évite les liens en double (dans les deux sens) et les auto-liens', () => {
    const db = testDb();
    const n = createNote(db, { title: 'Note' });
    const m = createMemory(db, { content: 'Préfère le matin' });
    const a = createLink(db, { source: { kind: 'note', id: n.id }, target: { kind: 'memory', id: m.id } });
    const b = createLink(db, { source: { kind: 'memory', id: m.id }, target: { kind: 'note', id: n.id } });
    expect(b.id).toBe(a.id);
    expect(() => createLink(db, { source: { kind: 'note', id: n.id }, target: { kind: 'note', id: n.id } })).toThrow();
    expect(() => createLink(db, { source: { kind: 'note', id: n.id }, target: { kind: 'goal', id: 'gol_inexistant' } })).toThrow();
  });

  it('construit le graphe avec liens explicites et implicites', () => {
    const db = testDb();
    const g = createGoal(db, { title: 'Objectif' });
    const p = createProject(db, { title: 'Projet', goal_id: g.id });
    const n = createNote(db, { title: 'Note' });
    createLink(db, { source: { kind: 'note', id: n.id }, target: { kind: 'project', id: p.id }, label: 'inspire' });
    const graph = buildGraph(db);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.map((e) => e.implicit).sort()).toEqual([false, true]);
    expect(graph.nodes.find((x) => x.kind === 'project')!.weight).toBe(3);
  });

  it('recherche plein texte insensible aux accents, par préfixe, mise à jour en direct', () => {
    const db = testDb();
    const t = createTask(db, { title: 'Préparer la présentation' });
    createNote(db, { title: 'Réflexion', content: 'Le marathon de Paris' });
    expect(search(db, 'presentation').map((h) => h.ref_id)).toContain(t.id);
    expect(search(db, 'mara')[0].kind).toBe('note');
    updateTask(db, t.id, { title: 'Autre chose' });
    expect(search(db, 'presentation')).toHaveLength(0);
    expect(toFtsQuery('" OR * NEAR(')).toBe('"or"* AND "near"*'); // mots-clés FTS neutralisés (entre guillemets)
    expect(() => search(db, 'a" OR b*) NEAR')).not.toThrow();
  });
});

describe('analytics', () => {
  it('calcule les séries d’habitudes', () => {
    const today = '2026-11-18';
    expect(computeStreak(new Set(['2026-11-18', '2026-11-17', '2026-11-16', '2026-11-14']), today)).toBe(3);
    expect(computeStreak(new Set(['2026-11-17', '2026-11-16']), today)).toBe(2); // aujourd'hui pas encore coché
    expect(computeStreak(new Set(['2026-11-15']), today)).toBe(0);
    const db = testDb();
    const h = createHabit(db, { name: 'Lire' });
    setHabitCheck(db, h.id, todayISO(), true);
    setHabitCheck(db, h.id, todayISO(), true); // idempotent
    expect(listHabits(db)[0]).toMatchObject({ done_today: true, streak: 1 });
    setHabitCheck(db, h.id, todayISO(), false);
    expect(listHabits(db)[0].done_today).toBe(false);
  });

  it('interprète montants et dates de relevés bancaires', () => {
    expect(parseAmount('-1 234,56 €')).toBe(-1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('-12.5')).toBe(-12.5);
    expect(parseAmount('abc')).toBeNull();
    expect(parseDate('02/11/2026', 'DD/MM/YYYY')).toBe('2026-11-02');
    expect(parseDate('11/02/2026', 'MM/DD/YYYY')).toBe('2026-11-02');
    expect(parseDate('2026-11-02', 'YYYY-MM-DD')).toBe('2026-11-02');
    expect(parseDate('32/13/2026', 'DD/MM/YYYY')).toBeNull();
    expect(parseCSV('a;b\n"x;y";"il dit ""oui"""\n')).toEqual([['a', 'b'], ['x;y', 'il dit "oui"']]);
  });

  it('importe un CSV sans créer de doublons à la réimportation', () => {
    const db = testDb();
    const csv = 'Date;Libellé;Montant\n02/11/2026;Courses;-54,20\n02/11/2026;Courses;-54,20\n03/11/2026;Salaire;2500\nnimportequoi;;';
    const opts = { csv, columns: { date: 'Date', amount: 'Montant', label: 'Libellé' }, dateFormat: 'DD/MM/YYYY' as const, invertSign: false };
    expect(importTransactionsCSV(db, opts)).toMatchObject({ imported: 3, skipped: 1, duplicates: 0 });
    expect(importTransactionsCSV(db, opts)).toMatchObject({ imported: 0, duplicates: 3 });
  });

  it('résume les finances du mois', () => {
    const db = testDb();
    createTransaction(db, { date: todayISO(), amount: 1000, category: 'Salaire' });
    createTransaction(db, { date: todayISO(), amount: -250, category: 'Courses' });
    const f = financeSummary(db, 3);
    expect(f.current).toMatchObject({ income: 1000, expense: 250, net: 750 });
    expect(f.savingsRate).toBe(0.75);
    expect(f.categories[0]).toEqual({ category: 'Courses', total: 250 });
  });
});
