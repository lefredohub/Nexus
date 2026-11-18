import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { match, usePath } from './lib/router';
import { Shell } from './layout/Shell';
import { Toaster } from './components/Toast';
import { CommandCenter } from './pages/CommandCenter';
import { Assistant } from './pages/Assistant';
import { MemoryGraph } from './pages/MemoryGraph';
import { ProjectLab } from './pages/ProjectLab';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { TasksPage } from './pages/Tasks';
import { Analytics } from './pages/Analytics';
import { IdeaEngine } from './pages/IdeaEngine';
import { AutomationLab } from './pages/AutomationLab';
import { SettingsPage } from './pages/Settings';
import { EmptyState } from './components/ui';

function route(path: string) {
  let m: Record<string, string> | null;
  if (path === '/') return { key: 'home', el: <CommandCenter /> };
  if (path === '/ai') return { key: 'ai', el: <Assistant /> };
  if ((m = match('/ai/:id', path))) return { key: 'ai', el: <Assistant conversationId={m.id} /> };
  if (path === '/graph') return { key: 'graph', el: <MemoryGraph /> };
  if (path === '/projects') return { key: 'projects', el: <ProjectLab /> };
  if ((m = match('/projects/:id', path))) return { key: `project-${m.id}`, el: <ProjectDetailPage id={m.id} /> };
  if (path === '/tasks') return { key: 'tasks', el: <TasksPage /> };
  if (path === '/analytics') return { key: 'analytics', el: <Analytics /> };
  if (path === '/ideas') return { key: 'ideas', el: <IdeaEngine /> };
  if (path === '/automations') return { key: 'automations', el: <AutomationLab /> };
  if ((m = match('/automations/:id', path))) return { key: 'automations', el: <AutomationLab selectedId={m.id} /> };
  if (path === '/settings') return { key: 'settings', el: <SettingsPage /> };
  return { key: '404', el: <EmptyState title="Page introuvable" text={path} /> };
}

const FULL_HEIGHT = new Set(['ai', 'graph']);

export function App() {
  const path = usePath();
  const { key, el } = route(path);
  useEffect(() => {
    document.getElementById('main')?.scrollTo({ top: 0 });
  }, [key]);
  return (
    <Shell>
      <AnimatePresence mode="wait">
        <motion.div
          key={key}
          className={FULL_HEIGHT.has(key) ? 'h-full' : 'min-h-full'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {el}
        </motion.div>
      </AnimatePresence>
      <Toaster />
    </Shell>
  );
}
