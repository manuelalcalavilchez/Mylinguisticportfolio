import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import { withTransaction, type Db } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, HttpError, unauthorized } from '../lib/errors.js';
import { getDummyHash, hashPassword, verifyPassword } from '../lib/password.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { requireAuth, SESSION_COOKIE } from '../middleware/auth.js';

export const emailSchema = z.email().max(254).transform((e) => e.trim().toLowerCase());
export const passwordSchema = z.string().min(10, 'Mínimo 10 caracteres').max(200);
export const displayNameSchema = z.string().trim().min(1).max(80);

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function authRouter(db: Db, cfg: Config) {
  const r = Router();
  const secureCookie = cfg.APP_ORIGIN.startsWith('https://');
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: cfg.NODE_ENV === 'test' ? 1000 : 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'too_many_requests', message: 'Demasiados intentos. Prueba más tarde.' },
  });

  async function startSession(res: Response, userId: string) {
    const token = newToken();
    await db.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(hours => $3))`,
      [hashToken(token), userId, cfg.SESSION_TTL_HOURS],
    );
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/',
      maxAge: cfg.SESSION_TTL_HOURS * 3600 * 1000,
    });
  }

  r.post('/register-teacher', limiter, async (req, res) => {
    const body = z
      .object({ email: emailSchema, displayName: displayNameSchema, password: passwordSchema, signupCode: z.string().max(200) })
      .parse(req.body);
    if (!cfg.TEACHER_SIGNUP_CODE) throw new HttpError(403, 'signup_disabled', 'El registro de profesores está desactivado');
    if (!safeEqual(body.signupCode, cfg.TEACHER_SIGNUP_CODE)) throw badRequest('invalid_signup_code', 'Código de registro no válido');
    const hash = await hashPassword(body.password);
    const ins = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, role) VALUES ($1, $2, $3, 'teacher')
       ON CONFLICT DO NOTHING RETURNING id`,
      [body.email, body.displayName, hash],
    );
    const id = ins.rows[0]?.id;
    // Mismo mensaje si el email ya existe para no confirmar qué cuentas hay.
    if (!id) throw badRequest('registration_failed', 'No se ha podido completar el registro');
    await audit(db, id, 'user.register_teacher', { type: 'user', id });
    await startSession(res, id);
    res.status(201).json({ user: { id, email: body.email, displayName: body.displayName, role: 'teacher' } });
  });

  r.post('/login', limiter, async (req, res) => {
    const body = z.object({ email: emailSchema, password: z.string().max(200) }).parse(req.body);
    const { rows } = await db.query<{
      id: string; email: string; display_name: string; role: string; password_hash: string;
      status: string; locked: boolean;
    }>(
      `SELECT id, email, display_name, role, password_hash, status,
              (locked_until IS NOT NULL AND locked_until > now()) AS locked
         FROM users WHERE lower(email) = $1`,
      [body.email],
    );
    const u = rows[0];
    const ok = await verifyPassword(body.password, u?.password_hash ?? (await getDummyHash()));
    if (!u || !ok || u.status !== 'active' || u.locked) {
      if (u && !ok) {
        await db.query(
          `UPDATE users SET failed_logins = failed_logins + 1,
             locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
           WHERE id = $1`,
          [u.id, MAX_FAILED, LOCK_MINUTES],
        );
        await audit(db, u.id, 'auth.login_failed', { type: 'user', id: u.id });
      }
      throw new HttpError(401, 'invalid_credentials', 'Email o contraseña incorrectos');
    }
    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()', [u.id]);
    await startSession(res, u.id);
    await audit(db, u.id, 'auth.login', { type: 'user', id: u.id });
    res.json({ user: { id: u.id, email: u.email, displayName: u.display_name, role: u.role } });
  });

  r.post('/logout', async (req, res) => {
    if (req.sessionTokenHash) await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionTokenHash]);
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: secureCookie, sameSite: 'strict' });
    res.status(204).end();
  });

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  r.post('/change-password', requireAuth, limiter, async (req, res) => {
    const body = z.object({ currentPassword: z.string().max(200), newPassword: passwordSchema }).parse(req.body);
    const user = req.user!;
    const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!rows[0] || !(await verifyPassword(body.currentPassword, rows[0].password_hash))) throw unauthorized();
    const hash = await hashPassword(body.newPassword);
    await withTransaction(db, async (c) => {
      await c.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, hash]);
      // Cierra el resto de sesiones del usuario.
      await c.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [user.id, req.sessionTokenHash]);
      await audit(c, user.id, 'auth.password_changed', { type: 'user', id: user.id });
    });
    res.status(204).end();
  });

  r.post('/password-reset', limiter, async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(100), password: passwordSchema }).parse(req.body);
    const hash = await hashPassword(body.password);
    const userId = await withTransaction(db, async (c) => {
      const { rows } = await c.query<{ user_id: string }>(
        `UPDATE password_resets SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [hashToken(body.token)],
      );
      const id = rows[0]?.user_id;
      if (!id) return null;
      await c.query(
        'UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
        [id, hash],
      );
      await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      await audit(c, id, 'auth.password_reset', { type: 'user', id });
      return id;
    });
    if (!userId) throw badRequest('invalid_token', 'El enlace no es válido o ha caducado');
    res.status(204).end();
  });

  return r;
}
