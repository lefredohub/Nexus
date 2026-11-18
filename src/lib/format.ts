const LOCALE = 'fr-FR';

export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + n));
}
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const fmtDate = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  iso ? parseISODate(iso).toLocaleDateString(LOCALE, opts) : '';

export function fmtDue(iso: string | null | undefined): { text: string; tone: 'late' | 'today' | 'soon' | 'later' } | null {
  if (!iso) return null;
  const diff = Math.round((parseISODate(iso).getTime() - parseISODate(todayISO()).getTime()) / 86_400_000);
  if (diff < 0) return { text: diff === -1 ? 'hier' : `${-diff} j de retard`, tone: 'late' };
  if (diff === 0) return { text: "aujourd'hui", tone: 'today' };
  if (diff === 1) return { text: 'demain', tone: 'soon' };
  if (diff < 7) return { text: `dans ${diff} j`, tone: 'soon' };
  return { text: fmtDate(iso), tone: 'later' };
}

export function relTime(isoDateTime: string): string {
  const diff = (Date.now() - new Date(isoDateTime).getTime()) / 1000;
  if (diff < 45) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`;
  if (diff < 86_400) return `il y a ${Math.round(diff / 3600)} h`;
  if (diff < 7 * 86_400) return `il y a ${Math.round(diff / 86_400)} j`;
  return new Date(isoDateTime).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

export const fmtNum = (n: number, digits = 0) => n.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const fmtMoney = (n: number, currency = 'EUR', digits = 0) =>
  n.toLocaleString(LOCALE, { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits });
export const fmtPct = (r: number) => `${Math.round(r * 100)} %`;
export const monthLabel = (ym: string) => parseISODate(`${ym}-01`).toLocaleDateString(LOCALE, { month: 'short' }).replace('.', '');

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Bonne nuit';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
