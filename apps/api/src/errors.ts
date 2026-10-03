import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Throw from routes/services; the error handler turns it into { error: { code, message } }. */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have access to this') => new AppError(403, 'forbidden', message);
export const unauthorized = () => new AppError(401, 'unauthorized', 'Please log in');

/** Postgres error helpers (postgres-js exposes `code` and `constraint_name`). */
export function pgErrorInfo(err: unknown): { code?: string; constraint?: string } {
  const e = (err as { cause?: unknown })?.cause ?? err;
  if (typeof e === 'object' && e !== null) {
    const rec = e as Record<string, unknown>;
    return {
      code: typeof rec.code === 'string' ? rec.code : undefined,
      constraint: typeof rec.constraint_name === 'string' ? rec.constraint_name : undefined,
    };
  }
  return {};
}
