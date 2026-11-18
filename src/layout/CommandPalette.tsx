/**
 * Palette de commandes (⌘K) : navigation, actions, recherche dans toute la mémoire,
 * et question directe à NEXUS AI.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CornerDownLeft, Plus, Search, Sparkles, Settings2 } from 'lucide-react';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { cx } from '../lib/format';
import { ENTITY } from '../lib/entities';
import type { EntityKind, SearchHit } from '../lib/types';
import { NAV } from './Shell';
import { Kbd } from '../components/ui';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose, onCapture }: { open: boolean; onClose: () => void; onCapture: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).then(setHits).catch(() => {});
    }, 120);
    return () => (clearTimeout(t), ctrl.abort());
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => (navigate(to), onClose());
    const needle = q.trim().toLowerCase();
    const base: Item[] = [
      ...NAV.map((n) => ({ id: `nav-${n.to}`, group: 'Aller à', label: n.label, icon: n.icon, run: go(n.to), hint: `G ${n.key.toUpperCase()}` })),
      { id: 'nav-settings', group: 'Aller à', label: 'Réglages', icon: Settings2, run: go('/settings'), hint: 'G ,' },
      { id: 'act-capture', group: 'Actions', label: 'Capture rapide (tâche, idée, note)', icon: Plus, run: () => (onClose(), onCapture()), hint: 'N' },
      { id: 'act-project', group: 'Actions', label: 'Nouveau projet', icon: Plus, run: go('/projects?new=1') },
      { id: 'act-chat', group: 'Actions', label: 'Nouvelle conversation avec NEXUS', icon: Sparkles, run: go('/ai?new=1') },
    ];
    const filtered = needle ? base.filter((i) => i.label.toLowerCase().includes(needle)) : base;
    const found: Item[] = hits.map((h) => {
      const meta = ENTITY[h.kind as EntityKind];
      return { id: `hit-${h.kind}-${h.ref_id}`, group: 'Mémoire', label: h.title || h.snippet.slice(0, 80) || '(sans titre)', hint: meta?.label, icon: meta?.icon ?? Search, color: meta?.color, run: go(meta ? meta.href(h.ref_id) : '/') };
    });
    const ask: Item[] = needle ? [{ id: 'ask', group: 'NEXUS AI', label: `Demander à NEXUS : « ${q.trim()} »`, icon: Sparkles, color: '#ff6b2c', run: go(`/ai?new=1&q=${encodeURIComponent(q.trim())}`) }] : [];
    // Commandes correspondantes d'abord, puis la question à l'IA, puis la mémoire.
    return needle ? [...filtered, ...ask, ...found] : filtered;
  }, [q, hits, onClose, onCapture]);

  useEffect(() => setSel(0), [q, hits.length]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
    else if (e.key === 'Enter') (e.preventDefault(), items[sel]?.run());
    else if (e.key === 'Escape') onClose();
  };

  let lastGroup = '';
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="panel hud relative w-full max-w-[620px] overflow-hidden bg-overlay/95 backdrop-blur-xl"
            role="dialog"
            aria-label="Palette de commandes"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={17} className="text-ink-3" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="Rechercher dans NEXUS ou poser une question…"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
              />
              <Kbd>ESC</Kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {items.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-ink-3">Aucun résultat</div>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <div key={it.id}>
                    {header && <div className="label px-3 pb-1.5 pt-3 !text-[9.5px]">{header}</div>}
                    <button
                      onMouseMove={() => setSel(i)}
                      onClick={it.run}
                      className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] transition-colors', sel === i ? 'bg-white/[0.07] text-ink' : 'text-ink-2')}
                    >
                      <it.icon size={15} className="shrink-0" style={it.color ? { color: it.color } : undefined} />
                      <span className="flex-1 truncate" style={it.id === 'ask' ? { color: '#ffb28a' } : undefined}>
                        {it.label}
                      </span>
                      {it.hint && <span className="font-mono text-[10.5px] text-ink-3">{it.hint}</span>}
                      {sel === i && (it.id === 'ask' ? <ArrowRight size={14} className="text-signal" /> : <CornerDownLeft size={13} className="text-ink-3" />)}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
