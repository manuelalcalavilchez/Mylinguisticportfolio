import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { requireRole } from '../middleware/auth.js';
import { displayNameSchema, emailSchema, passwordSchema } from './auth.js';

const RESET_TTL_MINUTES = 60;

export function adminRouter(db: Db, cfg: Config) {
  const r = Router();
  r.use(requireRole('admin'));

  r.get('/users', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT id, email, display_name AS "displayName", role, status, created_at AS "createdAt"
         FROM users ORDER BY created_at DESC LIMIT 500`,
    );
    res.json({ users: rows });
  });

  r.post('/users', async (req, res) => {
    const body = z
      .object({
        email: emailSchema,
        displayName: displayNameSchema,
        role: z.enum(['teacher', 'admin']),
        password: passwordSchema,
      })
      .parse(req.body);
    const ins = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [body.email, body.displayName, await hashPassword(body.password), body.role],
    );
    const id = ins.rows[0]?.id;
    if (!id) throw badRequest('email_taken', 'Ya existe una cuenta con ese email');
    await audit(db, req.user!.id, 'admin.user_created', { type: 'user', id }, { role: body.role });
    res.status(201).json({ user: { id, email: body.email, displayName: body.displayName, role: body.role } });
  });

  r.patch('/users/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = z.object({ status: z.enum(['active', 'disabled']) }).parse(req.body);
    if (id === req.user!.id) throw badRequest('cannot_modify_self', 'No puedes desactivar tu propia cuenta');
    const upd = await db.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [id, body.status]);
    if (!upd.rowCount) throw notFound();
    if (body.status === 'disabled') await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(db, req.user!.id, 'admin.user_status', { type: 'user', id }, { status: body.status });
    res.status(204).end();
  });

  // Recuperación de acceso sin SMTP: el admin genera un enlace de un solo uso y se lo entrega al usuario.
  r.post('/users/:id/reset-link', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const exists = await db.query('SELECT 1 FROM users WHERE id = $1', [id]);
    if (!exists.rowCount) throw notFound();
    const token = newToken();
    const { rows } = await db.query<{ expires_at: Date }>(
      `INSERT INTO password_resets (token_hash, user_id, created_by, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING expires_at`,
      [hashToken(token), id, req.user!.id, RESET_TTL_MINUTES],
    );
    await audit(db, req.user!.id, 'admin.reset_link_created', { type: 'user', id });
    res.status(201).json({
      resetUrl: `${new URL(cfg.APP_ORIGIN).origin}/reset-password#token=${token}`,
      expiresAt: rows[0]!.expires_at,
    });
  });

  return r;
}
