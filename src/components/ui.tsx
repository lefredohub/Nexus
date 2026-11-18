/**
 * Composants d'interface réutilisables. Un seul fichier volontairement :
 * c'est le « vocabulaire » visuel de NEXUS.
 */
import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X, Loader2 } from 'lucide-react';
import { cx } from '../lib/format';

// ─── Boutons ─────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-signal text-[#1a0a02] hover:bg-[#ff7e47] shadow-[0_0_0_1px_rgb(255_107_44/0.5),0_8px_24px_-8px_rgb(255_107_44/0.6)] disabled:bg-white/[0.07] disabled:text-ink-2 disabled:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]',
  secondary: 'bg-white/[0.05] text-ink border border-line hover:bg-white/[0.08] hover:border-line-strong',
  ghost: 'text-ink-2 hover:text-ink hover:bg-white/[0.05]',
  danger: 'text-danger border border-danger/30 hover:bg-danger/10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          'focus-ring inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60',
          size === 'sm' ? 'h-8 px-3 text-[12.5px]' : 'h-9 px-3.5 text-[13px]',
          VARIANTS[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('focus-ring inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ─── Champs ──────────────────────────────────────────────────────────────────

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block space-y-1.5', className)}>
      <span className="label block">{label}</span>
      {children}
      {error ? <span className="block text-[12px] text-danger">{error}</span> : hint ? <span className="block text-[12px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('field', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('field resize-none', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('field', className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('focus-ring relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-300', checked ? 'border-signal/60 bg-signal/80' : 'border-line-strong bg-white/[0.06]')}
    >
      <span className={cx('absolute top-[2px] h-4 w-4 rounded-full bg-white shadow transition-all duration-300 ease-out-expo', checked ? 'left-[18px]' : 'left-[2px]')} />
    </button>
  );
}

// ─── Structure ───────────────────────────────────────────────────────────────

export function Panel({ children, className, hud, hover, as: As = 'div', ...rest }: { children?: ReactNode; className?: string; hud?: boolean; hover?: boolean; as?: 'div' | 'section' | 'article' } & Record<string, unknown>) {
  return (
    <As className={cx('panel', hud && 'hud', hover && 'panel-hover', className)} {...rest}>
      {children}
    </As>
  );
}

export function SectionHeader({ index, title, action, className }: { index?: string; title: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex items-center justify-between gap-3', className)}>
      <div className="label flex items-center gap-2">
        {index && <span className="text-signal/80">{index}</span>}
        {index && <span className="h-px w-3 bg-ink-4" />}
        <span>{title}</span>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="label mb-2 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_10px_#ff6b2c]" />
          {eyebrow}
        </div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] md:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[14px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'signal' | 'ok' | 'warn' | 'danger' | 'ion'; className?: string }) {
  const tones = {
    neutral: 'border-line text-ink-2 bg-white/[0.03]',
    signal: 'border-signal/30 text-signal bg-signal/10',
    ok: 'border-ok/25 text-ok bg-ok/10',
    warn: 'border-warn/25 text-warn bg-warn/10',
    danger: 'border-danger/30 text-danger bg-danger/10',
    ion: 'border-ion/25 text-ion bg-ion/10',
  };
  return <span className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md border px-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em]', tones[tone], className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-white/[0.04] px-1 font-mono text-[10.5px] text-ink-3">{children}</kbd>;
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white/[0.03] text-ink-3">{icon}</div>}
      <div className="font-medium">{title}</div>
      {text && <div className="mt-1 max-w-sm text-[13px] text-ink-3">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function ProgressBar({ value, color = 'var(--color-signal)', className, height = 4 }: { value: number; color?: string; className?: string; height?: number }) {
  return (
    <div className={cx('w-full overflow-hidden rounded-full bg-white/[0.06]', className)} style={{ height }} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
    </div>
  );
}

export function Ring({ value, size = 44, stroke = 3, color = 'var(--color-signal)', children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; className?: string }) {
  const id = useId();
  return (
    <div className={cx('inline-flex rounded-[11px] border border-line bg-white/[0.02] p-[3px]', className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx('focus-ring relative h-7 rounded-lg px-3 text-[12.5px] font-medium transition-colors', value === it.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
        >
          {value === it.value && <motion.span layoutId={`tab-${id}`} className="absolute inset-0 rounded-lg border border-line-strong bg-white/[0.07]" transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }} />}
          <span className="relative">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Fenêtres ────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={cx('panel relative flex max-h-[92vh] w-full flex-col !rounded-b-none bg-overlay sm:!rounded-[14px]', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div className="font-medium">{title}</div>
              <IconButton label="Fermer" onClick={onClose}>
                <X size={16} />
              </IconButton>
            </div>
            <div className="overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({ open, onClose, children, width = 460 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/40 md:bg-black/20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-overlay/95 shadow-2xl backdrop-blur-xl"
            style={{ maxWidth: width }}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Animation d'entrée standard des pages et blocs. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}
