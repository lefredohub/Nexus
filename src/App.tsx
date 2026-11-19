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
import { Jarvis } from './pages/Jarvis';
import { Pair } from './pages/Pair';
import { useApi } from './lib/api';
import type { AuthStatus } from './lib/types';
import { Core } from './components/Core';
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
  if (path === '/jarvis') return { key: 'jarvis', el: <Jarvis /> };
  return { key: '404', el: <EmptyState title="Page introuvable" text={path} /> };
}

const FULL_HEIGHT = new Set(['ai', 'graph', 'jarvis']);

export function App() {
  // Sur un appareil distant non appairé, on n'affiche que l'écran d'appairage.
  const { data: auth, isLoading, error } = useApi<AuthStatus>(['auth'], '/auth/status', { staleTime: 60_000 });
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Core size={56} state="thinking" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <Core size={56} state="offline" />
        <div className="text-[17px] font-medium">NEXUS est injoignable</div>
        <p className="max-w-xs text-[13.5px] text-ink-3">Vérifie que ton Mac est allumé, que NEXUS tourne, et que l’iPhone est connecté (Tailscale ou même Wi-Fi).</p>
        <button onClick={() => location.reload()} className="rounded-[10px] border border-line-strong px-4 py-2 text-[13px]">
          Réessayer
        </button>
      </div>
    );
  }
  if (auth && !auth.authenticated) return <Pair />;
  return <AppShell />;
}

function AppShell() {
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
