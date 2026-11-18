/**
 * Données de démonstration — chargées UNIQUEMENT à ta demande, dans un espace vide,
 * pour explorer NEXUS avant d'y mettre tes vraies données.
 */
import { type DB, get, run, tx, todayISO, addDays, nowISO } from './client';
import { createGoal } from '../repos/goals';
import { createProject, addExpense, updateMilestone } from '../repos/projects';
import { createTask } from '../repos/tasks';
import { createIdea } from '../repos/ideas';
import { createNote, createMemory } from '../repos/notes';
import { createLink } from '../repos/links';
import { createHabit, createMetric, createTransaction, createWorkout } from '../repos/analytics';

const TABLES = ['projects', 'tasks', 'goals', 'ideas', 'notes', 'memories', 'transactions', 'workouts', 'habits', 'metrics', 'automations'];

export function isEmpty(db: DB): boolean {
  return TABLES.every((t) => get<{ n: number }>(db, `SELECT count(*) AS n FROM ${t}`)!.n === 0);
}

/** Générateur pseudo-aléatoire déterministe (mêmes données à chaque chargement). */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function loadDemoData(db: DB) {
  const rand = rng(42);
  const today = todayISO();
  const d = (offset: number) => addDays(today, offset);

  tx(db, () => {
    // ── Objectifs ──
    const gRun = createGoal(db, { title: 'Courir un semi-marathon sous 2 h', area: 'health', metric_unit: 'km (sortie longue)', start_value: 8, target_value: 21, current_value: 15, due_date: d(120), description: 'Préparation progressive, 3 séances par semaine.' }, 'system');
    const gSave = createGoal(db, { title: 'Constituer 5 000 € d’épargne de sécurité', area: 'finance', metric_unit: '€', start_value: 0, target_value: 5000, current_value: 2150, due_date: d(240) }, 'system');
    const gWrite = createGoal(db, { title: 'Publier 24 articles cette année', area: 'career', metric_unit: 'articles', start_value: 0, target_value: 24, current_value: 9, due_date: d(200) }, 'system');
    const gLearn = createGoal(db, { title: 'Devenir autonome en développement web', area: 'learning', description: 'Construire et maintenir mes propres outils.' }, 'system');

    // ── Projets ──
    const pNews = createProject(db, {
      title: 'Newsletter « Signal Faible »', status: 'active', priority: 1, color: '#ff6b2c', goal_id: gWrite.id,
      description: 'Une newsletter bimensuelle qui décrypte les signaux faibles de la tech et de l’IA.',
      objective: '500 abonnés et 40 % de taux d’ouverture d’ici 6 mois.', budget_planned: 600, start_date: d(-45), due_date: d(130),
      notes: 'Ton : analytique, concret, sans jargon.\nFormat : 1 sujet principal + 3 liens commentés.',
    }, 'system', {
      milestones: ['Définir la ligne éditoriale', 'Choisir la plateforme d’envoi', 'Publier les 3 premiers numéros', 'Atteindre 100 abonnés', 'Lancer la page de parrainage'],
      risks: [{ title: 'Manque de régularité', severity: 'high', mitigation: 'Bloquer 2 créneaux d’écriture fixes par semaine' }, { title: 'Croissance trop lente', severity: 'medium', mitigation: 'Partenariats croisés avec d’autres newsletters' }],
    });
    pNews.milestones.slice(0, 3).forEach((m) => updateMilestone(db, m.id, { done: true }, 'system'));
    addExpense(db, pNews.id, { label: 'Abonnement plateforme (3 mois)', amount: 87, date: d(-40) });
    addExpense(db, pNews.id, { label: 'Nom de domaine', amount: 14, date: d(-44) });
    addExpense(db, pNews.id, { label: 'Illustrations', amount: 120, date: d(-12) });

    const pDesk = createProject(db, {
      title: 'Réaménagement du bureau', status: 'active', priority: 2, color: '#8fb8ff',
      description: 'Transformer la chambre d’amis en espace de travail calme et ergonomique.',
      objective: 'Un poste de travail utilisable 8 h/jour sans douleur au dos.', budget_planned: 1200, start_date: d(-20), due_date: d(-2),
    }, 'system', {
      milestones: ['Mesurer et planifier', 'Commander bureau assis-debout', 'Installer l’éclairage', 'Traitement acoustique'],
      risks: [{ title: 'Dépassement de budget', severity: 'medium', mitigation: 'Comparer 3 offres avant chaque achat' }],
    });
    updateMilestone(db, pDesk.milestones[0].id, { done: true }, 'system');
    updateMilestone(db, pDesk.milestones[1].id, { done: true }, 'system');
    addExpense(db, pDesk.id, { label: 'Bureau assis-debout', amount: 649, date: d(-10) });
    addExpense(db, pDesk.id, { label: 'Chaise ergonomique', amount: 489, date: d(-8) });

    const pRun = createProject(db, {
      title: 'Prépa semi-marathon', status: 'active', priority: 2, color: '#7ee0b5', goal_id: gRun.id,
      description: 'Plan d’entraînement de 16 semaines.', objective: 'Finir en moins de 2 h sans blessure.', start_date: d(-56), due_date: d(120),
    }, 'system', { milestones: ['Bloc foncier (6 sem.)', 'Bloc spécifique (6 sem.)', 'Affûtage (4 sem.)', 'Jour J'] });
    updateMilestone(db, pRun.milestones[0].id, { done: true }, 'system');

    const pApp = createProject(db, {
      title: 'Construire NEXUS', status: 'planning', priority: 2, color: '#f2c14e', goal_id: gLearn.id,
      description: 'Mon système d’exploitation personnel augmenté par l’IA.', objective: 'L’utiliser chaque jour pendant 30 jours.',
    }, 'system', { milestones: ['Noyau de données', 'Assistant IA', 'Memory Graph', 'Automatisations'] });

    // ── Tâches ──
    const T = (title: string, extra: Record<string, unknown> = {}) => createTask(db, { title, ...extra }, 'system');
    T('Écrire le numéro #4 : agents IA personnels', { project_id: pNews.id, priority: 1, due_date: d(1), status: 'doing' });
    T('Préparer 3 sujets d’avance', { project_id: pNews.id, priority: 2, due_date: d(6) });
    T('Contacter 5 newsletters pour un échange de visibilité', { project_id: pNews.id, priority: 2, due_date: d(-3) });
    T('Installer la lampe d’architecte', { project_id: pDesk.id, priority: 2, due_date: d(-1) });
    T('Comparer les panneaux acoustiques', { project_id: pDesk.id, priority: 3 });
    T('Sortie longue 16 km', { project_id: pRun.id, priority: 1, due_date: d(2) });
    T('Acheter des chaussures de course', { project_id: pRun.id, priority: 2, due_date: d(5) });
    T('Lister les modules prioritaires de NEXUS', { project_id: pApp.id, priority: 2 });
    T('Faire le point sur l’assurance habitation', { priority: 3, due_date: d(10) });
    T('Virement épargne du mois', { priority: 1, due_date: d(0), goal_id: gSave.id });
    T('Rédiger le numéro #3', { project_id: pNews.id, status: 'done' });
    T('Choisir la plateforme d’envoi', { project_id: pNews.id, status: 'done' });
    T('Monter le bureau', { project_id: pDesk.id, status: 'done' });
    // Rythme d'exécution : tâches terminées sur les 2 dernières semaines.
    const pool = ['Répondre aux mails en attente', 'Relire le brouillon', 'Mettre à jour le budget', 'Appeler le plombier', 'Trier les factures', 'Planifier la semaine', 'Sauvegarder les photos', 'Préparer le rendez-vous', 'Corriger la mise en page', 'Ranger le bureau'];
    for (let i = 0; i < 14; i++) {
      const n = Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const t = T(pool[Math.floor(rand() * pool.length)], { status: 'done' });
        const at = new Date();
        at.setDate(at.getDate() - i);
        run(db, 'UPDATE tasks SET completed_at = :at, created_at = :at WHERE id = :id', { id: t.id, at: at.toISOString() });
      }
    }

    // ── Idées ──
    const iVoice = createIdea(db, { content: 'Un outil qui transforme mes notes vocales du matin en plan de journée, en se basant sur mes priorités et mon agenda.' }, 'system');
    const iWorkshop = createIdea(db, { content: 'Proposer un atelier payant « Construire son assistant IA personnel » pour les indépendants. Format 2×3 h en visio.' }, 'system');
    createIdea(db, { content: 'Échanger avec des voisins un abonnement partagé d’outils de bricolage — une bibliothèque d’objets d’immeuble.' }, 'system');

    // ── Notes & mémoire ──
    const nFocus = createNote(db, { title: 'Principe : un seul projet prioritaire à la fois', content: 'Quand j’ouvre trop de fronts, je n’en termine aucun. Règle : 1 projet P1, 2 maximum en P2.', tags: ['méthode', 'focus'] }, 'system');
    const nIdeas = createNote(db, { title: 'Sujets potentiels pour la newsletter', content: '- Les agents IA dans la vie quotidienne\n- Le retour des outils locaux\n- Pourquoi les petits modèles comptent', tags: ['newsletter'] }, 'system');
    createLink(db, { source: { kind: 'note', id: nFocus.id }, target: { kind: 'project', id: pApp.id }, label: 'guide' });
    createLink(db, { source: { kind: 'note', id: nIdeas.id }, target: { kind: 'project', id: pNews.id }, label: 'alimente' });
    createLink(db, { source: { kind: 'project', id: pDesk.id }, target: { kind: 'goal', id: gWrite.id }, label: 'facilite' });
    const mMorning = createMemory(db, { content: 'Préfère travailler en profondeur le matin (8 h – 12 h) ; les après-midis sont pour les tâches légères.', kind: 'preference', importance: 4 }, 'system');
    const mScatter = createMemory(db, { content: 'A tendance à lancer trop de projets en parallèle — à lui rappeler quand il en ouvre un nouveau.', kind: 'insight', importance: 5 }, 'system');
    const mDev = createMemory(db, { content: 'Débutant en programmation, apprend en construisant ses propres outils.', kind: 'context', importance: 3 }, 'system');
    const L = (sk: 'idea' | 'memory' | 'note' | 'project' | 'goal', si: string, tk: 'idea' | 'memory' | 'note' | 'project' | 'goal', ti: string, label: string) =>
      createLink(db, { source: { kind: sk, id: si }, target: { kind: tk, id: ti }, label });
    L('idea', iVoice.id, 'project', pApp.id, 'module possible');
    L('idea', iWorkshop.id, 'project', pNews.id, 'audience commune');
    L('idea', iWorkshop.id, 'goal', gLearn.id, 'valorise');
    L('memory', mScatter.id, 'note', nFocus.id, 'confirme');
    L('memory', mMorning.id, 'project', pNews.id, 'créneau d’écriture');
    L('memory', mDev.id, 'goal', gLearn.id, 'contexte');
    L('note', nIdeas.id, 'idea', iWorkshop.id, 'sujet');

    // ── Finances (6 mois) ──
    const cats: [string, number, number][] = [['Logement', -850, 0], ['Courses', -320, 80], ['Transports', -90, 40], ['Loisirs', -140, 90], ['Restaurants', -110, 70], ['Abonnements', -45, 5], ['Santé', -40, 40]];
    for (let m = 5; m >= 0; m--) {
      const base = new Date();
      base.setDate(1);
      base.setMonth(base.getMonth() - m);
      const iso = (day: number) => {
        const x = new Date(base.getFullYear(), base.getMonth(), Math.min(day, 28));
        return todayISO(x) > today ? today : todayISO(x);
      };
      createTransaction(db, { date: iso(1), amount: 3200, category: 'Salaire', label: 'Salaire' }, 'system');
      if (m % 2 === 0) createTransaction(db, { date: iso(15), amount: Math.round(300 + rand() * 500), category: 'Freelance', label: 'Mission freelance' }, 'system');
      for (const [cat, amount, jitter] of cats) {
        const parts = cat === 'Courses' ? 4 : cat === 'Restaurants' ? 3 : 1;
        for (let p = 0; p < parts; p++) {
          createTransaction(db, { date: iso(2 + Math.floor(rand() * 26)), amount: Math.round((amount + (rand() - 0.5) * jitter) / parts), category: cat, label: cat }, 'system');
        }
      }
    }

    // ── Sport (12 semaines) ──
    for (let i = 84; i >= 0; i--) {
      if (rand() < 0.42) {
        const type = rand() < 0.65 ? 'run' : rand() < 0.5 ? 'strength' : 'bike';
        const dur = type === 'run' ? 30 + Math.round(rand() * 50) : 40 + Math.round(rand() * 30);
        createWorkout(db, { date: d(-i), type, duration_min: dur, distance_km: type === 'run' ? Math.round(dur / 6.2 * 10) / 10 : type === 'bike' ? Math.round(dur / 2.5) : null, intensity: 2 + Math.floor(rand() * 3) }, 'system');
      }
    }

    // ── Habitudes ──
    const habits = [
      createHabit(db, { name: 'Méditation 10 min', target_per_week: 7, color: '#8fb8ff' }, 'system'),
      createHabit(db, { name: 'Lecture 20 pages', target_per_week: 5, color: '#f2c14e' }, 'system'),
      createHabit(db, { name: 'Pas d’écran après 22 h', target_per_week: 6, color: '#7ee0b5' }, 'system'),
    ];
    habits.forEach((h, idx) => {
      for (let i = 1; i <= 90; i++) {
        const p = [0.8, 0.6, 0.5][idx] + (i < 12 ? 0.15 : 0);
        if (rand() < p) run(db, 'INSERT OR IGNORE INTO habit_checks (habit_id, date) VALUES (:h, :d)', { h: h.id, d: d(-i) });
      }
    });

    // ── Métriques ──
    const sleep = createMetric(db, { name: 'Sommeil', unit: 'h', category: 'health', target: 7.5, direction: 'up', color: '#8fb8ff' });
    const focus = createMetric(db, { name: 'Travail profond', unit: 'h', category: 'productivity', target: 4, direction: 'up', color: '#ff6b2c' });
    for (let i = 60; i >= 0; i--) {
      run(db, "INSERT INTO metric_entries (id, metric_id, date, value, note, source, created_at) VALUES (:id, :m, :d, :v, '', 'manual', :now)", { id: `mte_demo_s${i}`, m: sleep.id, d: d(-i), v: Math.round((6.4 + rand() * 1.8) * 10) / 10, now: nowISO() });
      if (rand() < 0.75) run(db, "INSERT INTO metric_entries (id, metric_id, date, value, note, source, created_at) VALUES (:id, :m, :d, :v, '', 'manual', :now)", { id: `mte_demo_f${i}`, m: focus.id, d: d(-i), v: Math.round((1.5 + rand() * 3.5) * 2) / 2, now: nowISO() });
    }

    // ── Automatisation d'exemple ──
    const now = nowISO();
    run(db, 'INSERT INTO automations (id, name, description, enabled, trigger, steps, next_run_at, created_at, updated_at) VALUES (:id, :name, :desc, 1, :trigger, :steps, NULL, :now, :now)', {
      id: 'aut_demo_review',
      name: 'Revue hebdomadaire',
      desc: 'Chaque dimanche soir : crée la tâche de revue et laisse une note dans le flux.',
      trigger: JSON.stringify({ type: 'manual' }),
      steps: JSON.stringify([
        { id: 'tache', type: 'create_task', name: 'Tâche de revue', config: { title: 'Revue hebdomadaire — {{today}}', priority: '1', due_in_days: '0' } },
        { id: 'notif', type: 'notify', name: 'Annonce', config: { title: 'Revue hebdo prête', message: 'La tâche « {{steps.tache.output.title}} » t’attend.' } },
      ]),
      now,
    });
    run(db, 'INSERT INTO automations (id, name, description, enabled, trigger, steps, next_run_at, created_at, updated_at) VALUES (:id, :name, :desc, 1, :trigger, :steps, NULL, :now, :now)', {
      id: 'aut_demo_idea',
      name: 'Idée → première étape',
      desc: 'À chaque nouvelle idée, Claude propose une première action concrète, enregistrée en note.',
      trigger: JSON.stringify({ type: 'event', event: 'idea.created' }),
      steps: JSON.stringify([
        { id: 'ia', type: 'ai_prompt', name: 'Première étape', config: { prompt: 'Propose UNE première action concrète (moins de 2 h) pour tester cette idée, en une phrase : {{trigger.idea.content}}', effort: 'low' } },
        { id: 'note', type: 'create_note', name: 'Archiver', config: { title: 'Première étape — {{today}}', content: '{{steps.ia.output}}' } },
      ]),
      now,
    });

    // Flux d'activité : on remplace le bruit du chargement par un historique lisible.
    run(db, 'DELETE FROM activity');
    const feed: [number, string, string, string, string][] = [
      [-26, 'project.created', 'Projet lancé : Newsletter « Signal Faible »', '', 'user'],
      [-20, 'milestone.done', 'Étape franchie : Publier les 3 premiers numéros', 'Newsletter « Signal Faible »', 'user'],
      [-9, 'goal.progress', 'Progression : Constituer 5 000 € d’épargne de sécurité', '1 800 → 2 150 €', 'user'],
      [-5, 'workout.logged', 'Séance : run · 62 min', '10 km', 'user'],
      [-3, 'memory.created', 'NEXUS a mémorisé une information', 'Préfère travailler en profondeur le matin', 'ai'],
      [-2, 'task.completed', 'Tâche terminée : Monter le bureau', '', 'user'],
      [-1, 'idea.created', 'Idée capturée : un atelier « assistant IA personnel »', '', 'user'],
    ];
    for (const [hoursAgoDays, kind, title, detail, actor] of feed) {
      const at = new Date(Date.now() + hoursAgoDays * 86_400_000 * 0.35).toISOString();
      run(db, 'INSERT INTO activity (id, kind, title, detail, actor, created_at) VALUES (:id, :kind, :title, :detail, :actor, :at)', { id: `act_demo_${kind}_${hoursAgoDays}`, kind, title, detail, actor, at });
    }
  });
  // L'automatisation événementielle d'exemple reste désactivée (elle appelle Claude) : à toi de l'activer.
  run(db, "UPDATE automations SET enabled = 0 WHERE id = 'aut_demo_idea'");
}
