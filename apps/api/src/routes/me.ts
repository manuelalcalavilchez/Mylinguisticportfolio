import { Router } from 'express';
import type { Db } from '../db.js';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';

/** Exportación de los datos propios (derecho de acceso/portabilidad). Archivos: solo metadatos. */
export function meRouter(db: Db) {
  const r = Router();
  r.use(requireAuth);

  r.get('/export', async (req, res) => {
    const id = req.user!.id;
    const [user, memberships, portfolios, evidences, reviews, consents, publications] = await Promise.all([
      db.query(`SELECT login, display_name AS "displayName", role, created_at AS "createdAt" FROM users WHERE id = $1`, [id]),
      db.query(
        `SELECT g.name AS "group", g.course, m.status, m.joined_at AS "joinedAt"
           FROM memberships m JOIN groups g ON g.id = m.group_id WHERE m.user_id = $1`,
        [id],
      ),
      db.query(
        `SELECT p.id, pr.title AS project, p.status, p.content, p.template_version AS "templateVersion", p.updated_at AS "updatedAt"
           FROM portfolios p JOIN projects pr ON pr.id = p.project_id WHERE p.student_id = $1`,
        [id],
      ),
      db.query(
        `SELECT e.id, e.portfolio_id AS "portfolioId", e.title, e.evidence_date AS date, e.language, e.skill,
                e.external_url AS "externalUrl", e.file_mime AS "fileMime", e.file_size AS "fileSize", e.reflection, e.status
           FROM evidences e JOIN portfolios p ON p.id = e.portfolio_id WHERE p.student_id = $1`,
        [id],
      ),
      db.query(
        `SELECT r.kind, r.section, r.feedback, r.rubric_result AS "rubricResult", r.created_at AS "createdAt"
           FROM reviews r JOIN portfolios p ON p.id = r.portfolio_id WHERE p.student_id = $1`,
        [id],
      ),
      db.query(`SELECT purpose, status, captured_at AS "capturedAt", withdrawn_at AS "withdrawnAt" FROM consents WHERE subject_id = $1`, [id]),
      db.query(
        `SELECT pb.slug, pb.published_at AS "publishedAt", pb.revoked_at AS "revokedAt"
           FROM publications pb JOIN portfolios p ON p.id = pb.portfolio_id WHERE p.student_id = $1`,
        [id],
      ),
    ]);
    await audit(db, id, 'user.data_exported', { type: 'user', id });
    res.setHeader('Content-Disposition', 'attachment; filename="my-linguistic-portfolio-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      user: user.rows[0],
      memberships: memberships.rows,
      portfolios: portfolios.rows,
      evidences: evidences.rows,
      reviews: reviews.rows,
      consents: consents.rows,
      publications: publications.rows,
      note: 'Los archivos de las evidencias se descargan desde cada evidencia en la aplicación.',
    });
  });

  return r;
}
