import { useEffect, useMemo, useState } from 'react';
import { Plus, ListChecks, X, Trash2 } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { addDays, todayISO } from '../lib/format';
import type { ProjectSummary, Task } from '../lib/types';
import { Button, Drawer, EmptyState, Field, IconButton, Input, PageHeader, Panel, Select, Skeleton, Tabs, Textarea } from '../components/ui';
import { TaskRow } from '../components/TaskRow';

type View = 'open' | 'doing' | 'done';

function groupTasks(tasks: Task[]) {
  const today = todayISO();
  const week = addDays(today, 7);
  const groups: { key: string; label: string; items: Task[] }[] = [
    { key: 'late', label: 'En retard', items: [] },
    { key: 'today', label: "Aujourd'hui", items: [] },
    { key: 'week', label: '7 prochains jours', items: [] },
    { key: 'later', label: 'Plus tard', items: [] },
    { key: 'none', label: 'Sans échéance', items: [] },
  ];
  for (const t of tasks) {
    const g = !t.due_date ? 'none' : t.due_date < today ? 'late' : t.due_date === today ? 'today' : t.due_date <= week ? 'week' : 'later';
    groups.find((x) => x.key === g)!.items.push(t);
  }
  return groups.filter((g) => g.items.length);
}

export function TasksPage() {
  const [view, setView] = useState<View>('open');
  const { data: tasks, isLoading } = useApi<Task[]>(['tasks', view], `/tasks?status=${view}`);
  const { data: projects = [] } = useApi<ProjectSummary[]>(['projects'], '/projects');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('2');
  const [due, setDue] = useState('');
  const [projectId, setProjectId] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const add = useAction(() => api('/tasks', { body: { title, priority: Number(priority), due_date: due || null, project_id: projectId || null } }));
  const del = useAction((id: string) => api(`/tasks/${id}`, { method: 'DELETE' }), { success: 'Tâche supprimée' });
  const groups = useMemo(() => (view === 'done' ? [{ key: 'done', label: 'Terminées', items: tasks ?? [] }] : groupTasks(tasks ?? [])), [tasks, view]);

  return (
    <div className="mx-auto max-w-[980px] px-4 py-6 md:px-8 md:py-9">
      <PageHeader eyebrow="Exécution" title="Tâches" subtitle="Tout ce qui doit avancer, classé par urgence réelle." />
      <Panel className="mb-6 p-3">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) add.mutate(undefined, { onSuccess: () => (setTitle(''), setDue('')) });
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvelle tâche…" className="!h-10 min-w-[220px] flex-1 !border-transparent !bg-transparent !text-[14.5px] focus:!shadow-none" />
          <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="!h-10 !w-[110px] !py-0 text-[12.5px]" aria-label="Priorité">
            <option value="1">P1 · haute</option>
            <option value="2">P2 · normale</option>
            <option value="3">P3 · basse</option>
          </Select>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="!h-10 !w-[150px]" aria-label="Échéance" />
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="!h-10 !w-[180px] !py-0 text-[12.5px]" aria-label="Projet">
            <option value="">Sans projet</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" className="!h-10" icon={<Plus size={15} />} disabled={!title.trim()} loading={add.isPending}>
            Ajouter
          </Button>
        </form>
      </Panel>

      <Tabs value={view} onChange={setView} className="mb-5" items={[{ value: 'open', label: 'Ouvertes' }, { value: 'doing', label: 'En cours' }, { value: 'done', label: 'Terminées' }]} />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : groups.length === 0 ? (
        <Panel>
          <EmptyState icon={<ListChecks size={18} />} title={view === 'done' ? 'Rien de terminé pour l’instant' : 'Aucune tâche'} text="Ajoute une tâche ci-dessus ou demande à NEXUS d’en créer à partir d’un projet." />
        </Panel>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="label mb-2 flex items-center gap-2 px-1">
                <span className={g.key === 'late' ? 'text-danger' : g.key === 'today' ? 'text-warn' : ''}>{g.label}</span>
                <span className="font-mono text-ink-4">{g.items.length}</span>
              </div>
              <Panel className="p-1.5">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setSelected} onDelete={(x) => del.mutate(x.id)} />
                ))}
              </Panel>
            </section>
          ))}
        </div>
      )}
      <TaskEditor task={selected} projects={projects} onClose={() => setSelected(null)} />
    </div>
  );
}

function TaskEditor({ task, projects, onClose }: { task: Task | null; projects: ProjectSummary[]; onClose: () => void }) {
  const [f, setF] = useState({ title: '', notes: '', status: 'todo', priority: '2', due_date: '', project_id: '' });
  useEffect(() => {
    if (task) setF({ title: task.title, notes: task.notes, status: task.status, priority: String(task.priority), due_date: task.due_date ?? '', project_id: task.project_id ?? '' });
  }, [task]);
  const save = useAction(
    () => api(`/tasks/${task!.id}`, { method: 'PATCH', body: { ...f, priority: Number(f.priority), due_date: f.due_date || null, project_id: f.project_id || null } }),
    { success: 'Tâche mise à jour' },
  );
  const del = useAction(() => api(`/tasks/${task!.id}`, { method: 'DELETE' }), { success: 'Tâche supprimée' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Drawer open={Boolean(task)} onClose={onClose}>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <span className="label">Tâche</span>
        <IconButton label="Fermer" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <Field label="Titre">
          <Input value={f.title} onChange={set('title')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Statut">
            <Select value={f.status} onChange={set('status')}>
              <option value="todo">À faire</option>
              <option value="doing">En cours</option>
              <option value="done">Terminée</option>
            </Select>
          </Field>
          <Field label="Priorité">
            <Select value={f.priority} onChange={set('priority')}>
              <option value="1">Haute</option>
              <option value="2">Normale</option>
              <option value="3">Basse</option>
            </Select>
          </Field>
          <Field label="Échéance">
            <Input type="date" value={f.due_date} onChange={set('due_date')} />
          </Field>
          <Field label="Projet">
            <Select value={f.project_id} onChange={set('project_id')}>
              <option value="">Aucun</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={8} value={f.notes} onChange={set('notes')} placeholder="Contexte, liens, sous-étapes…" />
        </Field>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3.5">
        <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => confirm('Supprimer cette tâche ?') && del.mutate(undefined, { onSuccess: onClose })}>
          Supprimer
        </Button>
        <Button variant="primary" loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
          Enregistrer
        </Button>
      </div>
    </Drawer>
  );
}
