import { motion } from 'motion/react';
import { Check, Trash2 } from 'lucide-react';
import { api, useAction } from '../lib/api';
import { cx, fmtDue } from '../lib/format';
import type { Task } from '../lib/types';
import { Link } from '../lib/router';

const PRIORITY = { 1: { label: 'P1', cls: 'text-signal' }, 2: { label: 'P2', cls: 'text-ink-3' }, 3: { label: 'P3', cls: 'text-ink-4' } } as const;

export function TaskCheck({ task }: { task: Task }) {
  const done = task.status === 'done';
  const toggle = useAction(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: done ? 'todo' : 'done' } }), { silent: false });
  return (
    <button
      aria-label={done ? 'Marquer comme à faire' : 'Marquer comme terminée'}
      onClick={(e) => (e.stopPropagation(), toggle.mutate(undefined))}
      className={cx(
        'focus-ring relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-all duration-300',
        done ? 'border-signal bg-signal' : 'border-line-strong hover:border-signal/70 hover:bg-signal/10',
        toggle.isPending && 'opacity-60',
      )}
    >
      {done && (
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5, duration: 0.4 }}>
          <Check size={12} strokeWidth={3} className="text-[#1a0a02]" />
        </motion.span>
      )}
    </button>
  );
}

export function TaskRow({ task, showProject = true, onOpen, onDelete }: { task: Task; showProject?: boolean; onOpen?: (t: Task) => void; onDelete?: (t: Task) => void }) {
  const due = fmtDue(task.due_date);
  const done = task.status === 'done';
  return (
    <div
      className={cx('group flex items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-white/[0.035]', onOpen && 'cursor-pointer')}
      onClick={() => onOpen?.(task)}
    >
      <TaskCheck task={task} />
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-[13.5px] transition-colors', done ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{task.title}</div>
        {(showProject && task.project_title) || task.status === 'doing' ? (
          <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
            {task.status === 'doing' && <span className="text-ion">● en cours</span>}
            {showProject && task.project_title && task.project_id && (
              <Link to={`/projects/${task.project_id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 truncate hover:text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: task.project_color ?? '#888' }} />
                {task.project_title}
              </Link>
            )}
          </div>
        ) : null}
      </div>
      {due && !done && (
        <span className={cx('shrink-0 font-mono text-[11px]', due.tone === 'late' ? 'text-danger' : due.tone === 'today' ? 'text-warn' : 'text-ink-3')}>{due.text}</span>
      )}
      <span className={cx('w-6 shrink-0 text-right font-mono text-[10.5px]', PRIORITY[task.priority].cls)}>{PRIORITY[task.priority].label}</span>
      {onDelete && (
        <button aria-label="Supprimer" onClick={(e) => (e.stopPropagation(), onDelete(task))} className="shrink-0 text-ink-4 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
