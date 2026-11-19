/**
 * Client HTTP de l'interface. Toutes les requêtes passent par `api()` :
 * erreurs normalisées (ApiError), JSON systématique.
 */
import { QueryClient, useMutation, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from '../components/Toast';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // Appareil distant plus autorisé (révoqué) : on réaffiche l'écran d'appairage.
    if (res.status === 401 && data?.error?.code === 'unauthenticated') void queryClient.invalidateQueries({ queryKey: ['auth'] });
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Erreur ${res.status}`);
  }
  return data as T;
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});

/** Lecture : `useApi(['projects'], '/projects')`. */
export function useApi<T>(key: unknown[], path: string, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: key, queryFn: ({ signal }) => api<T>(path, { signal }), ...opts });
}

/**
 * Écriture : exécute l'action, rafraîchit toutes les données (une app perso
 * reste petite : c'est plus simple et plus sûr que des invalidations fines),
 * et affiche l'erreur éventuelle.
 */
export function useAction<A, R = unknown>(fn: (arg: A) => Promise<R>, opts: { success?: string | ((r: R) => string); silent?: boolean } = {}) {
  return useMutation<R, ApiError, A>({
    mutationFn: fn,
    onSuccess: (r) => {
      void queryClient.invalidateQueries();
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(r) : opts.success);
    },
    onError: (e) => {
      if (!opts.silent) toast(e.message, 'error');
    },
  });
}

export const refreshAll = () => queryClient.invalidateQueries();

/**
 * Lecture du flux SSE du chat (fetch + ReadableStream : EventSource ne permet pas le POST).
 */
export async function streamChat(body: { conversationId?: string | null; message: string; voice?: boolean }, onEvent: (e: import('./types').ChatEvent) => void, signal: AbortSignal) {
  const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Erreur ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data));
    }
  }
}

/** Requête POST dont la réponse est un flux SSE (ex. téléchargement d'un modèle). */
export async function postSSE(path: string, body: unknown, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal) {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Erreur ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = chunk.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) onEvent(event, JSON.parse(data));
    }
  }
}
