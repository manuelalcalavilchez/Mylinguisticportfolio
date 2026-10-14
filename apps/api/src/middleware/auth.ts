import type { NextFunction, Request, Response } from 'express';
import type { Db } from '../db.js';
import { hashToken } from '../lib/tokens.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export type Role = 'admin' | 'teacher' | 'student';
export interface SessionUser {
  id: string;
  login: string;
  displayName: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionTokenHash?: Buffer;
    }
  }
}

export const SESSION_COOKIE = 'mlp_session';

/** Carga el usuario de la sesión (si existe). No rechaza: eso lo hace requireAuth. */
export function loadSession(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return next();
    const tokenHash = hashToken(token);
    const { rows } = await db.query<{ id: string; login: string; display_name: string; role: Role }>(
      `SELECT u.id, u.login, u.display_name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
      [tokenHash],
    );
    const row = rows[0];
    if (row) {
      req.user = { id: row.id, login: row.login, displayName: row.display_name, role: row.role };
      req.sessionTokenHash = tokenHash;
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}
