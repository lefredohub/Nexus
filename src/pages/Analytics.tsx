import { useEffect, useState } from 'react';
import { Activity as ActivityIcon, Flame, Plus, Trash2, Upload, Wallet, Target, Gauge, Archive, Pencil } from 'lucide-react';
import { api, useAction, useApi } from '../lib/api';
import { navigate, useSearchParam } from '../lib/router';
import { cx, fmtDate, fmtDue, fmtMoney, fmtNum, fmtPct, monthLabel, todayISO } from '../lib/format';
import type { AnalyticsData, Goal, MetricWithEntries, Settings, Transaction, Workout } from '../lib/types';
import { Badge, Button, EmptyState, Field, IconButton, Input, Modal, PageHeader, Panel, ProgressBar, SectionHeader, Select, Skeleton, Tabs, Textarea } from '../components/ui';
import { BarChart, HBars, HabitCalendar, Legend, LineChart } from '../components/charts';
import { Sources } from './Sources';

type Tab = 'finance' | 'sport' | 'habits' | 'goals' | 'metrics' | 'sources';
const WORKOUT_LABEL: Record<string, string> = { run: 'Course', bike: 'Vélo', swim: 'Natation', strength: 'Renforcement', walk: 'Marche', yoga: 'Yoga', hiit: 'HIIT', sport: 'Sport co.', other: 'Autre' };

export function Analytics() {
  const tabParam = useSearchParam('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(tabParam ?? 'finance');
  useEffect(() => {
    if (tabParam) setTab(tabParam);
  }, [tabParam]);
  const { data, isLoading } = useApi<AnalyticsData>(['analytics'], '/analytics');
  const { data: settings } = useApi<Settings>(['settings'], '/settings');
  const currency = settings?.currency ?? 'EUR';

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-6 md:px-8 md:py-9">
      <PageHeader eyebrow="Personal Analytics" title="Mesurer ce qui compte" subtitle="Finances, sport, habitudes, objectifs et métriques — saisis à la main, prêts pour des intégrations." />
      <Tabs
        value={tab}
        onChange={(t) => (setTab(t), navigate(`/analytics?tab=${t}`, { replace: true }))}
        className="mb-6 max-w-full overflow-x-auto"
        items={[
          { value: 'finance', label: 'Finances' },
          { value: 'sport', label: 'Sport' },
          { value: 'habits', label: 'Habitudes' },
          { value: 'goals', label: 'Objectifs' },
          { value: 'metrics', label: 'Métriques' },
          { value: 'sources', label: 'Sources' },
        ]}
      />
      {isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : tab === 'finance' ? (
        <Finance data={data} currency={currency} />
      ) : tab === 'sport' ? (
        <Sport data={data} />
      ) : tab === 'habits' ? (
        <Habits data={data} />
      ) : tab === 'sources' ? (
        <Sources />
      ) : tab === 'goals' ? (
        <Goals />
      ) : (
        <Metrics metrics={data.metrics} />
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone, icon: Icon }: { label: string; value: string; sub?: string; tone?: string; icon?: typeof Wallet }) {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {Icon && <Icon size={14} className="text-ink-4" />}
      </div>
      <div className={cx('num mt-3 text-[24px] leading-none md:text-[26px]', tone)}>{value}</div>
      {sub && <div className="mt-2 text-[11.5px] text-ink-3">{sub}</div>}
    </Panel>
  );
}

// ─── Finances ────────────────────────────────────────────────────────────────

function Finance({ data, currency }: { data: AnalyticsData; currency: string }) {
  const f = data.finance;
  const { data: txs = [] } = useApi<Transaction[]>(['transactions'], '/transactions');
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({ label: '', amount: '', category: '', date: todayISO(), type: 'expense' });
  const add = useAction(() => api('/transactions', { body: { label: form.label, amount: (form.type === 'expense' ? -1 : 1) * Math.abs(Number(form.amount)), category: form.category || 'Divers', date: form.date } }), { success: 'Opération enregistrée' });
  const del = useAction((id: string) => api(`/transactions/${id}`, { method: 'DELETE' }));
  const money = (n: number) => fmtMoney(n, currency);
  const cur = f.current;
  const expDelta = f.previous && f.previous.expense ? (cur.expense - f.previous.expense) / f.previous.expense : null;
  const categories = [...new Set(txs.map((t) => t.category))];

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="col-span-full grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Solde du mois" value={money(cur.net)} tone={cur.net < 0 ? 'text-danger' : ''} sub={monthLabel(cur.month)} icon={Wallet} />
        <Stat label="Revenus" value={money(cur.income)} sub={f.previous ? `mois précédent ${money(f.previous.income)}` : undefined} />
        <Stat label="Dépenses" value={money(cur.expense)} sub={expDelta !== null ? `${expDelta > 0 ? '+' : ''}${Math.round(expDelta * 100)} % vs mois précédent` : undefined} />
        <Stat label="Taux d’épargne" value={f.savingsRate !== null ? fmtPct(f.savingsRate) : '—'} sub={`solde cumulé ${money(f.balance)}`} />
      </div>
      <Panel className="p-5 lg:col-span-8">
        <SectionHeader title="Revenus et dépenses · 6 mois" action={<Legend items={[{ label: 'Revenus', color: 'var(--color-s2)' }, { label: 'Dépenses', color: 'var(--color-s1)' }]} />} />
        <BarChart
          labels={f.series.map((s) => monthLabel(s.month))}
          series={[
            { key: 'income', label: 'Revenus', color: 'var(--color-s2)', values: f.series.map((s) => s.income) },
            { key: 'expense', label: 'Dépenses', color: 'var(--color-s1)', values: f.series.map((s) => s.expense) },
          ]}
          format={(n) => (Math.abs(n) >= 1000 ? `${fmtNum(n / 1000, 1)}k` : fmtNum(n))}
          height={230}
        />
      </Panel>
      <Panel className="p-5 lg:col-span-4">
        <SectionHeader title="Dépenses du mois par catégorie" />
        {f.categories.length === 0 ? <EmptyState title="Aucune dépense ce mois-ci" /> : <HBars items={f.categories.slice(0, 7).map((c) => ({ label: c.category, value: c.total }))} format={money} color="var(--color-s1)" />}
      </Panel>
      <Panel className="p-5 lg:col-span-12">
        <SectionHeader
          title="Opérations"
          action={
            <Button size="sm" icon={<Upload size={13} />} onClick={() => setImporting(true)}>
              Importer un relevé CSV
            </Button>
          }
        />
        <form
          className="mb-4 grid gap-2 sm:grid-cols-[110px_1fr_140px_150px_140px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(form.amount) > 0) add.mutate(undefined, { onSuccess: () => setForm((x) => ({ ...x, label: '', amount: '' })) });
          }}
        >
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="!h-9 !py-0 text-[12.5px]" aria-label="Type">
            <option value="expense">Dépense</option>
            <option value="income">Revenu</option>
          </Select>
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Libellé" className="!h-9" />
          <Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} type="number" step="0.01" min="0" placeholder="Montant" className="!h-9" />
          <Input list="tx-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Catégorie" className="!h-9" />
          <datalist id="tx-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="!h-9" />
          <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={!(Number(form.amount) > 0)}>
            Ajouter
          </Button>
        </form>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-base/95 text-left backdrop-blur">
              <tr className="label">
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Libellé</th>
                <th className="hidden py-2 font-normal sm:table-cell">Catégorie</th>
                <th className="py-2 text-right font-normal">Montant</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {txs.slice(0, 120).map((t) => (
                <tr key={t.id} className="group border-t border-line">
                  <td className="py-2 font-mono text-[11.5px] text-ink-3">{fmtDate(t.date)}</td>
                  <td className="max-w-[240px] truncate py-2">{t.label || '—'}</td>
                  <td className="hidden py-2 text-ink-2 sm:table-cell">
                    {t.category} {t.source !== 'manual' && <Badge className="ml-1">{t.source}</Badge>}
                  </td>
                  <td className={cx('num py-2 text-right', t.amount > 0 ? 'text-ok' : 'text-ink')}>{fmtMoney(t.amount, currency, 2)}</td>
                  <td className="text-right">
                    <button aria-label="Supprimer l’opération" onClick={() => del.mutate(t.id)} className="text-ink-4 opacity-0 hover:text-danger group-hover:opacity-100">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {txs.length === 0 && <EmptyState title="Aucune opération" text="Ajoute-en une ou importe un relevé bancaire." />}
        </div>
      </Panel>
      <CsvImport open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

function CsvImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ header: string[]; sample: string[][]; total: number } | null>(null);
  const [cols, setCols] = useState({ date: '', amount: '', label: '', category: '' });
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [invert, setInvert] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; duplicates: number; errors: string[] } | null>(null);
  useEffect(() => {
    if (open) (setCsv(''), setPreview(null), setResult(null));
  }, [open]);
  const analyze = useAction(async () => {
    const p = await api<{ header: string[]; sample: string[][]; total: number }>('/transactions/preview', { body: { csv } });
    setPreview(p);
    const find = (re: RegExp) => p.header.find((h) => re.test(h.toLowerCase())) ?? '';
    setCols({ date: find(/date/), amount: find(/montant|amount|débit|debit|valeur/), label: find(/libell|label|descr|wording/), category: find(/cat/) });
    const firstDate = p.sample[0]?.[p.header.indexOf(find(/date/))] ?? '';
    setDateFormat(/^\d{4}-/.test(firstDate) ? 'YYYY-MM-DD' : 'DD/MM/YYYY');
    return p;
  });
  const run = useAction(() => api<typeof result>('/transactions/import', { body: { csv, columns: { date: cols.date, amount: cols.amount, label: cols.label || undefined, category: cols.category || undefined }, dateFormat, invertSign: invert } }), {
    success: (r) => `${r?.imported ?? 0} opérations importées`,
  });
  const onFile = async (file: File) => setCsv(await file.text());

  return (
    <Modal open={open} onClose={onClose} wide title="Importer un relevé bancaire (CSV)">
      {result ? (
        <div className="space-y-3">
          <div className="text-[15px]">
            <span className="num text-ok">{result.imported}</span> importées · <span className="num">{result.duplicates}</span> doublons ignorés · <span className="num">{result.skipped}</span> lignes illisibles
          </div>
          {result.errors.map((e, i) => (
            <div key={i} className="text-[12.5px] text-ink-3">{e}</div>
          ))}
          <Button variant="primary" onClick={onClose}>Terminé</Button>
        </div>
      ) : !preview ? (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-2">Exporte tes opérations depuis ta banque au format CSV, puis dépose le fichier ou colle son contenu. Le fichier ne quitte pas ta machine.</p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} className="block text-[13px] text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-white/[0.05] file:px-3 file:py-1.5 file:text-ink" />
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Date;Libellé;Montant\n02/11/2026;CARTE SUPERMARCHE;-54,20'} className="font-mono text-[12px]" />
          <div className="flex justify-end">
            <Button variant="primary" disabled={!csv.trim()} loading={analyze.isPending} onClick={() => analyze.mutate(undefined)}>
              Analyser le fichier
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-[13px] text-ink-2">{preview.total} lignes détectées. Associe les colonnes :</div>
          <div className="grid gap-3 sm:grid-cols-4">
            {(['date', 'amount', 'label', 'category'] as const).map((k) => (
              <Field key={k} label={{ date: 'Date *', amount: 'Montant *', label: 'Libellé', category: 'Catégorie' }[k]}>
                <Select value={cols[k]} onChange={(e) => setCols({ ...cols, [k]: e.target.value })}>
                  <option value="">—</option>
                  {preview.header.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Format de date">
              <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                <option value="DD/MM/YYYY">JJ/MM/AAAA</option>
                <option value="YYYY-MM-DD">AAAA-MM-JJ</option>
                <option value="MM/DD/YYYY">MM/JJ/AAAA</option>
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} className="accent-[#ff6b2c]" />
              Inverser le signe (si les dépenses sont positives)
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[12px]">
              <thead>
                <tr>{preview.header.map((h) => <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-mono text-[10.5px] text-ink-3">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j} className="whitespace-nowrap border-b border-line px-2 py-1.5">{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setPreview(null)}>Retour</Button>
            <Button variant="primary" disabled={!cols.date || !cols.amount} loading={run.isPending} onClick={() => run.mutate(undefined, { onSuccess: (r) => setResult(r) })}>
              Importer {preview.total} lignes
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Sport ───────────────────────────────────────────────────────────────────

function Sport({ data }: { data: AnalyticsData }) {
  const s = data.sport;
  const { data: workouts = [] } = useApi<Workout[]>(['workouts'], '/workouts');
  const [form, setForm] = useState({ type: 'run', duration_min: '', distance_km: '', intensity: '3', date: todayISO() });
  const add = useAction(() => api('/workouts', { body: { type: form.type, duration_min: Number(form.duration_min), distance_km: form.distance_km ? Number(form.distance_km) : null, intensity: Number(form.intensity), date: form.date } }), { success: 'Séance enregistrée' });
  const del = useAction((id: string) => api(`/workouts/${id}`, { method: 'DELETE' }));
  const weekLabels = s.series.map((w) => fmtDate(w.week));
  const avgMin = s.series.slice(0, -1).reduce((a, w) => a + w.minutes, 0) / Math.max(1, s.series.length - 1);

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="col-span-full grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Séances · semaine" value={String(s.current.sessions)} icon={ActivityIcon} />
        <Stat label="Minutes · semaine" value={fmtNum(s.current.minutes)} sub={`moyenne ${fmtNum(avgMin)} min/sem.`} />
        <Stat label="Distance · semaine" value={`${fmtNum(s.current.distance, 1)} km`} />
        <Stat label="Série active" value={`${s.weekStreak} sem.`} sub="semaines consécutives avec au moins une séance" icon={Flame} />
      </div>
      <Panel className="p-5 lg:col-span-8">
        <SectionHeader title="Volume d’entraînement · 12 semaines (minutes)" />
        <BarChart labels={weekLabels} tooltipLabels={s.series.map((w) => `Semaine du ${fmtDate(w.week)}`)} series={[{ key: 'min', label: 'Minutes', color: 'var(--color-s3)', values: s.series.map((w) => w.minutes) }]} height={220} highlightLast />
      </Panel>
      <Panel className="p-5 lg:col-span-4">
        <SectionHeader title="Répartition · 30 jours" />
        {s.byType.length === 0 ? <EmptyState title="Aucune séance récente" /> : <HBars items={s.byType.map((t) => ({ label: WORKOUT_LABEL[t.type] ?? t.type, value: t.minutes }))} format={(n) => `${fmtNum(n)} min`} color="var(--color-s3)" />}
      </Panel>
      <Panel className="p-5 lg:col-span-12">
        <SectionHeader title="Séances" />
        <form className="mb-4 grid gap-2 sm:grid-cols-[150px_1fr_1fr_130px_150px_auto]" onSubmit={(e) => (e.preventDefault(), Number(form.duration_min) > 0 && add.mutate(undefined, { onSuccess: () => setForm((x) => ({ ...x, duration_min: '', distance_km: '' })) }))}>
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="!h-9 !py-0 text-[12.5px]" aria-label="Type">
            {Object.entries(WORKOUT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input type="number" min="1" value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} placeholder="Durée (min)" className="!h-9" />
          <Input type="number" min="0" step="0.1" value={form.distance_km} onChange={(e) => setForm({ ...form, distance_km: e.target.value })} placeholder="Distance (km)" className="!h-9" />
          <Select value={form.intensity} onChange={(e) => setForm({ ...form, intensity: e.target.value })} className="!h-9 !py-0 text-[12.5px]" aria-label="Intensité">
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Intensité {n}/5</option>)}
          </Select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="!h-9" />
          <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={!(Number(form.duration_min) > 0)}>Ajouter</Button>
        </form>
        <div className="max-h-[360px] space-y-0.5 overflow-y-auto">
          {workouts.length === 0 && <EmptyState title="Aucune séance" />}
          {workouts.slice(0, 60).map((w) => (
            <div key={w.id} className="group flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-white/[0.03]">
              <span className="w-14 font-mono text-[11.5px] text-ink-3">{fmtDate(w.date)}</span>
              <span className="w-28">{WORKOUT_LABEL[w.type] ?? w.type}</span>
              <span className="num w-20 text-ink-2">{fmtNum(w.duration_min)} min</span>
              <span className="num w-20 text-ink-2">{w.distance_km ? `${fmtNum(w.distance_km, 1)} km` : ''}</span>
              <span className="flex-1 font-mono text-[11px] text-ink-3">{'▮'.repeat(w.intensity)}<span className="text-ink-4">{'▮'.repeat(5 - w.intensity)}</span></span>
              <button aria-label="Supprimer la séance" onClick={() => del.mutate(w.id)} className="text-ink-4 opacity-0 hover:text-danger group-hover:opacity-100"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ─── Habitudes ───────────────────────────────────────────────────────────────

const HABIT_COLORS = ['#3ccf8e', '#8fb4ff', '#e8b23a', '#ff6b2c', '#e57fa8', '#b9a7ff'];

function Habits({ data }: { data: AnalyticsData }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('7');
  const add = useAction(() => api('/habits', { body: { name, target_per_week: Number(target), color: HABIT_COLORS[data.habits.length % HABIT_COLORS.length] } }), { success: 'Habitude ajoutée' });
  const toggle = useAction(({ id, date, done }: { id: string; date: string; done: boolean }) => api(`/habits/${id}/checks/${date}`, { method: 'PUT', body: { done } }));
  const archive = useAction((id: string) => api(`/habits/${id}`, { method: 'PATCH', body: { archived: true } }), { success: 'Habitude archivée' });
  const today = todayISO();
  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => (e.preventDefault(), name.trim() && add.mutate(undefined, { onSuccess: () => setName('') }))}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouvelle habitude (ex. Lecture 20 pages)" className="!h-9 min-w-[220px] flex-1" />
          <Select value={target} onChange={(e) => setTarget(e.target.value)} className="!h-9 !w-[150px] !py-0 text-[12.5px]" aria-label="Objectif hebdomadaire">
            {[7, 6, 5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}× par semaine</option>)}
          </Select>
          <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={!name.trim()}>Ajouter</Button>
        </form>
      </Panel>
      {data.habits.length === 0 && <Panel><EmptyState icon={<Flame size={18} />} title="Aucune habitude suivie" text="Commence petit : une habitude tenue vaut mieux que cinq abandonnées." /></Panel>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.habits.map((h) => (
          <Panel key={h.id} className="p-5">
            <div className="mb-4 flex items-start gap-3">
              <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ background: h.color, boxShadow: `0 0 10px ${h.color}` }} />
              <div className="flex-1">
                <div className="text-[15px] font-medium">{h.name}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">objectif {h.target_per_week}×/semaine</div>
              </div>
              <IconButton label="Archiver" onClick={() => confirm(`Archiver « ${h.name} » ?`) && archive.mutate(h.id)}><Archive size={14} /></IconButton>
            </div>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div><div className="label">Série</div><div className="num mt-1 text-[22px]">{h.streak}<span className="text-[13px] text-ink-3"> j</span></div></div>
              <div><div className="label">Semaine</div><div className={cx('num mt-1 text-[22px]', h.week_count >= h.target_per_week && 'text-ok')}>{h.week_count}<span className="text-[13px] text-ink-3">/{h.target_per_week}</span></div></div>
              <div><div className="label">30 jours</div><div className="num mt-1 text-[22px]">{Math.round(h.rate_30d * 100)}<span className="text-[13px] text-ink-3"> %</span></div></div>
            </div>
            <div className="overflow-x-auto">
              <HabitCalendar checks={h.checks} color={h.color} today={today} days={119} onToggle={(date, done) => toggle.mutate({ id: h.id, date, done })} />
            </div>
            <div className="mt-2 text-[11px] text-ink-3">Clique sur un jour pour le cocher ou le décocher.</div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

// ─── Objectifs ───────────────────────────────────────────────────────────────

const AREA_LABEL: Record<string, string> = { career: 'Carrière', finance: 'Finances', health: 'Santé', learning: 'Apprentissage', personal: 'Personnel', relationships: 'Relations' };

function Goals() {
  const { data: goals = [] } = useApi<Goal[]>(['goals', 'all'], '/goals?all=1');
  const [editing, setEditing] = useState<Goal | null | 'new'>(null);
  const update = useAction(({ id, ...body }: { id: string; current_value?: number; status?: string }) => api(`/goals/${id}`, { method: 'PATCH', body }));
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Nouvel objectif</Button>
      </div>
      {goals.length === 0 && <Panel><EmptyState icon={<Target size={18} />} title="Aucun objectif" text="Un bon objectif est mesurable et daté. NEXUS t’aidera à le relier à tes projets." /></Panel>}
      <div className="grid gap-4 md:grid-cols-2">
        {goals.map((g) => (
          <Panel key={g.id} className={cx('p-5', g.status !== 'active' && 'opacity-60')}>
            <div className="mb-2 flex items-center gap-2">
              <Badge>{AREA_LABEL[g.area] ?? g.area}</Badge>
              {g.status === 'achieved' && <Badge tone="ok">Atteint</Badge>}
              {g.status === 'paused' && <Badge tone="warn">En pause</Badge>}
              <span className="flex-1" />
              <IconButton label="Modifier" onClick={() => setEditing(g)}><Pencil size={13} /></IconButton>
            </div>
            <div className="text-[16px] font-medium leading-snug">{g.title}</div>
            {g.description && <p className="mt-1 text-[13px] text-ink-3">{g.description}</p>}
            <div className="mt-4">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="num text-[13px] text-ink-2">{g.target_value !== null ? `${fmtNum(g.current_value, 2)} / ${fmtNum(g.target_value, 2)} ${g.metric_unit ?? ''}` : 'objectif qualitatif'}</span>
                <span className="num text-[13px]">{g.target_value !== null ? fmtPct(g.progress) : ''}</span>
              </div>
              <ProgressBar value={g.progress} color="var(--color-s4)" height={5} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {g.target_value !== null && g.status === 'active' && (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('v')); if (Number.isFinite(v)) update.mutate({ id: g.id, current_value: v }); e.currentTarget.reset(); }}>
                  <Input name="v" type="number" step="any" placeholder="Nouvelle valeur" className="!h-8 !w-[140px] text-[12.5px]" />
                  <Button size="sm" type="submit">Mettre à jour</Button>
                </form>
              )}
              <span className="flex-1" />
              {g.due_date && <span className="font-mono text-[11px] text-ink-3">échéance {fmtDue(g.due_date)?.text}</span>}
              {g.status === 'active' && <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: g.id, status: 'achieved' })}>Marquer atteint</Button>}
            </div>
            <div className="mt-3 font-mono text-[10.5px] text-ink-3">{g.project_count} projet(s) lié(s) · {g.open_tasks} tâche(s) ouverte(s)</div>
          </Panel>
        ))}
      </div>
      <GoalForm goal={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </div>
  );
}

function GoalForm({ goal, open, onClose }: { goal: Goal | null; open: boolean; onClose: () => void }) {
  const empty = { title: '', description: '', area: 'personal', metric_unit: '', start_value: '0', target_value: '', current_value: '0', due_date: '', status: 'active' };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (!open) return;
    setF(goal ? { title: goal.title, description: goal.description, area: goal.area, metric_unit: goal.metric_unit ?? '', start_value: String(goal.start_value), target_value: goal.target_value?.toString() ?? '', current_value: String(goal.current_value), due_date: goal.due_date ?? '', status: goal.status } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useAction(() => {
    const body = { ...f, metric_unit: f.metric_unit || null, start_value: Number(f.start_value) || 0, current_value: Number(f.current_value) || 0, target_value: f.target_value === '' ? null : Number(f.target_value), due_date: f.due_date || null };
    return goal ? api(`/goals/${goal.id}`, { method: 'PATCH', body }) : api('/goals', { body });
  }, { success: goal ? 'Objectif mis à jour' : 'Objectif créé' });
  const del = useAction(() => api(`/goals/${goal!.id}`, { method: 'DELETE' }), { success: 'Objectif supprimé' });
  return (
    <Modal open={open} onClose={onClose} title={goal ? 'Modifier l’objectif' : 'Nouvel objectif'} footer={
      <>
        {goal && <Button variant="danger" className="mr-auto" onClick={() => confirm('Supprimer cet objectif ?') && del.mutate(undefined, { onSuccess: onClose })}>Supprimer</Button>}
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="primary" disabled={!f.title.trim()} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Enregistrer</Button>
      </>
    }>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Titre" className="sm:col-span-2"><Input value={f.title} onChange={set('title')} placeholder="Ex. Courir un semi-marathon sous 2 h" /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={set('description')} /></Field>
        <Field label="Domaine"><Select value={f.area} onChange={set('area')}>{Object.entries(AREA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Échéance"><Input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        <Field label="Unité" hint="ex. €, km, articles"><Input value={f.metric_unit} onChange={set('metric_unit')} /></Field>
        <Field label="Valeur cible" hint="Vide = objectif qualitatif"><Input type="number" step="any" value={f.target_value} onChange={set('target_value')} /></Field>
        <Field label="Valeur de départ"><Input type="number" step="any" value={f.start_value} onChange={set('start_value')} /></Field>
        <Field label="Valeur actuelle"><Input type="number" step="any" value={f.current_value} onChange={set('current_value')} /></Field>
        {goal && <Field label="Statut"><Select value={f.status} onChange={set('status')}><option value="active">Actif</option><option value="achieved">Atteint</option><option value="paused">En pause</option><option value="abandoned">Abandonné</option></Select></Field>}
      </div>
    </Modal>
  );
}

// ─── Métriques ───────────────────────────────────────────────────────────────

function Metrics({ metrics }: { metrics: MetricWithEntries[] }) {
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: '', unit: '', target: '', direction: 'up', category: 'health' });
  const create = useAction(() => api('/metrics', { body: { ...f, target: f.target === '' ? null : Number(f.target) } }), { success: 'Métrique créée' });
  const addEntry = useAction(({ id, value, date }: { id: string; value: number; date: string }) => api(`/metrics/${id}/entries`, { body: { value, date } }));
  const del = useAction((id: string) => api(`/metrics/${id}`, { method: 'DELETE' }), { success: 'Métrique supprimée' });
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Nouvelle métrique</Button></div>
      {metrics.length === 0 && <Panel><EmptyState icon={<Gauge size={18} />} title="Aucune métrique" text="Suis ce que tu veux : sommeil, poids, heures de travail profond, humeur…" /></Panel>}
      <div className="grid gap-4 lg:grid-cols-2">
        {metrics.map((m) => {
          const avg = m.entries.length ? m.entries.reduce((s, e) => s + e.value, 0) / m.entries.length : null;
          return (
            <Panel key={m.id} className="p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium">{m.name}</div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="num text-[26px] leading-none">{m.last ? fmtNum(m.last.value, 2) : '—'}<span className="text-[13px] text-ink-3"> {m.unit}</span></span>
                    {avg !== null && <span className="text-[12px] text-ink-3">moy. 90 j : {fmtNum(avg, 1)}</span>}
                  </div>
                </div>
                <IconButton label="Supprimer la métrique" onClick={() => confirm(`Supprimer « ${m.name} » et son historique ?`) && del.mutate(m.id)}><Trash2 size={13} /></IconButton>
              </div>
              {m.entries.length > 1 ? (
                <LineChart
                  labels={m.entries.map((e) => fmtDate(e.date))}
                  series={[{ key: m.id, label: m.name, color: 'var(--color-s2)', values: m.entries.map((e) => e.value), area: true }]}
                  target={m.target !== null ? { value: m.target, label: `cible ${m.target} ${m.unit}` } : undefined}
                  format={(n) => fmtNum(n, 1)}
                  height={170}
                />
              ) : (
                <div className="py-8 text-center text-[12.5px] text-ink-3">Ajoute au moins deux valeurs pour voir la tendance.</div>
              )}
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const v = Number(fd.get('v')); if (fd.get('v') !== '' && Number.isFinite(v)) addEntry.mutate({ id: m.id, value: v, date: String(fd.get('d') || todayISO()) }); e.currentTarget.reset(); }}>
                <Input name="v" type="number" step="any" placeholder={`Valeur (${m.unit || 'nombre'})`} className="!h-8 min-w-0 flex-1 text-[12.5px]" />
                <Input name="d" type="date" defaultValue={todayISO()} className="!h-8 !w-[150px] text-[12.5px]" />
                <Button size="sm" type="submit">Ajouter</Button>
              </form>
            </Panel>
          );
        })}
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouvelle métrique" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Annuler</Button><Button variant="primary" disabled={!f.name.trim()} onClick={() => create.mutate(undefined, { onSuccess: () => (setCreating(false), setF({ name: '', unit: '', target: '', direction: 'up', category: 'health' })) })}>Créer</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex. Sommeil" /></Field>
          <Field label="Unité"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="h, kg, /10…" /></Field>
          <Field label="Cible (optionnel)"><Input type="number" step="any" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
          <Field label="Catégorie"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="health">Santé</option><option value="productivity">Productivité</option><option value="finance">Finances</option><option value="sport">Sport</option><option value="custom">Autre</option></Select></Field>
          <Field label="Sens"><Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="up">Plus c’est haut, mieux c’est</option><option value="down">Plus c’est bas, mieux c’est</option></Select></Field>
        </div>
      </Modal>
    </div>
  );
}
