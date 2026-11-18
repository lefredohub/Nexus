import { type DB, all } from '../db/client';

export interface SearchHit { kind: string; ref_id: string; title: string; snippet: string; rank: number }

/**
 * Transforme une saisie libre en requête FTS5 sûre : chaque mot devient un
 * préfixe entre guillemets (les caractères spéciaux FTS ne sont jamais interprétés).
 */
export function toFtsQuery(input: string, mode: 'AND' | 'OR' = 'AND'): string | null {
  const words = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 12);
  if (words.length === 0) return null;
  return words.map((w) => `"${w}"*`).join(` ${mode} `);
}

export function search(db: DB, query: string, opts: { kinds?: string[]; limit?: number } = {}): SearchHit[] {
  const limit = opts.limit ?? 20;
  const run = (mode: 'AND' | 'OR') => {
    const q = toFtsQuery(query, mode);
    if (!q) return [];
    const kindFilter = opts.kinds?.length ? `AND kind IN (${opts.kinds.map((_, i) => `:k${i}`).join(', ')})` : '';
    const params: Record<string, unknown> = { q, limit };
    opts.kinds?.forEach((k, i) => (params[`k${i}`] = k));
    return all<SearchHit>(
      db,
      `SELECT kind, ref_id, title, snippet(search_index, 3, '«', '»', '…', 18) AS snippet, bm25(search_index, 0, 0, 5, 1) AS rank
       FROM search_index WHERE search_index MATCH :q ${kindFilter} ORDER BY rank LIMIT :limit`,
      params,
    );
  };
  const strict = run('AND');
  return strict.length > 0 ? strict : run('OR');
}
