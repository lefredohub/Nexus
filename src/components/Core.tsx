/**
 * Le « noyau » NEXUS : signature visuelle de l'IA.
 * États : idle (respiration lente), thinking (rotation + pulsation), offline (éteint).
 */
import { cx } from '../lib/format';

export function Core({ size = 40, state = 'idle', className }: { size?: number; state?: 'idle' | 'thinking' | 'offline'; className?: string }) {
  const off = state === 'offline';
  const thinking = state === 'thinking';
  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }} aria-hidden>
      {thinking && <span className="absolute inset-0 rounded-full border border-signal/50" style={{ animation: 'pulse-ring 1.6s ease-out infinite' }} />}
      <svg viewBox="0 0 40 40" width={size} height={size} className="absolute inset-0">
        <defs>
          <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={off ? '#555' : '#ffb28a'} />
            <stop offset="45%" stopColor={off ? '#333' : '#ff6b2c'} />
            <stop offset="100%" stopColor={off ? '#222' : '#ff6b2c'} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="20" cy="20" r="18.5" fill="none" stroke={off ? '#333' : '#ff6b2c'} strokeOpacity={0.22} />
        <g style={{ transformOrigin: '20px 20px', animation: off ? undefined : `spin-slow ${thinking ? 2.2 : 14}s linear infinite` }}>
          <circle cx="20" cy="20" r="14" fill="none" stroke={off ? '#444' : '#ff6b2c'} strokeOpacity={0.75} strokeWidth="1.2" strokeDasharray="30 58" strokeLinecap="round" />
        </g>
        <g style={{ transformOrigin: '20px 20px', animation: off ? undefined : `spin-slow ${thinking ? 3.4 : 22}s linear infinite reverse` }}>
          <circle cx="20" cy="20" r="10" fill="none" stroke={off ? '#444' : '#ffd2bc'} strokeOpacity={0.5} strokeWidth="0.8" strokeDasharray="4 6" />
        </g>
        <circle cx="20" cy="20" r={thinking ? 6.5 : 5.5} fill="url(#core-glow)" style={{ transition: 'r .4s' }} />
        <circle cx="20" cy="20" r="2" fill={off ? '#666' : '#fff4ee'} />
      </svg>
    </div>
  );
}
