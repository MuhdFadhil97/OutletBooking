import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError, z } from 'zod';
import { AppError } from '../errors';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof ZodError) {
    return c.json(
      { error: { code: 'validation_error', message: 'Invalid input', details: z.flattenError(err) } },
      400,
    );
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
  }
  console.error('[api] unhandled error', err);
  return c.json({ error: { code: 'internal_error', message: 'Something went wrong' } }, 500);
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404);
