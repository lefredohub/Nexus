/**
 * Mini-moteur de gabarits pour les automatisations : `{{trigger.task.title}}`,
 * `{{steps.resume.output}}`, `{{today}}`, `{{now}}`.
 * Aucune évaluation de code : uniquement de la lecture de chemins.
 */
export type TemplateScope = Record<string, unknown>;

/** Marqueur utilisé en simulation : la sortie d'une étape non exécutée. */
export const SIMULATED = '__simulated__';

export function lookup(scope: TemplateScope, path: string): unknown {
  const keys = path.split('.');
  let acc: unknown = scope;
  for (const key of keys) {
    if (acc !== null && typeof acc === 'object' && SIMULATED in acc) return `‹${path}›`;
    // Uniquement les propriétés propres : pas d'accès à __proto__, constructor, etc.
    acc = acc !== null && typeof acc === 'object' && Object.hasOwn(acc, key) ? (acc as Record<string, unknown>)[key] : undefined;
  }
  if (acc !== null && typeof acc === 'object' && SIMULATED in acc) return `‹${path}›`;
  return acc;
}

const stringify = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));

export function render(template: string, scope: TemplateScope): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, path: string) => stringify(lookup(scope, path)));
}

/** Applique `render` à toutes les chaînes d'une configuration (récursif). */
export function renderDeep<T>(value: T, scope: TemplateScope): T {
  if (typeof value === 'string') return render(value, scope) as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, scope)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, scope)])) as T;
  return value;
}
