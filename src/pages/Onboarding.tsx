import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Database, Sparkles } from 'lucide-react';
import { api, useAction } from '../lib/api';
import { Core } from '../components/Core';
import { Input } from '../components/ui';

export function Onboarding() {
  const [name, setName] = useState('');
  const saveName = () => (name.trim() ? api('/settings', { method: 'PATCH', body: { user_name: name.trim() } }) : Promise.resolve());
  const demo = useAction(async () => {
    await saveName();
    return api('/demo', { body: {} });
  }, { success: 'Espace de démonstration prêt' });
  const blank = useAction(async () => {
    await saveName();
    return api('/settings', { method: 'PATCH', body: { onboarded: true } });
  });

  return (
    <div className="flex min-h-full items-center justify-center px-5 py-12">
      <div className="w-full max-w-[640px] text-center">
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} className="mx-auto mb-8 w-fit">
          <Core size={96} state="thinking" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
          <div className="label mb-4">Initialisation du système</div>
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[56px]">
            Bienvenue dans <span className="tracking-[0.12em]">NEXUS</span>
            <span className="text-signal">.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-ink-2">
            Ton centre de contrôle personnel : projets, idées, objectifs, données et une IA qui les connaît. Tout reste sur ta machine.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className="mx-auto mt-10 max-w-sm">
          <label className="label mb-2 block text-left">Comment dois-je t’appeler ?</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ton prénom" className="!h-11 text-center !text-[15px]" maxLength={60} />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className="mt-8 grid gap-3 text-left sm:grid-cols-2">
          <button onClick={() => blank.mutate(undefined)} disabled={blank.isPending || demo.isPending} className="panel panel-hover group p-5 text-left">
            <Sparkles size={18} className="mb-3 text-signal" />
            <div className="font-medium">Partir de zéro</div>
            <div className="mt-1 text-[13px] text-ink-3">Un espace vierge pour tes vraies données.</div>
            <ArrowRight size={15} className="mt-4 text-ink-3 transition-transform group-hover:translate-x-1 group-hover:text-ink" />
          </button>
          <button onClick={() => demo.mutate(undefined)} disabled={blank.isPending || demo.isPending} className="panel panel-hover group p-5 text-left">
            <Database size={18} className="mb-3 text-ion" />
            <div className="font-medium">{demo.isPending ? 'Chargement…' : 'Explorer avec une démo'}</div>
            <div className="mt-1 text-[13px] text-ink-3">Projets, finances, sport et habitudes fictifs pour tout découvrir. Effaçable ensuite.</div>
            <ArrowRight size={15} className="mt-4 text-ink-3 transition-transform group-hover:translate-x-1 group-hover:text-ink" />
          </button>
        </motion.div>
      </div>
    </div>
  );
}
