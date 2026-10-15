import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import { withTransaction, type Db } from '../db.js';
import { getOwnedGroup } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { generateInviteCode, hashInviteCode, joinGroupWithCode } from '../lib/invites.js';
import { revokeAllForStudent } from '../lib/publication.js';
import { createResetLink } from '../lib/resets.js';
import { normalizeDesign } from '../lib/design.js';
import { computeProgress, type PortfolioContent } from '../lib/template.js';
import { uuidSchema, type Skill } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { authLimiter } from './auth.js';
import { createProject } from './projects.js';

const groupFields = z.object({
  name: z.string().trim().min(1).max(120),
  course: z.string().trim().min(1).max(40),
  description: z.string().trim().max(1000).optional(),
});
const groupBody = groupFields.extend({ course: z.string().trim().min(1).max(40).default('4.º ESO') });

export function groupsRouter(db: Db, cfg: Config) {
  const r = Router();
  r.use(requireAuth);

  /** Pertenencia de un alumno a un grupo del profesor autenticado (404 si no). */
  async function ownedMember(groupId: string, userId: string) {
    const { rows } = await db.query<{ user_id: string; status: string }>(
      `SELECT m.user_id, m.status FROM memberships m WHERE m.group_id = $1 AND m.user_id = $2 AND m.role = 'student'`,
      [groupId, userId],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  r.get('/', async (req, res) => {
    const u = req.user!;
    if (u.role === 'teacher') {
      const { rows } = await db.query(
        `SELECT g.id, g.name, g.course, g.description, g.status, g.created_at AS "createdAt",
                (SELECT count(*)::int FROM memberships m WHERE m.group_id = g.id AND m.status = 'active' AND m.role = 'student') AS "studentCount",
                (SELECT json_agg(json_build_object('id', p.id, 'title', p.title, 'status', p.status) ORDER BY p.created_at)
                   FROM projects p WHERE p.group_id = g.id) AS projects
           FROM groups g WHERE g.teacher_id = $1 ORDER BY g.created_at DESC`,
        [u.id],
      );
      return res.json({ groups: rows });
    }
    if (u.role === 'student') {
      const { rows } = await db.query(
        `SELECT g.id, g.name, g.course, t.display_name AS "teacherName",
                (SELECT json_agg(json_build_object('id', p.id, 'title', p.title, 'status', p.status) ORDER BY p.created_at)
                   FROM projects p WHERE p.group_id = g.id AND p.status <> 'draft') AS projects
           FROM memberships m JOIN groups g ON g.id = m.group_id JOIN users t ON t.id = g.teacher_id
          WHERE m.user_id = $1 AND m.status = 'active' AND g.status = 'active' ORDER BY m.joined_at`,
        [u.id],
      );
      // Resumen de cada portfolio propio (progreso y aspecto) para el panel del alumno.
      const ports = await db.query<{ id: string; project_id: string; status: string; content: PortfolioContent; design: unknown }>(
        'SELECT id, project_id, status, content, design FROM portfolios WHERE student_id = $1',
        [u.id],
      );
      const evs = await db.query<{ portfolio_id: string; skill: Skill; status: string }>(
        'SELECT e.portfolio_id, e.skill, e.status FROM evidences e JOIN portfolios p ON p.id = e.portfolio_id WHERE p.student_id = $1',
        [u.id],
      );
      const byProject = new Map(ports.rows.map((p) => {
        const d = normalizeDesign(p.design);
        return [p.project_id, {
          id: p.id,
          status: p.status,
          progress: computeProgress(p.content, evs.rows.filter((e) => e.portfolio_id === p.id)),
          look: { palette: d.palette, accent: d.accent, avatar: d.cover.avatar },
        }];
      }));
      for (const g of rows as { projects: { id: string; portfolio?: unknown }[] | null }[]) {
        for (const pr of g.projects ?? []) pr.portfolio = byProject.get(pr.id) ?? null;
      }
      return res.json({ groups: rows });
    }
    res.json({ groups: [] });
  });

  r.post('/', requireRole('teacher'), async (req, res) => {
    const body = groupBody.extend({ createProject: z.boolean().default(true) }).parse(req.body);
    const out = await withTransaction(db, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO groups (teacher_id, name, course, description) VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.user!.id, body.name, body.course, body.description ?? null],
      );
      const id = rows[0]!.id;
      await c.query(`INSERT INTO memberships (group_id, user_id, role) VALUES ($1, $2, 'teacher')`, [id, req.user!.id]);
      const projectId = body.createProject ? await createProject(c, id, 'My Linguistic Portfolio', body.course) : null;
      await audit(c, req.user!.id, 'group.created', { type: 'group', id });
      return { id, projectId };
    });
    res.status(201).json({ group: { id: out.id, name: body.name, course: body.course }, projectId: out.projectId });
  });

  // Unirse a otro grupo con un código (alumno ya registrado)
  r.post('/join', requireRole('student'), authLimiter(cfg), async (req, res) => {
    const { code } = z.object({ code: z.string().min(4).max(40) }).parse(req.body);
    const groupId = await withTransaction(db, (c) => joinGroupWithCode(c, req.user!.id, code));
    res.json({ groupId });
  });

  r.get('/:id', async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.id));
    const [invite, members, projects] = await Promise.all([
      db.query(
        `SELECT invite_code_hash IS NOT NULL AS active, invite_expires_at AS "expiresAt",
                invite_max_uses AS "maxUses", invite_uses AS uses,
                (invite_code_hash IS NOT NULL AND (invite_expires_at IS NULL OR invite_expires_at > now())
                  AND (invite_max_uses IS NULL OR invite_uses < invite_max_uses)) AS usable
           FROM groups WHERE id = $1`,
        [g.id],
      ),
      db.query(
        `SELECT u.id, u.login, u.display_name AS "displayName", m.status, m.joined_at AS "joinedAt",
                EXISTS (SELECT 1 FROM consents c WHERE c.subject_id = u.id AND c.purpose = 'public_publication'
                         AND c.status = 'granted' AND c.withdrawn_at IS NULL) AS "publicationConsent",
                (SELECT c.reference FROM consents c WHERE c.subject_id = u.id AND c.purpose = 'public_publication'
                  AND c.status = 'granted' AND c.withdrawn_at IS NULL ORDER BY c.captured_at DESC LIMIT 1) AS "consentReference"
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.group_id = $1 AND m.role = 'student' ORDER BY u.display_name`,
        [g.id],
      ),
      db.query(`SELECT id, title, status FROM projects WHERE group_id = $1 ORDER BY created_at`, [g.id]),
    ]);
    res.json({
      group: { id: g.id, name: g.name, course: g.course, description: g.description, status: g.status },
      invite: invite.rows[0],
      members: members.rows,
      projects: projects.rows,
    });
  });

  r.patch('/:id', async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.id));
    const body = groupFields.partial().extend({ status: z.enum(['active', 'archived']).optional() }).parse(req.body);
    await db.query(
      `UPDATE groups SET name = COALESCE($2, name), course = COALESCE($3, course),
              description = COALESCE($4, description), status = COALESCE($5, status), updated_at = now()
        WHERE id = $1`,
      [g.id, body.name, body.course, body.description, body.status],
    );
    if (body.status === 'archived') {
      await db.query('UPDATE groups SET invite_code_hash = NULL WHERE id = $1', [g.id]);
    }
    await audit(db, req.user!.id, 'group.updated', { type: 'group', id: g.id }, { status: body.status });
    res.status(204).end();
  });

  // Genera (o regenera) el código de invitación. Se muestra una única vez: en la BD solo queda su hash.
  r.post('/:id/invite', async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.id));
    const body = z
      .object({ expiresInDays: z.number().int().min(1).max(60).default(14), maxUses: z.number().int().min(1).max(200).default(40) })
      .parse(req.body ?? {});
    if (g.status !== 'active') throw notFound();
    const code = generateInviteCode();
    const { rows } = await db.query<{ invite_expires_at: Date }>(
      `UPDATE groups SET invite_code_hash = $2, invite_expires_at = now() + make_interval(days => $3),
              invite_max_uses = $4, invite_uses = 0, updated_at = now()
        WHERE id = $1 RETURNING invite_expires_at`,
      [g.id, hashInviteCode(code), body.expiresInDays, body.maxUses],
    );
    await audit(db, req.user!.id, 'group.invite_created', { type: 'group', id: g.id }, { maxUses: body.maxUses, expiresInDays: body.expiresInDays });
    res.status(201).json({ code, expiresAt: rows[0]!.invite_expires_at, maxUses: body.maxUses });
  });

  r.delete('/:id/invite', async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.id));
    await db.query('UPDATE groups SET invite_code_hash = NULL, updated_at = now() WHERE id = $1', [g.id]);
    await audit(db, req.user!.id, 'group.invite_revoked', { type: 'group', id: g.id });
    res.status(204).end();
  });

  r.patch('/:id/members/:userId', async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.id));
    const userId = uuidSchema.parse(req.params.userId);
    await ownedMember(g.id, userId);
    const { status } = z.object({ status: z.enum(['active', 'removed']) }).parse(req.body);
    await db.query('UPDATE memberships SET status = $3 WHERE group_id = $1 AND user_id = $2', [g.id, userId, status]);
    await audit(db, req.user!.id, 'group.member_status', { type: 'group', id: g.id }, { userId, status });
    res.status(204).end();
  });

  // El alumnado no tiene email: su profesor genera el enlace de recuperación.
  r.post('/:id/members/:userId/reset-link', async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.id));
    const userId = uuidSchema.parse(req.params.userId);
    const m = await ownedMember(g.id, userId);
    if (m.status !== 'active') throw notFound();
    res.status(201).json(await createResetLink(db, cfg.APP_ORIGIN, userId, req.user!.id));
  });

  // Registro de consentimiento (p. ej. autorización firmada por la familia). Guarda una referencia, no el documento.
  r.post('/:id/members/:userId/consents', async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.id));
    const userId = uuidSchema.parse(req.params.userId);
    const m = await ownedMember(g.id, userId);
    if (m.status !== 'active') throw notFound();
    const body = z
      .object({ purpose: z.enum(['public_publication', 'image_rights']), reference: z.string().trim().min(3).max(200) })
      .parse(req.body);
    await withTransaction(db, async (c) => {
      await c.query(
        `UPDATE consents SET status = 'withdrawn', withdrawn_at = now()
          WHERE subject_id = $1 AND purpose = $2 AND status = 'granted'`,
        [userId, body.purpose],
      );
      await c.query(
        `INSERT INTO consents (subject_id, purpose, status, reference, recorded_by) VALUES ($1, $2, 'granted', $3, $4)`,
        [userId, body.purpose, body.reference, req.user!.id],
      );
      await audit(c, req.user!.id, 'consent.granted', { type: 'user', id: userId }, { purpose: body.purpose });
    });
    res.status(201).json({ ok: true });
  });

  r.post('/:id/members/:userId/consents/withdraw', async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.id));
    const userId = uuidSchema.parse(req.params.userId);
    await ownedMember(g.id, userId);
    const { purpose } = z.object({ purpose: z.enum(['public_publication', 'image_rights']) }).parse(req.body);
    const revoked = await withTransaction(db, async (c) => {
      await c.query(
        `UPDATE consents SET status = 'withdrawn', withdrawn_at = now()
          WHERE subject_id = $1 AND purpose = $2 AND status = 'granted'`,
        [userId, purpose],
      );
      await audit(c, req.user!.id, 'consent.withdrawn', { type: 'user', id: userId }, { purpose });
      return purpose === 'public_publication' ? revokeAllForStudent(c, userId, req.user!.id) : 0;
    });
    res.json({ revokedPublications: revoked });
  });

  return r;
}
