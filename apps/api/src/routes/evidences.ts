import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import {
  assertStudentCanEdit, getEvidenceAccess, getPortfolioAccess, publicEvidence, type EvidenceRow,
} from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { HttpError, notFound } from '../lib/errors.js';
import { UrlSigner } from '../lib/signing.js';
import type { Storage } from '../lib/storage.js';
import { SKILLS, safeUrlSchema, uuidSchema } from '../lib/validation.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const reflectionSchema = z
  .object({
    learned: z.string().max(2000),
    strengths: z.string().max(2000),
    difficulties: z.string().max(2000),
    improvement: z.string().max(2000),
  })
  .partial()
  .strict();

const evidenceFields = {
  title: z.string().trim().min(1).max(160),
  date: z.iso.date().nullable().optional(),
  language: z.string().trim().min(2).max(30),
  skill: z.enum(SKILLS),
  activityId: uuidSchema.nullable().optional(),
  externalUrl: safeUrlSchema.nullable().optional(),
  reflection: reflectionSchema,
};
const evidenceCreate = z.object({
  ...evidenceFields,
  language: evidenceFields.language.default('en'),
  reflection: reflectionSchema.default({}),
});
// Sin valores por defecto: en zod 4 un default dentro de .partial() se aplicaría y sobrescribiría datos.
const evidencePatch = z.object(evidenceFields).partial();

const EXT: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3',
  'audio/wav': 'wav', 'audio/ogg': 'ogg', 'video/webm': 'webm', 'video/mp4': 'mp4',
};
const FILE_LINK_TTL = 300;

/** Sirve un archivo privado con cabeceras defensivas (sandbox, nosniff, sin caché compartida). */
export async function sendStoredFile(res: Response, storage: Storage, key: string, mime: string, name: string) {
  if (!(await storage.exists(key))) throw notFound();
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="${name}.${EXT[mime] ?? 'bin'}"`);
  const stream = storage.open(key);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

export function evidencesRouter(db: Db, cfg: Config, storage: Storage) {
  const r = Router();
  const signer = new UrlSigner(cfg.SESSION_SECRET);
  const maxBytes = Math.round(cfg.MAX_UPLOAD_MB * 1024 * 1024);

  // Enlace temporal firmado: no necesita sesión, caduca a los 5 minutos.
  r.get('/files/:id', async (req, res) => {
    const id = uuidSchema.parse(req.params.id);
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
    if (!signer.verify(`evidence:${id}`, exp, sig)) throw new HttpError(403, 'link_expired', 'Enlace caducado o no válido');
    const { rows } = await db.query<{ private_storage_key: string | null; file_mime: string | null }>(
      'SELECT private_storage_key, file_mime FROM evidences WHERE id = $1',
      [id],
    );
    const e = rows[0];
    if (!e?.private_storage_key || !e.file_mime) throw notFound();
    await sendStoredFile(res, storage, e.private_storage_key, e.file_mime, `evidence-${id.slice(0, 8)}`);
  });

  // Solo estas rutas exigen sesión; el resto de /api sigue su camino (404 si no existe).
  r.use(['/evidences', '/portfolios'], requireAuth);

  async function ownedEditable(req: Parameters<typeof getEvidenceAccess>[1], id: string) {
    const a = await getEvidenceAccess(db, req, id);
    if (a.as !== 'owner') throw notFound();
    assertStudentCanEdit(a.portfolio);
    if (!['draft', 'returned'].includes(a.evidence.status)) {
      throw new HttpError(409, 'evidence_locked', 'La evidencia ya se ha entregado; espera la revisión del profesor');
    }
    return a;
  }

  async function checkActivity(projectId: string, activityId: string | null | undefined) {
    if (!activityId) return;
    const ok = await db.query('SELECT 1 FROM activities WHERE id = $1 AND project_id = $2', [activityId, projectId]);
    if (!ok.rowCount) throw new HttpError(400, 'invalid_activity', 'La actividad no pertenece a este proyecto');
  }

  r.post('/portfolios/:id/evidences', requireRole('student'), async (req, res) => {
    const { portfolio: p, as } = await getPortfolioAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'owner') throw notFound();
    assertStudentCanEdit(p);
    const b = evidenceCreate.parse(req.body);
    await checkActivity(p.project_id, b.activityId);
    const count = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM evidences WHERE portfolio_id = $1', [p.id]);
    if (count.rows[0]!.n >= 40) throw new HttpError(409, 'too_many_evidences', 'Máximo 40 evidencias por portfolio');
    const { rows } = await db.query<EvidenceRow>(
      `INSERT INTO evidences (portfolio_id, activity_id, title, evidence_date, language, skill, external_url, reflection)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, portfolio_id, activity_id, title, to_char(evidence_date, 'YYYY-MM-DD') AS evidence_date, language, skill,
                 external_url, private_storage_key, file_mime, file_size, reflection, status, created_at, updated_at`,
      [p.id, b.activityId ?? null, b.title, b.date ?? null, b.language, b.skill, b.externalUrl ?? null, JSON.stringify(b.reflection)],
    );
    res.status(201).json({ evidence: publicEvidence(rows[0]!) });
  });

  r.patch('/evidences/:id', requireRole('student'), async (req, res) => {
    const { evidence: e, portfolio: p } = await ownedEditable(req.user!, uuidSchema.parse(req.params.id));
    const b = evidencePatch.parse(req.body);
    await checkActivity(p.project_id, b.activityId);
    const has = (k: keyof typeof b) => Object.prototype.hasOwnProperty.call(b, k);
    await db.query(
      `UPDATE evidences SET
         title = COALESCE($2, title), language = COALESCE($3, language), skill = COALESCE($4, skill),
         evidence_date = CASE WHEN $5::boolean THEN $6::date ELSE evidence_date END,
         activity_id = CASE WHEN $7::boolean THEN $8::uuid ELSE activity_id END,
         external_url = CASE WHEN $9::boolean THEN $10 ELSE external_url END,
         reflection = COALESCE($11::jsonb, reflection), updated_at = now()
       WHERE id = $1`,
      [
        e.id, b.title, b.language, b.skill, has('date'), b.date ?? null, has('activityId'), b.activityId ?? null,
        has('externalUrl'), b.externalUrl ?? null, has('reflection') ? JSON.stringify(b.reflection) : null,
      ],
    );
    res.status(204).end();
  });

  r.delete('/evidences/:id', requireRole('student'), async (req, res) => {
    const { evidence: e } = await ownedEditable(req.user!, uuidSchema.parse(req.params.id));
    await db.query('DELETE FROM evidences WHERE id = $1', [e.id]);
    await storage.remove(e.private_storage_key);
    res.status(204).end();
  });

  r.put('/evidences/:id/file', requireRole('student'), async (req, res) => {
    const { evidence: e } = await ownedEditable(req.user!, uuidSchema.parse(req.params.id));
    const saved = await storage.receive(req, maxBytes);
    await db.query(
      `UPDATE evidences SET private_storage_key = $2, file_mime = $3, file_size = $4, updated_at = now() WHERE id = $1`,
      [e.id, saved.key, saved.mime, saved.size],
    );
    await storage.remove(e.private_storage_key);
    await audit(db, req.user!.id, 'evidence.file_uploaded', { type: 'evidence', id: e.id }, { mime: saved.mime, size: saved.size });
    res.json({ fileMime: saved.mime, fileSize: saved.size });
  });

  r.delete('/evidences/:id/file', requireRole('student'), async (req, res) => {
    const { evidence: e } = await ownedEditable(req.user!, uuidSchema.parse(req.params.id));
    await db.query('UPDATE evidences SET private_storage_key = NULL, file_mime = NULL, file_size = NULL, updated_at = now() WHERE id = $1', [e.id]);
    await storage.remove(e.private_storage_key);
    res.status(204).end();
  });

  // Descarga autenticada por sesión (propietario o su profesor).
  r.get('/evidences/:id/file', async (req, res) => {
    const { evidence: e } = await getEvidenceAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (!e.private_storage_key || !e.file_mime) throw notFound();
    await sendStoredFile(res, storage, e.private_storage_key, e.file_mime, `evidence-${e.id.slice(0, 8)}`);
  });

  r.post('/evidences/:id/file-link', async (req, res) => {
    const { evidence: e } = await getEvidenceAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (!e.private_storage_key) throw notFound();
    const { exp, sig } = signer.sign(`evidence:${e.id}`, FILE_LINK_TTL);
    res.json({ url: `/api/files/${e.id}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000) });
  });

  r.post('/evidences/:id/submit', requireRole('student'), async (req, res) => {
    const { evidence: e } = await ownedEditable(req.user!, uuidSchema.parse(req.params.id));
    const missing: string[] = [];
    if (!e.private_storage_key && !e.external_url) missing.push('archivo o enlace');
    if (!e.reflection.learned?.trim()) missing.push('qué has aprendido');
    if (!e.reflection.improvement?.trim()) missing.push('cómo mejorarás');
    if (missing.length) throw new HttpError(400, 'incomplete_evidence', `Falta: ${missing.join(', ')}`);
    await db.query(`UPDATE evidences SET status = 'submitted', updated_at = now() WHERE id = $1`, [e.id]);
    await audit(db, req.user!.id, 'evidence.submitted', { type: 'evidence', id: e.id });
    res.status(204).end();
  });

  r.post('/evidences/:id/review', requireRole('teacher'), async (req, res) => {
    const { evidence: e, portfolio: p, as } = await getEvidenceAccess(db, req.user!, uuidSchema.parse(req.params.id));
    if (as !== 'teacher') throw notFound();
    const b = z.object({ decision: z.enum(['accept', 'return']), feedback: z.string().trim().max(4000).default('') }).parse(req.body);
    if (b.decision === 'return' && !b.feedback) throw new HttpError(400, 'feedback_required', 'Indica qué debe mejorar');
    const upd = await db.query(
      `UPDATE evidences SET status = $2, updated_at = now() WHERE id = $1 AND status = 'submitted'`,
      [e.id, b.decision === 'accept' ? 'accepted' : 'returned'],
    );
    if (!upd.rowCount) throw new HttpError(409, 'invalid_transition', 'Solo se pueden revisar evidencias entregadas');
    await db.query(
      `INSERT INTO reviews (portfolio_id, evidence_id, teacher_id, kind, feedback) VALUES ($1, $2, $3, 'evidence_review', $4)`,
      [p.id, e.id, req.user!.id, b.feedback || (b.decision === 'accept' ? 'Accepted' : '')],
    );
    await audit(db, req.user!.id, `evidence.${b.decision}`, { type: 'evidence', id: e.id });
    res.status(204).end();
  });

  return r;
}
