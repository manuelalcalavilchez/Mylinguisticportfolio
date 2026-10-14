import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import { withTransaction, type Db } from '../db.js';
import { getPortfolioAccess, type PortfolioRow, type PublicationRequest } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { HttpError, notFound } from '../lib/errors.js';
import {
  assertTransition, buildSnapshot, hasActiveConsent, privacyIssues, revokeActivePublication, type Snapshot,
} from '../lib/publication.js';
import type { Storage } from '../lib/storage.js';
import { SECTIONS, uuidSchema } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { sendStoredFile } from './evidences.js';

const requestBody = z.object({
  sections: z.array(z.enum(SECTIONS)).min(1).max(4).transform((s) => [...new Set(s)]),
  evidenceIds: z.array(uuidSchema).max(40).default([]).transform((s) => [...new Set(s)]),
  // Nombre público: alias o nombre de pila. Nunca se usa automáticamente el nombre real.
  publicName: z.string().trim().min(2).max(40),
});

async function studentLogin(db: Db, p: PortfolioRow) {
  return (await db.query<{ login: string }>('SELECT login FROM users WHERE id = $1', [p.student_id])).rows[0]!.login;
}

/** Evalúa todas las condiciones previas a aprobar/publicar. Devuelve la lista de problemas. */
async function readiness(db: Db, cfg: Config, p: PortfolioRow) {
  const problems: { code: string; message: string; details?: unknown }[] = [];
  if (!p.publication_request) {
    return { problems: [{ code: 'no_request', message: 'No hay solicitud de publicación' }], snapshot: null, files: {} };
  }
  if (!(await hasActiveConsent(db, p.student_id))) {
    problems.push({ code: 'consent_missing', message: 'Falta registrar la autorización de publicación del alumno' });
  }
  let snapshot: Snapshot | null = null;
  let files: Record<string, string> = {};
  try {
    ({ snapshot, files } = await buildSnapshot(db, p, p.publication_request));
    const issues = privacyIssues(snapshot, await studentLogin(db, p));
    if (issues.length) {
      problems.push({ code: 'privacy_check_failed', message: 'El contenido incluye datos personales (email, teléfono o usuario)', details: issues });
    }
  } catch (err) {
    if (err instanceof HttpError) problems.push({ code: err.code, message: err.message });
    else throw err;
  }
  if (!cfg.PUBLICATION_ENABLED) {
    problems.push({ code: 'publication_disabled', message: 'La publicación pública está desactivada en este servidor' });
  }
  return { problems, snapshot, files };
}

export function publicationsRouter(db: Db, cfg: Config) {
  const r = Router();
  r.use(requireAuth);

  const access = async (req: Request, who: 'owner' | 'teacher' | 'any') => {
    const a = await getPortfolioAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (who !== 'any' && a.as !== who) throw notFound();
    return a;
  };

  r.post('/:id/publication/request', requireRole('student'), async (req, res) => {
    const { portfolio: p } = await access(req, 'owner');
    if (!p.member_active || p.project_status !== 'active') throw new HttpError(409, 'project_closed', 'El proyecto no está activo');
    assertTransition('request', p.status);
    const sel = requestBody.parse(req.body) as PublicationRequest;
    if (sel.evidenceIds.length) {
      const ok = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM evidences WHERE portfolio_id = $1 AND id = ANY($2::uuid[]) AND status = 'accepted'`,
        [p.id, sel.evidenceIds],
      );
      if (ok.rows[0]!.n !== sel.evidenceIds.length) {
        throw new HttpError(400, 'evidence_not_accepted', 'Solo puedes incluir evidencias aceptadas por tu profesor');
      }
    }
    await db.query(
      `UPDATE portfolios SET status = 'publication_requested', publication_request = $2, updated_at = now() WHERE id = $1`,
      [p.id, JSON.stringify(sel)],
    );
    await audit(db, req.user!.id, 'publication.requested', { type: 'portfolio', id: p.id }, { sections: sel.sections, evidences: sel.evidenceIds.length });
    res.status(204).end();
  });

  r.post('/:id/publication/cancel', requireRole('student'), async (req, res) => {
    const { portfolio: p } = await access(req, 'owner');
    assertTransition('cancel', p.status);
    await db.query(
      `UPDATE portfolios SET status = CASE WHEN EXISTS (SELECT 1 FROM publications WHERE portfolio_id = $1 AND revoked_at IS NULL)
                                       THEN 'published' ELSE 'private_draft' END, updated_at = now()
        WHERE id = $1`,
      [p.id],
    );
    await audit(db, req.user!.id, 'publication.request_cancelled', { type: 'portfolio', id: p.id });
    res.status(204).end();
  });

  // Vista previa exacta de lo que se publicaría + comprobaciones pendientes.
  r.get('/:id/publication/preview', async (req, res) => {
    const { portfolio: p } = await access(req, 'any');
    const { problems, snapshot } = await readiness(db, cfg, p);
    res.json({ snapshot, problems, request: p.publication_request, status: p.status });
  });

  r.post('/:id/publication/request-changes', requireRole('teacher'), async (req, res) => {
    const { portfolio: p } = await access(req, 'teacher');
    assertTransition('request_changes', p.status);
    const { feedback } = z.object({ feedback: z.string().trim().min(1).max(4000) }).parse(req.body);
    await withTransaction(db, async (c) => {
      await c.query(`UPDATE portfolios SET status = 'changes_requested', updated_at = now() WHERE id = $1`, [p.id]);
      await c.query(
        `INSERT INTO reviews (portfolio_id, teacher_id, kind, feedback) VALUES ($1, $2, 'publication', $3)`,
        [p.id, req.user!.id, feedback],
      );
      await audit(c, req.user!.id, 'publication.changes_requested', { type: 'portfolio', id: p.id });
    });
    res.status(204).end();
  });

  r.post('/:id/publication/approve', requireRole('teacher'), async (req, res) => {
    const { portfolio: p } = await access(req, 'teacher');
    assertTransition('approve', p.status);
    // La aprobación no exige el interruptor global (se puede aprobar y publicar más tarde).
    const { problems } = await readiness(db, cfg, p);
    const blocking = problems.filter((x) => x.code !== 'publication_disabled');
    if (blocking.length) throw new HttpError(409, 'not_ready', 'No se cumplen los requisitos de publicación', blocking);
    await db.query(`UPDATE portfolios SET status = 'approved', updated_at = now() WHERE id = $1`, [p.id]);
    await audit(db, req.user!.id, 'publication.approved', { type: 'portfolio', id: p.id });
    res.status(204).end();
  });

  r.post('/:id/publication/publish', requireRole('teacher'), async (req, res) => {
    const { portfolio: p } = await access(req, 'teacher');
    assertTransition('publish', p.status);
    const { allowIndexing } = z.object({ allowIndexing: z.boolean().default(false) }).parse(req.body ?? {});
    const { problems, snapshot, files } = await readiness(db, cfg, p);
    if (problems.length || !snapshot) {
      throw new HttpError(409, 'not_ready', problems[0]?.message ?? 'No se cumplen los requisitos', problems);
    }
    const slug = randomBytes(9).toString('base64url');
    await withTransaction(db, async (c) => {
      await revokeActivePublication(c, p.id, req.user!.id, 'replaced');
      await c.query(
        `INSERT INTO publications (portfolio_id, slug, snapshot, published_version, requested_by, approved_by, approved_at, allow_indexing)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
        [p.id, slug, JSON.stringify({ ...snapshot, _files: files }), p.version, p.student_id, req.user!.id, allowIndexing && cfg.ALLOW_PUBLIC_INDEXING],
      );
      await c.query(`UPDATE portfolios SET status = 'published', updated_at = now() WHERE id = $1`, [p.id]);
      await audit(c, req.user!.id, 'publication.published', { type: 'portfolio', id: p.id }, { slug });
    });
    res.status(201).json({ slug, url: `${new URL(cfg.APP_ORIGIN).origin}/p/${slug}` });
  });

  // Retirar: alumno propietario o su profesor. El portfolio privado no se toca.
  r.post('/:id/publication/revoke', async (req, res) => {
    const { portfolio: p } = await access(req, 'any');
    const done = await withTransaction(db, (c) => revokeActivePublication(c, p.id, req.user!.id, 'manual'));
    if (!done) throw new HttpError(409, 'not_published', 'No hay ninguna publicación activa');
    res.status(204).end();
  });

  return r;
}

/** Rutas públicas: solo leen la tabla publications (snapshot congelado), nunca los datos privados. */
export function publicRouter(db: Db, cfg: Config, storage: Storage) {
  const r = Router();
  r.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: cfg.NODE_ENV === 'test' ? 10_000 : 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  async function active(slug: string) {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(slug)) throw notFound();
    const { rows } = await db.query<{ snapshot: Snapshot & { _files?: Record<string, string> }; published_at: Date; allow_indexing: boolean }>(
      `SELECT snapshot, published_at, allow_indexing FROM publications WHERE slug = $1 AND revoked_at IS NULL`,
      [slug],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  r.get('/portfolios/:slug', async (req, res) => {
    const pub = await active(String(req.params.slug));
    const { _files, ...snapshot } = pub.snapshot;
    res.setHeader('Cache-Control', 'no-store');
    if (pub.allow_indexing && cfg.ALLOW_PUBLIC_INDEXING) res.removeHeader('X-Robots-Tag');
    res.json({
      portfolio: {
        ...snapshot,
        evidences: snapshot.evidences.map((e) => ({ ...e, hasFile: !!_files?.[e.id] })),
        publishedAt: pub.published_at,
      },
    });
  });

  r.get('/portfolios/:slug/files/:evidenceId', async (req, res) => {
    const pub = await active(String(req.params.slug));
    const evId = uuidSchema.parse(req.params.evidenceId);
    const key = pub.snapshot._files?.[evId];
    const ev = pub.snapshot.evidences.find((e) => e.id === evId);
    if (!key || !ev?.fileMime) throw notFound();
    await sendStoredFile(res, storage, key, ev.fileMime, `evidence-${evId.slice(0, 8)}`);
  });

  return r;
}
