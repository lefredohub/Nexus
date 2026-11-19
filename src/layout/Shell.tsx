import { useEffect, useState, type ReactNode } from 'react';
import { AudioLines, LayoutGrid, Sparkles, Network, FolderKanban, ListChecks, Activity, Lightbulb, Workflow, Settings2, Search, Plus } from 'lucide-react';
import { Link, navigate, usePath } from '../lib/router';
import { useApi } from '../lib/api';
import { cx } from '../lib/format';
import type { AIStatus } from '../lib/types';
import { Core } from '../components/Core';
import { Kbd } from '../components/ui';
import { CommandPalette } from './CommandPalette';
import { QuickCapture } from './QuickCapture';

export const NAV = [
  { to: '/', label: 'Command Center', short: 'Accueil', icon: LayoutGrid, key: 'c' },
  { to: '/ai', label: 'Nexus AI', short: 'IA', icon: Sparkles, key: 'a' },
  { to: '/jarvis', label: 'Jarvis', short: 'Jarvis', icon: AudioLines, key: 'j' },
  { to: '/graph', label: 'Memory Graph', short: 'Graphe', icon: Network, key: 'm' },
  { to: '/projects', label: 'Project Lab', short: 'Projets', icon: FolderKanban, key: 'p' },
  { to: '/tasks', label: 'Tâches', short: 'Tâches', icon: ListChecks, key: 't' },
  { to: '/analytics', label: 'Analytics', short: 'Stats', icon: Activity, key: 's' },
  { to: '/ideas', label: 'Idea Engine', short: 'Idées', icon: Lightbulb, key: 'i' },
  { to: '/automations', label: 'Automation Lab', short: 'Auto', icon: Workflow, key: 'l' },
];

const isActive = (to: string, path: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <span className="num">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>;
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePath();
  const [palette, setPalette] = useState(false);
  const [capture, setCapture] = useState(false);
  const { data: ai } = useApi<AIStatus>(['ai-status'], '/ai/status');

  // Raccourcis : ⌘K palette, « n » capture rapide, « g » puis une lettre pour naviguer.
  useEffect(() => {
    let gPressed = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n') {
        e.preventDefault();
        setCapture(true);
      } else if (e.key === 'g') gPressed = Date.now();
      else if (Date.now() - gPressed < 1000) {
        const item = NAV.find((n) => n.key === e.key) ?? (e.key === ',' ? { to: '/settings' } : null);
        if (item) navigate(item.to);
        gPressed = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const online = ai?.online;

  return (
    <div className="relative flex h-full">
      <div className="atmosphere" />

      {/* Barre latérale (desktop) */}
      <aside className="relative z-10 hidden w-[236px] shrink-0 flex-col border-r border-line bg-base/60 backdrop-blur-xl md:flex">
        <Link to="/" className="flex items-center gap-3 px-5 pb-6 pt-6">
          <Core size={30} state="idle" />
          <div>
            <div className="text-[15px] font-semibold tracking-[0.28em]">NEXUS</div>
            <div className="label !text-[9.5px] !tracking-[0.2em]">Personal OS</div>
          </div>
        </Link>

        <button
          onClick={() => setPalette(true)}
          className="focus-ring mx-3 mb-4 flex h-9 items-center gap-2 rounded-[10px] border border-line bg-white/[0.025] px-3 text-[13px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Rechercher, agir…</span>
          <Kbd>⌘K</Kbd>
        </button>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map((n, i) => {
            const active = isActive(n.to, path);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cx(
                  'focus-ring group relative flex h-9 items-center gap-3 rounded-[10px] px-3 text-[13.5px] transition-colors',
                  active ? 'bg-white/[0.06] text-ink' : 'text-ink-2 hover:bg-white/[0.035] hover:text-ink',
                )}
              >
                {active && <span className="absolute -left-3 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-signal shadow-[0_0_10px_#ff6b2c]" />}
                <n.icon size={16} strokeWidth={1.7} className={active ? 'text-signal' : 'text-ink-3 group-hover:text-ink-2'} />
                <span className="flex-1">{n.label}</span>
                <span className="font-mono text-[10px] text-ink-4 group-hover:text-ink-3">{String(i + 1).padStart(2, '0')}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-line p-3">
          <button onClick={() => setCapture(true)} className="focus-ring flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-[13px] text-ink-2 transition-colors hover:bg-white/[0.04] hover:text-ink">
            <Plus size={15} className="text-signal" />
            <span className="flex-1 text-left">Capture rapide</span>
            <Kbd>N</Kbd>
          </button>
          <Link
            to="/settings"
            className={cx('focus-ring flex items-center gap-3 rounded-[10px] px-3 py-2 transition-colors hover:bg-white/[0.04]', path === '/settings' && 'bg-white/[0.06]')}
          >
            <Settings2 size={15} className="text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-ink-2">Réglages</div>
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-ink-3">
                <span className={cx('h-1.5 w-1.5 rounded-full', online ? 'bg-ok shadow-[0_0_6px_var(--color-ok)]' : 'bg-ink-3')} />
                {online ? (ai?.model ?? '').replace('claude-', '') : 'IA hors ligne'}
              </div>
            </div>
            <span className="font-mono text-[11px] text-ink-3">
              <Clock />
            </span>
          </Link>
        </div>
      </aside>

      {/* Contenu */}
      <main className="relative z-10 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-24 pt-[env(safe-area-inset-top)] md:pb-0 md:pt-0" id="main">
        {children}
      </main>

      {/* Navigation mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-line bg-base/90 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 backdrop-blur-xl md:hidden">
        {[NAV[0], NAV[1], NAV[2], NAV[5]].map((n) => {
          const active = isActive(n.to, path);
          if (n.to === '/jarvis') {
            // Bouton central : le noyau de Jarvis.
            return (
              <Link key={n.to} to={n.to} aria-label="Jarvis" className="-mt-6 flex flex-col items-center gap-0.5 text-[10.5px]">
                <span className={cx('flex h-14 w-14 items-center justify-center rounded-full border bg-base shadow-[0_0_24px_rgb(255_107_44/0.35)]', active ? 'border-signal' : 'border-signal/40')}>
                  <Core size={38} state="idle" />
                </span>
                <span className={active ? 'text-ink' : 'text-ink-3'}>Jarvis</span>
              </Link>
            );
          }
          return (
            <Link key={n.to} to={n.to} className={cx('flex min-w-14 flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10.5px]', active ? 'text-ink' : 'text-ink-3')}>
              <n.icon size={19} strokeWidth={1.7} className={active ? 'text-signal' : ''} />
              {n.short}
            </Link>
          );
        })}
        <button onClick={() => setPalette(true)} className="flex min-w-14 flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10.5px] text-ink-3">
          <Search size={19} strokeWidth={1.7} />
          Plus
        </button>
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} onCapture={() => setCapture(true)} />
      <QuickCapture open={capture} onClose={() => setCapture(false)} />
    </div>
  );
}
