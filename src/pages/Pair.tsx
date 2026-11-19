/**
 * Écran d'appairage, affiché sur un appareil distant (iPhone) pas encore autorisé.
 * Le code à 6 chiffres s'obtient sur le Mac : Réglages → Accès depuis l'iPhone.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api, ApiError, queryClient } from '../lib/api';
import { Core } from '../components/Core';
import { Button, Input } from '../components/ui';

function defaultName() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'Appareil';
}

export function Pair() {
  const params = new URLSearchParams(location.search);
  const [code, setCode] = useState(params.get('pair') ?? '');
  const [name, setName] = useState(defaultName());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  const submit = async (value = code) => {
    if (!/^\d{6}$/.test(value)) return setError('Le code contient 6 chiffres.');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/pair', { body: { code: value, name } });
      history.replaceState(null, '', '/');
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  // Arrivée via le QR code : le code est dans l'adresse, on valide directement.
  useEffect(() => {
    if (!autoTried.current && /^\d{6}$/.test(code)) {
      autoTried.current = true;
      void submit(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex min-h-full items-center justify-center px-6 py-12">
      <div className="atmosphere" />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className="relative w-full max-w-sm text-center">
        <div className="mx-auto mb-6 w-fit">
          <Core size={84} state={busy ? 'thinking' : 'idle'} />
        </div>
        <div className="label mb-3">Connexion sécurisée</div>
        <h1 className="text-[30px] font-semibold tracking-[-0.03em]">
          Relier cet appareil<span className="text-signal">.</span>
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          Sur ton Mac, ouvre NEXUS → <span className="text-ink">Réglages → Accès depuis l’iPhone</span> → <span className="text-ink">Appairer un appareil</span>, puis saisis le code affiché.
        </p>
        <form
          className="mt-8 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="Code d’appairage"
            className="!h-14 text-center font-mono !text-[26px] tracking-[0.4em]"
            autoFocus
          />
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom de l’appareil" placeholder="Nom de l’appareil" className="text-center" maxLength={60} />
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <Button type="submit" variant="primary" className="!h-11 w-full" loading={busy} disabled={code.length !== 6}>
            Relier
          </Button>
        </form>
        <p className="mt-6 text-[12px] leading-relaxed text-ink-3">Le code est valable 10 minutes et ne sert qu’une fois. Tu pourras retirer cet appareil à tout moment depuis le Mac.</p>
      </motion.div>
    </div>
  );
}
