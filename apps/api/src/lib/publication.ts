import type pg from 'pg';
import type { Db } from '../db.js';
import { audit } from './audit.js';
import { HttpError } from './errors.js';
import type { PortfolioRow, PublicationRequest } from './access.js';
import { normalizeDesign, type Design } from './design.js';

type Q = Pick<pg.Pool, 'query'> | pg.PoolClient;

/**
 * Máquina de estados de publicación. Solo el backend decide qué transición es válida.
 *   private_draft ─request→ publication_requested ─approve→ approved ─publish→ published
 *   publication_requested / approved ─request_changes→ changes_requested ─request→ ...
 *   publication_requested ─cancel→ private_draft (o published si sigue viva una publicación anterior)
 *   cualquier estado con publicación activa ─revoke→ revoked
 */
export const TRANSITIONS = {
  request: ['private_draft', 'changes_requested', 'published', 'revoked'],
  cancel: ['publication_requested'],
  request_changes: ['publication_requested', 'approved'],
  approve: ['publication_requested'],
  publish: ['approved'],
} as const;

export function assertTransition(action: keyof typeof TRANSITIONS, status: string) {
  if (!(TRANSITIONS[action] as readonly string[]).includes(status)) {
    throw new HttpError(409, 'invalid_transition', `No se puede "${action}" desde el estado "${status}"`);
  }
}

export async function hasActiveConsent(db: Q, studentId: string, purpose = 'public_publication'): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM consents WHERE subject_id = $1 AND purpose = $2 AND status = 'granted' AND withdrawn_at IS NULL`,
    [studentId, purpose],
  );
  return !!rowCount;
}

export interface SnapshotEvidence {
  id: string;
  title: string;
  date: string | null;
  language: string;
  skill: string;
  externalUrl: string | null;
  reflection: Record<string, string>;
  fileMime: string | null;
}

export interface Snapshot {
  templateVersion: number;
  publicName: string;
  projectTitle: string;
  language: string;
  course: string;
  sections: Partial<PortfolioRow['content']>;
  evidences: SnapshotEvidence[];
  design: Design;
}

/** Construye la versión pública a partir de la selección del alumno. Solo evidencias aceptadas. */
export async function buildSnapshot(db: Q, p: PortfolioRow, reqSel: PublicationRequest) {
  const proj = (
    await db.query<{ title: string; language: string; course: string }>(
      'SELECT title, language, course FROM projects WHERE id = $1',
      [p.project_id],
    )
  ).rows[0]!;
  const sections: Snapshot['sections'] = {};
  for (const s of reqSel.sections) {
    const v = p.content[s];
    if (v) (sections as Record<string, unknown>)[s] = v;
  }
  const evRows = reqSel.evidenceIds.length
    ? (
        await db.query<{
          id: string; title: string; date: string | null; language: string; skill: string;
          external_url: string | null; reflection: Record<string, string>; file_mime: string | null;
          private_storage_key: string | null; status: string;
        }>(
          `SELECT id, title, to_char(evidence_date, 'YYYY-MM-DD') AS date, language, skill, external_url, reflection,
                  file_mime, private_storage_key, status
             FROM evidences WHERE portfolio_id = $1 AND id = ANY($2::uuid[]) ORDER BY evidence_date NULLS LAST, created_at`,
          [p.id, reqSel.evidenceIds],
        )
      ).rows
    : [];
  if (evRows.length !== reqSel.evidenceIds.length || evRows.some((e) => e.status !== 'accepted')) {
    throw new HttpError(409, 'evidence_not_accepted', 'Solo se pueden publicar evidencias aceptadas por el profesor');
  }
  const snapshot: Snapshot = {
    templateVersion: p.template_version,
    publicName: reqSel.publicName,
    projectTitle: proj.title,
    language: proj.language,
    course: proj.course,
    sections,
    design: normalizeDesign(p.design),
    evidences: evRows.map((e) => ({
      id: e.id, title: e.title, date: e.date, language: e.language, skill: e.skill,
      externalUrl: e.external_url, reflection: e.reflection, fileMime: e.private_storage_key ? e.file_mime : null,
    })),
  };
  // Claves de archivo: se guardan junto al snapshot pero nunca se envían al público.
  const files = Object.fromEntries(evRows.filter((e) => e.private_storage_key).map((e) => [e.id, e.private_storage_key!]));
  return { snapshot, files };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// Teléfonos de 9 cifras (formato español), con prefijo internacional opcional.
const PHONE_RE = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?[6789](?:[\s.-]?\d){8}(?!\d)/;

/**
 * Comprobación automática de privacidad (complementa, no sustituye, la revisión del profesor):
 * bloquea emails, teléfonos y el nombre de usuario del alumno en el contenido público.
 */
export function privacyIssues(snapshot: Snapshot, studentLogin: string): { path: string; issue: string }[] {
  const issues: { path: string; issue: string }[] = [];
  const login = studentLogin.toLowerCase();
  // Campos técnicos (identificadores, fechas, enums, URL) no son texto del alumno: no se analizan.
  const TECHNICAL = new Set(['id', 'date', 'skill', 'language', 'fileMime', 'externalUrl', 'relation', 'achieved']);
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      if (TECHNICAL.has(path.split('.').pop()!.replace(/\[\d+\]$/, ''))) return;
      if (EMAIL_RE.test(v)) issues.push({ path, issue: 'email' });
      else if (PHONE_RE.test(v)) issues.push({ path, issue: 'phone' });
      else if (login.length >= 3 && v.toLowerCase().includes(login)) issues.push({ path, issue: 'username' });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(
    { publicName: snapshot.publicName, sections: snapshot.sections, evidences: snapshot.evidences, design: { motto: snapshot.design?.cover.motto ?? '' } },
    '',
  );
  return issues;
}

/** Retira la publicación activa de un portfolio (si existe). */
export async function revokeActivePublication(db: Q, portfolioId: string, actorId: string | null, reason: string) {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE publications SET revoked_at = now(), revoked_by = $2
      WHERE portfolio_id = $1 AND revoked_at IS NULL RETURNING id`,
    [portfolioId, actorId],
  );
  if (!rows[0]) return false;
  await db.query(`UPDATE portfolios SET status = 'revoked', updated_at = now() WHERE id = $1 AND status = 'published'`, [portfolioId]);
  await audit(db, actorId, 'publication.revoked', { type: 'portfolio', id: portfolioId }, { publicationId: rows[0].id, reason });
  return true;
}

/** Al retirar el consentimiento se retiran todas las publicaciones del alumno. */
export async function revokeAllForStudent(db: Db | pg.PoolClient, studentId: string, actorId: string) {
  const { rows } = await db.query<{ portfolio_id: string }>(
    `SELECT pb.portfolio_id FROM publications pb JOIN portfolios p ON p.id = pb.portfolio_id
      WHERE p.student_id = $1 AND pb.revoked_at IS NULL`,
    [studentId],
  );
  for (const r of rows) await revokeActivePublication(db, r.portfolio_id, actorId, 'consent_withdrawn');
  return rows.length;
}
