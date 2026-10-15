import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { assertStudentCanEdit, getPortfolioAccess, publicEvidence, type EvidenceRow } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { designSchemaV1, normalizeDesign } from '../lib/design.js';
import { HttpError, notFound } from '../lib/errors.js';
import {
  CAN_DO_V1, computeProgress, sectionSchemasV1, type RubricCriterion,
} from '../lib/template.js';
import { SECTIONS, uuidSchema } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export function portfoliosRouter(db: Db) {
  const r = Router();
  r.use(requireAuth);

  r.get('/:id', async (req, res) => {
    const { portfolio: p, as } = await getPortfolioAccess(db, req.user!, uuidSchema.parse(req.params.id));
    const [student, project, activities, evidences, reviews, publication] = await Promise.all([
      db.query<{ display_name: string; login: string }>('SELECT display_name, login FROM users WHERE id = $1', [p.student_id]),
      db.query<{ title: string; status: string; rubric: RubricCriterion[] }>('SELECT title, status, rubric FROM projects WHERE id = $1', [p.project_id]),
      db.query(
        `SELECT id, section, title, instructions, to_char(due_date, 'YYYY-MM-DD') AS "dueDate", skill
           FROM activities WHERE project_id = $1 ORDER BY section, sort_order`,
        [p.project_id],
      ),
      db.query<EvidenceRow>(
        `SELECT id, portfolio_id, activity_id, title, to_char(evidence_date, 'YYYY-MM-DD') AS evidence_date, language, skill,
                external_url, private_storage_key, file_mime, file_size, reflection, status, created_at, updated_at
           FROM evidences WHERE portfolio_id = $1 ORDER BY created_at`,
        [p.id],
      ),
      db.query(
        `SELECT r.id, r.kind, r.section, r.evidence_id AS "evidenceId", r.feedback, r.rubric_result AS "rubricResult",
                r.status, r.created_at AS "createdAt", u.display_name AS "teacherName"
           FROM reviews r JOIN users u ON u.id = r.teacher_id
          WHERE r.portfolio_id = $1 ORDER BY r.created_at DESC`,
        [p.id],
      ),
      db.query(
        `SELECT slug, published_at AS "publishedAt", published_version AS "publishedVersion", allow_indexing AS "allowIndexing"
           FROM publications WHERE portfolio_id = $1 AND revoked_at IS NULL`,
        [p.id],
      ),
    ]);
    res.json({
      as,
      portfolio: {
        id: p.id,
        projectId: p.project_id,
        status: p.status,
        version: p.version,
        templateVersion: p.template_version,
        content: p.content,
        design: normalizeDesign(p.design),
        publicationRequest: p.publication_request,
        updatedAt: p.updated_at,
        editable: as === 'owner' && !!p.member_active && p.project_status === 'active'
          && ['private_draft', 'changes_requested', 'published', 'revoked'].includes(p.status),
      },
      student: { displayName: student.rows[0]?.display_name, ...(as === 'teacher' ? { login: student.rows[0]?.login } : {}) },
      project: { title: project.rows[0]?.title, status: project.rows[0]?.status, rubric: project.rows[0]?.rubric ?? [] },
      template: { canDo: CAN_DO_V1 },
      activities: activities.rows,
      evidences: evidences.rows.map(publicEvidence),
      reviews: reviews.rows,
      publication: publication.rows[0] ?? null,
      progress: computeProgress(p.content, evidences.rows),
    });
  });

  // Guardado de una sección con control optimista de concurrencia (version).
  r.put('/:id/sections/:section', requireRole('student'), async (req, res) => {
    const { portfolio: p, as } = await getPortfolioAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'owner') throw notFound();
    assertStudentCanEdit(p);
    const section = z.enum(SECTIONS).parse(req.params.section);
    const body = z.object({ version: z.number().int().positive(), data: z.unknown() }).parse(req.body);
    const data = sectionSchemasV1[section].parse(body.data);
    const { rows } = await db.query<{ version: number; updated_at: Date }>(
      `UPDATE portfolios SET content = jsonb_set(content, ARRAY[$2::text], $3::jsonb, true),
              version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $4 RETURNING version, updated_at`,
      [p.id, section, JSON.stringify(data), body.version],
    );
    if (!rows[0]) {
      throw new HttpError(409, 'version_conflict', 'El portfolio se ha modificado en otra pestaña o dispositivo. Recarga para continuar.');
    }
    res.json({ version: rows[0].version, updatedAt: rows[0].updated_at });
  });

  // Diseño visual elegido por el alumno (opciones cerradas). Comparte el control de versión con las secciones.
  r.put('/:id/design', requireRole('student'), async (req, res) => {
    const { portfolio: p, as } = await getPortfolioAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'owner') throw notFound();
    assertStudentCanEdit(p);
    const body = z.object({ version: z.number().int().positive(), design: designSchemaV1 }).parse(req.body);
    const { rows } = await db.query<{ version: number; updated_at: Date }>(
      `UPDATE portfolios SET design = $2::jsonb, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $3 RETURNING version, updated_at`,
      [p.id, JSON.stringify(body.design), body.version],
    );
    if (!rows[0]) {
      throw new HttpError(409, 'version_conflict', 'El portfolio se ha modificado en otra pestaña o dispositivo. Recarga para continuar.');
    }
    res.json({ version: rows[0].version, updatedAt: rows[0].updated_at, design: body.design });
  });

  // Comentario del profesor sobre el portfolio o una sección.
  r.post('/:id/comments', requireRole('teacher'), async (req, res) => {
    const { portfolio: p, as } = await getPortfolioAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'teacher') throw notFound();
    const b = z
      .object({ section: z.enum(SECTIONS).nullable().optional(), feedback: z.string().trim().min(1).max(4000) })
      .parse(req.body);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO reviews (portfolio_id, teacher_id, kind, section, feedback) VALUES ($1, $2, 'comment', $3, $4) RETURNING id`,
      [p.id, req.user!.id, b.section ?? null, b.feedback],
    );
    await audit(db, req.user!.id, 'review.comment', { type: 'portfolio', id: p.id });
    res.status(201).json({ review: { id: rows[0]!.id } });
  });

  // Evaluación con la rúbrica del proyecto (orientativa).
  r.post('/:id/assessment', requireRole('teacher'), async (req, res) => {
    const { portfolio: p, as } = await getPortfolioAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'teacher') throw notFound();
    const b = z
      .object({ scores: z.record(z.string(), z.number().int().min(0).max(10)), feedback: z.string().trim().max(4000).default('') })
      .parse(req.body);
    const rubric = (await db.query<{ rubric: RubricCriterion[] }>('SELECT rubric FROM projects WHERE id = $1', [p.project_id])).rows[0]!.rubric;
    for (const [id, score] of Object.entries(b.scores)) {
      const crit = rubric.find((c) => c.id === id);
      if (!crit || !crit.levels.some((l) => l.score === score)) {
        throw new HttpError(400, 'invalid_score', `Puntuación no válida para el criterio "${id}"`);
      }
    }
    const max = rubric.reduce((a, c) => a + Math.max(...c.levels.map((l) => l.score)), 0);
    const total = Object.values(b.scores).reduce((a, s) => a + s, 0);
    const result = { scores: b.scores, total, max, complete: Object.keys(b.scores).length === rubric.length };
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO reviews (portfolio_id, teacher_id, kind, feedback, rubric_result) VALUES ($1, $2, 'assessment', $3, $4) RETURNING id`,
      [p.id, req.user!.id, b.feedback, JSON.stringify(result)],
    );
    await audit(db, req.user!.id, 'review.assessment', { type: 'portfolio', id: p.id });
    res.status(201).json({ review: { id: rows[0]!.id, ...result } });
  });

  r.patch('/:id/reviews/:reviewId', async (req, res) => {
    const { portfolio: p } = await getPortfolioAccess(db, req.user!, uuidSchema.parse(req.params.id));
    const { status } = z.object({ status: z.enum(['open', 'resolved']) }).parse(req.body);
    const upd = await db.query('UPDATE reviews SET status = $3, updated_at = now() WHERE id = $1 AND portfolio_id = $2', [
      uuidSchema.parse(req.params.reviewId), p.id, status,
    ]);
    if (!upd.rowCount) throw notFound();
    res.status(204).end();
  });

  return r;
}
