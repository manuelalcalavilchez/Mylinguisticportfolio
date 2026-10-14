import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import { withTransaction, type Db } from '../db.js';
import { audit } from '../lib/audit.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { revokeActivePublication } from '../lib/publication.js';
import { createResetLink } from '../lib/resets.js';
import type { Storage } from '../lib/storage.js';
import { displayNameSchema, emailSchema, passwordSchema, uuidSchema } from '../lib/validation.js';
import { requireRole } from '../middleware/auth.js';

export function adminRouter(db: Db, cfg: Config, storage: Storage) {
  const r = Router();
  r.use(requireRole('admin'));

  r.get('/users', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT id, login, display_name AS "displayName", role, status, created_at AS "createdAt"
         FROM users ORDER BY role, created_at DESC LIMIT 1000`,
    );
    res.json({ users: rows });
  });

  r.post('/users', async (req, res) => {
    const body = z
      .object({ email: emailSchema, displayName: displayNameSchema, role: z.enum(['teacher', 'admin']), password: passwordSchema })
      .parse(req.body);
    const ins = await db.query<{ id: string }>(
      `INSERT INTO users (login, display_name, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [body.email, body.displayName, await hashPassword(body.password), body.role],
    );
    const id = ins.rows[0]?.id;
    if (!id) throw badRequest('email_taken', 'Ya existe una cuenta con ese email');
    await audit(db, req.user!.id, 'admin.user_created', { type: 'user', id }, { role: body.role });
    res.status(201).json({ user: { id, login: body.email, displayName: body.displayName, role: body.role } });
  });

  r.patch('/users/:id', async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const body = z.object({ status: z.enum(['active', 'disabled']) }).parse(req.body);
    if (id === req.user!.id) throw badRequest('cannot_modify_self', 'No puedes desactivar tu propia cuenta');
    const upd = await db.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [id, body.status]);
    if (!upd.rowCount) throw notFound();
    if (body.status === 'disabled') await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(db, req.user!.id, 'admin.user_status', { type: 'user', id }, { status: body.status });
    res.status(204).end();
  });

  r.post('/users/:id/reset-link', async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const exists = await db.query('SELECT 1 FROM users WHERE id = $1', [id]);
    if (!exists.rowCount) throw notFound();
    res.status(201).json(await createResetLink(db, cfg.APP_ORIGIN, id, req.user!.id));
  });

  /**
   * Borrado definitivo de una cuenta (derecho de supresión). Elimina portfolios, evidencias, archivos y
   * publicaciones del usuario. Exige escribir el identificador como confirmación.
   * Un profesor con grupos no se puede borrar: primero hay que reasignar o archivar.
   */
  r.delete('/users/:id', async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body ?? {});
    if (id === req.user!.id) throw badRequest('cannot_modify_self', 'No puedes borrar tu propia cuenta');
    const u = (await db.query<{ login: string; role: string }>('SELECT login, role FROM users WHERE id = $1', [id])).rows[0];
    if (!u) throw notFound();
    if (confirm.trim().toLowerCase() !== u.login.toLowerCase()) throw badRequest('confirmation_mismatch', 'La confirmación no coincide');
    const keys = await withTransaction(db, async (c) => {
      const owned = await c.query('SELECT 1 FROM groups WHERE teacher_id = $1 LIMIT 1', [id]);
      const reviewed = await c.query('SELECT 1 FROM reviews WHERE teacher_id = $1 LIMIT 1', [id]);
      if (owned.rowCount || reviewed.rowCount) {
        throw new HttpError(409, 'user_has_groups', 'Este profesor tiene grupos o revisiones; desactívalo en lugar de borrarlo');
      }
      const files = await c.query<{ k: string }>(
        `SELECT e.private_storage_key AS k FROM evidences e JOIN portfolios p ON p.id = e.portfolio_id
          WHERE p.student_id = $1 AND e.private_storage_key IS NOT NULL`,
        [id],
      );
      await c.query('DELETE FROM users WHERE id = $1', [id]);
      await audit(c, req.user!.id, 'admin.user_deleted', { type: 'user', id }, { role: u.role });
      return files.rows.map((f) => f.k);
    });
    for (const k of keys) await storage.remove(k);
    res.json({ deletedFiles: keys.length });
  });

  // Moderación: listado de publicaciones activas (sin contenido) y retirada.
  r.get('/publications', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT pb.id, pb.slug, pb.published_at AS "publishedAt", pb.snapshot->>'publicName' AS "publicName",
              g.name AS "groupName", t.display_name AS "teacherName"
         FROM publications pb JOIN portfolios p ON p.id = pb.portfolio_id
         JOIN projects pr ON pr.id = p.project_id JOIN groups g ON g.id = pr.group_id JOIN users t ON t.id = g.teacher_id
        WHERE pb.revoked_at IS NULL ORDER BY pb.published_at DESC`,
    );
    res.json({ publications: rows });
  });

  r.post('/publications/:id/revoke', async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const pf = await db.query<{ portfolio_id: string }>('SELECT portfolio_id FROM publications WHERE id = $1 AND revoked_at IS NULL', [id]);
    if (!pf.rows[0]) throw notFound();
    await withTransaction(db, (c) => revokeActivePublication(c, pf.rows[0]!.portfolio_id, req.user!.id, 'admin'));
    res.status(204).end();
  });

  return r;
}
