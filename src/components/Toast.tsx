import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check } from 'lucide-react';

type Toast = { id: number; message: string; tone: 'info' | 'error' };
let push: ((t: Toast) => void) | null = null;
let seq = 0;

export function toast(message: string, tone: 'info' | 'error' = 'info') {
  push?.({ id: ++seq, message, tone });
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((xs) => [...xs.slice(-3), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === 'error' ? 6000 : 3200);
    };
    return () => void (push = null);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2 max-md:bottom-24" role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto flex max-w-[90vw] items-center gap-2.5 rounded-xl border border-line-strong bg-overlay/95 px-4 py-2.5 text-[13px] shadow-2xl backdrop-blur"
          >
            {t.tone === 'error' ? <AlertTriangle size={15} className="shrink-0 text-danger" /> : <Check size={15} className="shrink-0 text-signal" />}
            <span>{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
