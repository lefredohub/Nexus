/**
 * Vue d'ensemble : ce qu'affiche le Command Center et ce que l'IA reçoit
 * comme « photo » de la situation.
 */
import { type DB, all, get, todayISO, addDays } from '../db/client';
import { listProjects } from './projects';
import { listGoals } from './goals';
import { focusTasks } from './tasks';
import { listActivity } from './activity';
import { financeSummary, sportSummary, listHabits, weekStart } from './analytics';

export function getOverview(db: DB) {
  const today = todayISO();
  const wk = weekStart(today);
  const projects = listProjects(db);
  const goals = listGoals(db);
  const counts = get<{ open: number; overdue: number; due_today: number; done_week: number; doing: number }>(
    db,
    `SELECT
       sum(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open,
       sum(CASE WHEN status != 'done' AND due_date < :today THEN 1 ELSE 0 END) AS overdue,
       sum(CASE WHEN status != 'done' AND due_date = :today THEN 1 ELSE 0 END) AS due_today,
       sum(CASE WHEN status = 'done' AND completed_at >= :wk THEN 1 ELSE 0 END) AS done_week,
       sum(CASE WHEN status = 'doing' THEN 1 ELSE 0 END) AS doing
     FROM tasks`,
    { today, wk: `${wk}T00:00:00` },
  )!;
  // Tâches terminées par jour sur 14 jours (rythme d'exécution).
  const doneDaily = all<{ day: string; n: number }>(
    db,
    "SELECT substr(completed_at, 1, 10) AS day, count(*) AS n FROM tasks WHERE status = 'done' AND completed_at >= :from GROUP BY day",
    { from: addDays(today, -13) },
  );
  const velocity = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, -13 + i);
    return { day, n: doneDaily.find((d) => d.day === day)?.n ?? 0 };
  });
  const habits = listHabits(db, 30);
  const finance = financeSummary(db, 6);
  const sport = sportSummary(db, 8);
  const inbox = get<{ n: number }>(db, "SELECT count(*) AS n FROM ideas WHERE status = 'inbox'")!.n;

  return {
    date: today,
    tasks: { ...counts, open: counts.open ?? 0, overdue: counts.overdue ?? 0, due_today: counts.due_today ?? 0, done_week: counts.done_week ?? 0, doing: counts.doing ?? 0 },
    focus: focusTasks(db, 7),
    velocity,
    projects: projects.filter((p) => p.status === 'active' || p.status === 'planning'),
    goals: goals.filter((g) => g.status === 'active'),
    habits: {
      total: habits.length,
      done_today: habits.filter((h) => h.done_today).length,
      best_streak: habits.reduce((m, h) => Math.max(m, h.streak), 0),
      items: habits.map((h) => ({ id: h.id, name: h.name, color: h.color, done_today: h.done_today, streak: h.streak })),
    },
    finance: { month: finance.current, previous: finance.previous, savingsRate: finance.savingsRate, series: finance.series },
    sport: { week: sport.current, weekStreak: sport.weekStreak, series: sport.series },
    ideas_inbox: inbox,
    activity: listActivity(db, 18),
  };
}

/** Version compacte en texte pour le contexte de l'IA (économe en tokens). */
export function overviewForAI(db: DB): string {
  const o = getOverview(db);
  const lines: string[] = [];
  lines.push(`Date : ${o.date}`);
  lines.push(`Tâches : ${o.tasks.open} ouvertes (${o.tasks.doing} en cours, ${o.tasks.overdue} en retard, ${o.tasks.due_today} pour aujourd'hui), ${o.tasks.done_week} terminées cette semaine.`);
  if (o.focus.length) {
    lines.push('Tâches prioritaires :');
    for (const t of o.focus) lines.push(`- [${t.id}] ${t.title} (P${t.priority}${t.due_date ? `, échéance ${t.due_date}` : ''}${t.status === 'doing' ? ', en cours' : ''}${t.project_title ? `, projet « ${t.project_title} »` : ''})`);
  }
  if (o.projects.length) {
    lines.push('Projets actifs / en préparation :');
    for (const p of o.projects)
      lines.push(`- [${p.id}] ${p.title} — ${p.status}, ${Math.round(p.progress * 100)} %, santé ${p.health}${p.due_date ? `, échéance ${p.due_date}` : ''}${p.budget_planned ? `, budget ${p.budget_spent}/${p.budget_planned} ${p.currency}` : ''}`);
  }
  if (o.goals.length) {
    lines.push('Objectifs actifs :');
    for (const g of o.goals) lines.push(`- [${g.id}] ${g.title} — ${Math.round(g.progress * 100)} %${g.target_value !== null ? ` (${g.current_value}/${g.target_value}${g.metric_unit ? ' ' + g.metric_unit : ''})` : ''}${g.due_date ? `, échéance ${g.due_date}` : ''}`);
  }
  if (o.habits.total) lines.push(`Habitudes : ${o.habits.done_today}/${o.habits.total} tenues aujourd'hui. ${o.habits.items.map((h) => `${h.name} (série ${h.streak} j)`).join(', ')}.`);
  if (o.finance.month && (o.finance.month.income || o.finance.month.expense))
    lines.push(`Finances du mois : revenus ${o.finance.month.income.toFixed(0)}, dépenses ${o.finance.month.expense.toFixed(0)}, solde ${o.finance.month.net.toFixed(0)}.`);
  if (o.sport.week) lines.push(`Sport cette semaine : ${o.sport.week.sessions} séances, ${Math.round(o.sport.week.minutes)} min. Série : ${o.sport.weekStreak} semaine(s) active(s).`);
  if (o.ideas_inbox) lines.push(`Idées non traitées dans l'inbox : ${o.ideas_inbox}.`);
  return lines.join('\n');
}
