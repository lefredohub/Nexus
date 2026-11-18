/** Erreur « métier » renvoyée proprement au client avec un code HTTP. */
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} introuvable`);
