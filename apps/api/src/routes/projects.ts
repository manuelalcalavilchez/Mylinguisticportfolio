import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Db } from '../db.js';
import { getOwnedGroup, getProjectAccess } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { HttpError, notFound } from '../lib/errors.js';
import {
  CURRENT_TEMPLATE_VERSION, DEFAULT_ACTIVITIES_V1, DEFAULT_RUBRIC_V1, computeProgress, rubricSchema,
  type PortfolioContent,
} from '../lib/template.js';
import { SECTIONS, SKILLS, uuidSchema, type Skill } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export async function createProject(c: pg.PoolClient, groupId: string, title: string, course: string) {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO projects (group_id, title, course, template_version, status, rubric)
     VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id`,
    [groupId, title, course, CURRENT_TEMPLATE_VERSION, JSON.stringify(DEFAULT_RUBRIC_V1)],
  );
  const id = rows[0]!.id;
  let order = 0;
  for (const a of DEFAULT_ACTIVITIES_V1) {
    await c.query(
      `INSERT INTO activities (project_id, section, title, instructions, sort_order, skill) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, a.section, a.title, a.instructions, order++, a.skill ?? null],
    );
  }
  return id;
}

const activityFields = z.object({
  section: z.enum(SECTIONS),
  title: z.string().trim().min(1).max(160),
  instructions: z.string().trim().max(3000),
  dueDate: z.iso.date().nullable().optional(),
  skill: z.enum(SKILLS).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
const activityBody = activityFields.extend({ instructions: z.string().trim().max(3000).default('') });
// Sin defaults en el PATCH (zod 4 los aplicaría dentro de .partial()).
const activityPatch = activityFields.partial();

export function projectsRouter(db: Db) {
  const r = Router();
  r.use(['/projects', '/activities', '/groups'], requireAuth);

  r.post('/groups/:groupId/projects', requireRole('teacher'), async (req, res) => {
    const g = await getOwnedGroup(db, req.user!, uuidSchema.parse(req.params.groupId));
    const { title } = z.object({ title: z.string().trim().min(1).max(160) }).parse(req.body);
    const id = await withTransaction(db, async (c) => {
      const pid = await createProject(c, g.id, title, g.course);
      await audit(c, req.user!.id, 'project.created', { type: 'project', id: pid });
      return pid;
    });
    res.status(201).json({ project: { id, title } });
  });

  r.get('/projects/:id', async (req, res) => {
    const { project: p, as } = await getProjectAccess(db, req.user!, uuidSchema.parse(req.params.id));
    const acts = await db.query(
      `SELECT id, section, title, instructions, sort_order AS "sortOrder",
              to_char(due_date, 'YYYY-MM-DD') AS "dueDate", skill
         FROM activities WHERE project_id = $1 ORDER BY section, sort_order, title`,
      [p.id],
    );
    let myPortfolioId: string | null = null;
    if (as === 'student') {
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM portfolios WHERE project_id = $1 AND student_id = $2',
        [p.id, req.user!.id],
      );
      myPortfolioId = rows[0]?.id ?? null;
    }
    res.json({
      project: {
        id: p.id, groupId: p.group_id, title: p.title, language: p.language, course: p.course,
        templateVersion: p.template_version, status: p.status, rubric: p.rubric,
      },
      activities: acts.rows,
      myPortfolioId,
      as,
    });
  });

  r.patch('/projects/:id', requireRole('teacher'), async (req, res) => {
    const { project: p, as } = await getProjectAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'teacher') throw notFound();
    const body = z
      .object({ title: z.string().trim().min(1).max(160).optional(), status: z.enum(['draft', 'active', 'closed']).optional() })
      .parse(req.body);
    await db.query('UPDATE projects SET title = COALESCE($2, title), status = COALESCE($3, status) WHERE id = $1', [
      p.id, body.title, body.status,
    ]);
    await audit(db, req.user!.id, 'project.updated', { type: 'project', id: p.id }, { status: body.status });
    res.status(204).end();
  });

  r.put('/projects/:id/rubric', requireRole('teacher'), async (req, res) => {
    const { project: p, as } = await getProjectAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'teacher') throw notFound();
    const rubric = rubricSchema.parse(req.body?.rubric);
    if (new Set(rubric.map((c) => c.id)).size !== rubric.length) {
      throw new HttpError(400, 'duplicate_criterion', 'Los identificadores de criterio deben ser únicos');
    }
    await db.query('UPDATE projects SET rubric = $2 WHERE id = $1', [p.id, JSON.stringify(rubric)]);
    await audit(db, req.user!.id, 'project.rubric_updated', { type: 'project', id: p.id });
    res.status(204).end();
  });

  r.post('/projects/:id/activities', requireRole('teacher'), async (req, res) => {
    const { project: p, as } = await getProjectAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'teacher') throw notFound();
    const b = activityBody.parse(req.body);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO activities (project_id, section, title, instructions, sort_order, due_date, skill)
       VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(max(sort_order), 0) + 1 FROM activities WHERE project_id = $1)), $6, $7)
       RETURNING id`,
      [p.id, b.section, b.title, b.instructions, b.sortOrder ?? null, b.dueDate ?? null, b.skill ?? null],
    );
    res.status(201).json({ activity: { id: rows[0]!.id } });
  });

  async function ownedActivity(teacherId: string, activityId: string) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT a.id FROM activities a JOIN projects p ON p.id = a.project_id JOIN groups g ON g.id = p.group_id
        WHERE a.id = $1 AND g.teacher_id = $2`,
      [activityId, teacherId],
    );
    if (!rows[0]) throw notFound();
    return rows[0].id;
  }

  r.patch('/activities/:id', requireRole('teacher'), async (req, res) => {
    const id = await ownedActivity(req.user!.id, uuidSchema.parse(req.params.id));
    const b = activityPatch.parse(req.body);
    await db.query(
      `UPDATE activities SET section = COALESCE($2, section), title = COALESCE($3, title),
              instructions = COALESCE($4, instructions), sort_order = COALESCE($5, sort_order),
              due_date = CASE WHEN $6::boolean THEN $7::date ELSE due_date END,
              skill = CASE WHEN $8::boolean THEN $9 ELSE skill END
        WHERE id = $1`,
      [id, b.section, b.title, b.instructions, b.sortOrder, b.dueDate !== undefined, b.dueDate ?? null, b.skill !== undefined, b.skill ?? null],
    );
    res.status(204).end();
  });

  r.delete('/activities/:id', requireRole('teacher'), async (req, res) => {
    const id = await ownedActivity(req.user!.id, uuidSchema.parse(req.params.id));
    await db.query('DELETE FROM activities WHERE id = $1', [id]);
    res.status(204).end();
  });

  // Progreso del grupo (profesor): orientativo, no certificación MCER.
  r.get('/projects/:id/progress', requireRole('teacher'), async (req, res) => {
    const { project: p, as } = await getProjectAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'teacher') throw notFound();
    const { rows } = await db.query<{
      student_id: string; display_name: string; login: string; portfolio_id: string | null; status: string | null;
      content: PortfolioContent | null; updated_at: Date | null; evidences: { skill: Skill; status: string }[] | null;
      pending_reviews: number;
    }>(
      `SELECT u.id AS student_id, u.display_name, u.login, pf.id AS portfolio_id, pf.status, pf.content, pf.updated_at,
              (SELECT json_agg(json_build_object('skill', e.skill, 'status', e.status)) FROM evidences e WHERE e.portfolio_id = pf.id) AS evidences,
              (SELECT count(*)::int FROM evidences e WHERE e.portfolio_id = pf.id AND e.status = 'submitted') AS pending_reviews
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN portfolios pf ON pf.student_id = u.id AND pf.project_id = $1
        WHERE m.group_id = $2 AND m.role = 'student' AND m.status = 'active'
        ORDER BY u.display_name`,
      [p.id, p.group_id],
    );
    const students = rows.map((r) => ({
      studentId: r.student_id,
      displayName: r.display_name,
      login: r.login,
      portfolioId: r.portfolio_id,
      status: r.status ?? 'not_started',
      updatedAt: r.updated_at,
      pendingReviews: r.pending_reviews,
      progress: computeProgress(r.content ?? {}, r.evidences ?? []),
    }));
    const avg = students.length ? Math.round(students.reduce((a, s) => a + s.progress.percent, 0) / students.length) : 0;
    res.json({ students, groupAverage: avg });
  });

  // El alumno abre (o crea) su portfolio para el proyecto.
  r.post('/projects/:id/my-portfolio', requireRole('student'), async (req, res) => {
    const { project: p } = await getProjectAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (p.status !== 'active') throw new HttpError(409, 'project_closed', 'El proyecto no está activo');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO portfolios (student_id, project_id, template_version) VALUES ($1, $2, $3)
       ON CONFLICT (student_id, project_id) DO UPDATE SET student_id = EXCLUDED.student_id
       RETURNING id`,
      [req.user!.id, p.id, p.template_version],
    );
    res.json({ portfolioId: rows[0]!.id });
  });

  return r;
}
