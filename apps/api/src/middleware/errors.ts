import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Datos no válidos',
      fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  // Log sin cuerpo de la petición ni cabeceras (pueden contener datos personales o tokens).
  console.error(`[error] ${req.method} ${req.path}:`, err instanceof Error ? err.stack : err);
  res.status(500).json({ error: 'internal_error', message: 'Error interno' });
}
