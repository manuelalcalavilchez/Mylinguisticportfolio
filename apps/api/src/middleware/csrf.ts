import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defensa CSRF para la API con cookie de sesión:
 *  1. La cookie es SameSite=Strict.
 *  2. Las peticiones que modifican estado deben llevar Origin igual a APP_ORIGIN
 *     (o, si el navegador no envía Origin, Sec-Fetch-Site: same-origin).
 *  3. Deben ser JSON (un formulario HTML de otro sitio no puede enviar application/json sin preflight).
 */
export function csrfGuard(appOrigin: string) {
  const allowed = new URL(appOrigin).origin;
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    const originOk = origin ? origin === allowed : fetchSite === 'same-origin';
    if (!originOk) return next(new HttpError(403, 'bad_origin', 'Origen no permitido'));
    const hasBody = Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding') !== undefined;
    if (hasBody && !req.is(['application/json', 'multipart/form-data'])) {
      return next(new HttpError(415, 'unsupported_media_type', 'Se esperaba JSON'));
    }
    next();
  };
}
