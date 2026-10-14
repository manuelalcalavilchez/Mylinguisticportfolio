import type { Db } from '../db.js';
import type { SessionUser } from '../middleware/auth.js';
import { forbidden, HttpError, notFound } from './errors.js';
import type { PortfolioContent } from './template.js';
import type { Skill } from './validation.js';

/**
 * Reglas de acceso centralizadas. Cualquier recurso ajeno responde 404 (no se revela su existencia).
 *  - Profesor: solo sus grupos, y solo alumnado con pertenencia ACTIVA en ellos.
 *  - Alumno: solo lo suyo.
 *  - Admin: gestiona cuentas, pero no lee portfolios (minimización).
 */

export interface GroupRow {
  id: string;
  teacher_id: string;
  name: string;
  course: string;
  description: string | null;
  status: string;
}

export async function getOwnedGroup(db: Db, user: SessionUser, groupId: string): Promise<GroupRow> {
  if (user.role !== 'teacher') throw notFound();
  const { rows } = await db.query<GroupRow>(
    'SELECT id, teacher_id, name, course, description, status FROM groups WHERE id = $1 AND teacher_id = $2',
    [groupId, user.id],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

export interface ProjectRow {
  id: string;
  group_id: string;
  title: string;
  language: string;
  course: string;
  template_version: number;
  status: string;
  rubric: unknown;
  teacher_id: string;
}

export async function getProjectAccess(db: Db, user: SessionUser, projectId: string) {
  const { rows } = await db.query<ProjectRow & { member_active: boolean | null }>(
    `SELECT pr.id, pr.group_id, pr.title, pr.language, pr.course, pr.template_version, pr.status, pr.rubric,
            g.teacher_id, (m.status = 'active') AS member_active
       FROM projects pr JOIN groups g ON g.id = pr.group_id
       LEFT JOIN memberships m ON m.group_id = g.id AND m.user_id = $2
      WHERE pr.id = $1`,
    [projectId, user.id],
  );
  const p = rows[0];
  if (!p) throw notFound();
  if (user.role === 'teacher' && p.teacher_id === user.id) return { project: p, as: 'teacher' as const };
  // El alumnado solo ve proyectos activos o cerrados (no borradores) de grupos donde está activo.
  if (user.role === 'student' && p.member_active && p.status !== 'draft') return { project: p, as: 'student' as const };
  throw notFound();
}

export interface PortfolioRow {
  id: string;
  student_id: string;
  project_id: string;
  status: string;
  content: PortfolioContent;
  version: number;
  template_version: number;
  publication_request: PublicationRequest | null;
  updated_at: Date;
  project_status: string;
  group_id: string;
  teacher_id: string;
  member_active: boolean | null;
}

export interface PublicationRequest {
  sections: ('home' | 'passport' | 'biography' | 'dossier')[];
  evidenceIds: string[];
  publicName: string;
}

export async function getPortfolioAccess(db: Db, user: SessionUser, portfolioId: string) {
  const { rows } = await db.query<PortfolioRow>(
    `SELECT p.id, p.student_id, p.project_id, p.status, p.content, p.version, p.template_version,
            p.publication_request, p.updated_at,
            pr.status AS project_status, pr.group_id, g.teacher_id, (m.status = 'active') AS member_active
       FROM portfolios p
       JOIN projects pr ON pr.id = p.project_id
       JOIN groups g ON g.id = pr.group_id
       LEFT JOIN memberships m ON m.group_id = g.id AND m.user_id = p.student_id
      WHERE p.id = $1`,
    [portfolioId],
  );
  const p = rows[0];
  if (!p) throw notFound();
  if (user.role === 'student' && p.student_id === user.id) return { portfolio: p, as: 'owner' as const };
  if (user.role === 'teacher' && p.teacher_id === user.id && p.member_active) return { portfolio: p, as: 'teacher' as const };
  throw notFound();
}

/** Estados en los que el alumno puede editar (durante la revisión de publicación el contenido queda bloqueado). */
export const EDITABLE_STATUSES = new Set(['private_draft', 'changes_requested', 'published', 'revoked']);

class LockedError extends HttpError {
  constructor(code: string, msg: string) {
    super(409, code, msg);
  }
}

export function assertStudentCanEdit(p: PortfolioRow) {
  if (!p.member_active) throw forbidden();
  if (p.project_status !== 'active') throw new LockedError('project_closed', 'El proyecto no está activo');
  if (!EDITABLE_STATUSES.has(p.status)) {
    throw new LockedError('portfolio_locked', 'El portfolio está en revisión de publicación. Cancela la solicitud para editar.');
  }
}


export interface EvidenceRow {
  id: string;
  portfolio_id: string;
  activity_id: string | null;
  title: string;
  evidence_date: string | null;
  language: string;
  skill: Skill;
  external_url: string | null;
  private_storage_key: string | null;
  file_mime: string | null;
  file_size: number | null;
  reflection: Record<string, string>;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export async function getEvidenceAccess(db: Db, user: SessionUser, evidenceId: string) {
  const { rows } = await db.query<EvidenceRow>(
    `SELECT id, portfolio_id, activity_id, title, to_char(evidence_date, 'YYYY-MM-DD') AS evidence_date, language, skill,
            external_url, private_storage_key, file_mime, file_size, reflection, status, created_at, updated_at
       FROM evidences WHERE id = $1`,
    [evidenceId],
  );
  const e = rows[0];
  if (!e) throw notFound();
  const access = await getPortfolioAccess(db, user, e.portfolio_id); // lanza 404 si no hay acceso
  return { evidence: e, ...access };
}

export function publicEvidence(e: EvidenceRow) {
  return {
    id: e.id,
    activityId: e.activity_id,
    title: e.title,
    date: e.evidence_date,
    language: e.language,
    skill: e.skill,
    externalUrl: e.external_url,
    hasFile: !!e.private_storage_key,
    fileMime: e.file_mime,
    fileSize: e.file_size,
    reflection: e.reflection,
    status: e.status,
    updatedAt: e.updated_at,
  };
}
