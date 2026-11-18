/**
 * Graphiques SVG faits maison : légers, cohérents avec le design, interactifs
 * (réticule + infobulle au survol). Palette catégorielle à ordre fixe (S1…S5),
 * validée pour le daltonisme et le contraste sur fond sombre.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cx } from '../lib/format';

export const SERIES = ['var(--color-s1)', 'var(--color-s2)', 'var(--color-s3)', 'var(--color-s4)', 'var(--color-s5)'];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Bornes « jolies » pour l'axe Y. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 4), Math.max(4, width - 172));
  return (
    <div className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-line-strong bg-overlay/95 px-3 py-2 text-[12px] shadow-xl backdrop-blur" style={{ left, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[3px] w-3 rounded-full" style={{ background: it.dashed ? `repeating-linear-gradient(90deg, ${it.color} 0 3px, transparent 3px 5px)` : it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ─── Courbes / aires ─────────────────────────────────────────────────────────

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  area?: boolean;
  dashed?: boolean;
}

export function LineChart({ labels, series, height = 200, format = (n) => String(Math.round(n)), tooltipLabels, target, className }: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  tooltipLabels?: string[];
  target?: { value: number; label: string };
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 40, r: 10, t: 12, b: 24 };
  const n = labels.length;
  const all = series.flatMap((s) => s.values).concat(target ? [target.value] : []);
  const rawMin = Math.min(0, ...all);
  const max = niceMax(Math.max(...all, 0) * 1.05);
  const min = rawMin < 0 ? -niceMax(-rawMin) : 0;
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  const ticks = [min, min + (max - min) / 2, max];
  const every = Math.ceil(n / Math.max(2, Math.floor(iw / 56)));

  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = s.values.map((v, i) => [x(i), y(v)] as const);
        const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
        const area = pts.length ? `${line}L${pts[pts.length - 1][0].toFixed(1)},${y(Math.max(min, 0))}L${pts[0][0].toFixed(1)},${y(Math.max(min, 0))}Z` : '';
        return { s, line, area };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, width, height, min, max],
  );

  return (
    <div ref={ref} className={cx('relative select-none', className)} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.06)" strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" className="fill-ink-3 font-mono text-[10px]">
                {format(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            (i % every === 0 && n - 1 - i >= every * 0.6) || i === n - 1 ? (
              <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="fill-ink-3 font-mono text-[10px]">
                {l}
              </text>
            ) : null,
          )}
          {target && (
            <g>
              <line x1={pad.l} x2={width - pad.r} y1={y(target.value)} y2={y(target.value)} stroke="rgb(255 255 255 / 0.35)" strokeDasharray="4 4" />
              <text x={width - pad.r} y={y(target.value) - 5} textAnchor="end" className="fill-ink-2 font-mono text-[10px]">
                {target.label}
              </text>
            </g>
          )}
          {paths.map(({ s, line, area }) => (
            <g key={s.key}>
              {s.area && <motion.path d={area} fill={`url(#grad-${s.key})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />}
              <motion.path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '4 4' : undefined}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              />
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="rgb(255 255 255 / 0.2)" />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={s.color} stroke="var(--color-base)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect
            x={pad.l}
            y={0}
            width={iw}
            height={height}
            fill="transparent"
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
              const rel = (e.clientX - rect.left) / rect.width;
              setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
            }}
          />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip x={x(hover)} y={pad.t} width={width}>
          <div className="mb-1 font-mono text-[10.5px] uppercase tracking-wider text-ink-3">{tooltipLabels?.[hover] ?? labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="num text-ink">{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

// ─── Barres ──────────────────────────────────────────────────────────────────

export function BarChart({ labels, series, height = 180, format = (n) => String(Math.round(n)), tooltipLabels, highlightLast, className }: {
  labels: string[];
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  tooltipLabels?: string[];
  highlightLast?: boolean;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 36, r: 6, t: 10, b: 22 };
  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)) * 1.05);
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const slot = iw / Math.max(1, n);
  const gap = 2;
  const groupW = Math.min(slot * 0.72, 22 * series.length + gap * (series.length - 1));
  const barW = Math.max(2, (groupW - gap * (series.length - 1)) / series.length);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const every = Math.ceil(n / Math.max(2, Math.floor(iw / 44)));

  return (
    <div ref={ref} className={cx('relative select-none', className)} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.06)" strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" className="fill-ink-3 font-mono text-[10px]">
                {format(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) => {
            const gx = pad.l + slot * i + (slot - groupW) / 2;
            const dim = hover !== null && hover !== i;
            return (
              <g key={i} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity .2s' }}>
                {series.map((s, k) => {
                  const v = s.values[i] ?? 0;
                  const h = Math.max(0, y(0) - y(v));
                  const r = Math.min(4, barW / 2, h);
                  const bx = gx + k * (barW + gap);
                  const by = y(v);
                  const faded = highlightLast && i !== n - 1 && hover === null;
                  // Barre arrondie en haut uniquement, ancrée à la ligne de base.
                  const d = h <= 0 ? '' : `M${bx},${by + h}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + barW - r}Q${bx + barW},${by} ${bx + barW},${by + r}V${by + h}Z`;
                  return <motion.path key={s.key} d={d} fill={s.color} opacity={faded ? 0.55 : 1} initial={{ opacity: 0 }} animate={{ opacity: faded ? 0.55 : 1 }} transition={{ duration: 0.5, delay: i * 0.025 }} />;
                })}
                {((i % every === 0 && n - 1 - i >= every * 0.6) || i === n - 1) && (
                  <text x={pad.l + slot * i + slot / 2} y={height - 6} textAnchor="middle" className="fill-ink-3 font-mono text-[10px]">
                    {l}
                  </text>
                )}
                <rect x={pad.l + slot * i} y={0} width={slot} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip x={pad.l + slot * hover + slot / 2} y={pad.t} width={width}>
          <div className="mb-1 font-mono text-[10.5px] uppercase tracking-wider text-ink-3">{tooltipLabels?.[hover] ?? labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="num text-ink">{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

export function Sparkline({ values, color = 'var(--color-signal)', height = 32, className, area = true }: { values: number[]; color?: string; height?: number; className?: string; area?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const n = values.length;
  const pts = values.map((v, i) => [n <= 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2, 3 + (height - 6) * (1 - (v - min) / (max - min || 1))] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const id = useMemo(() => `sp-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div ref={ref} className={cx('w-full', className)} style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} aria-hidden>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {area && <path d={`${line}L${pts[n - 1][0]},${height}L${pts[0][0]},${height}Z`} fill={`url(#${id})`} />}
          <motion.path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
          <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r={2.5} fill={color} />
        </svg>
      )}
    </div>
  );
}

// ─── Calendrier d'habitude (heatmap) ─────────────────────────────────────────

export function HabitCalendar({ checks, color, days = 84, onToggle, today }: { checks: string[]; color: string; days?: number; onToggle?: (date: string, done: boolean) => void; today: string }) {
  const set = new Set(checks);
  const [y, m, d] = today.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  const lastMonday = new Date(end);
  lastMonday.setDate(end.getDate() - ((end.getDay() + 6) % 7));
  const nWeeks = Math.ceil(days / 7);
  const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const weeks = Array.from({ length: nWeeks }, (_, w) =>
    Array.from({ length: 7 }, (_, dow) => {
      const dt = new Date(lastMonday);
      dt.setDate(lastMonday.getDate() - (nWeeks - 1 - w) * 7 + dow);
      const key = iso(dt);
      return { iso: key, future: key > today, done: set.has(key) };
    }),
  );
  return (
    <div className="flex gap-[3px] overflow-hidden">
      {weeks.map((w, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {w.map((c) => (
            <button
              key={c.iso}
              disabled={c.future || !onToggle}
              title={`${c.iso}${c.done ? ' · fait' : ''}`}
              onClick={() => onToggle?.(c.iso, !c.done)}
              className={cx('h-[11px] w-[11px] rounded-[3px] transition-transform', !c.future && onToggle && 'hover:scale-125', c.iso === today && 'ring-1 ring-white/40')}
              style={{ background: c.future ? 'transparent' : c.done ? color : 'rgb(255 255 255 / 0.05)' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Barres horizontales (répartition) ───────────────────────────────────────

export function HBars({ items, format, color = 'var(--color-s2)' }: { items: { label: string; value: number }[]; format: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => (
        <div key={it.label} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="truncate text-ink-2 group-hover:text-ink">{it.label}</span>
            <span className="num shrink-0 text-ink">
              {format(it.value)} <span className="text-ink-3">· {Math.round((it.value / total) * 100)} %</span>
            </span>
          </div>
          <div className="h-[6px] overflow-hidden rounded-full bg-white/[0.05]">
            <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${(it.value / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }} />
          </div>
        </div>
      ))}
    </div>
  );
}
