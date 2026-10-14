import { createHash, randomInt } from 'node:crypto';
import type pg from 'pg';
import { HttpError } from './errors.js';
import { audit } from './audit.js';

// Sin caracteres ambiguos (0/O, 1/I/L): fáciles de dictar en clase.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 10; // 31^10 ≈ 8·10^14 combinaciones; además hay rate limit, caducidad y límite de usos.

export function generateInviteCode(): string {
  let s = '';
  for (let i = 0; i < LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashInviteCode(code: string): Buffer {
  return createHash('sha256').update(`invite:${normalizeInviteCode(code)}`).digest();
}

const invalid = () => new HttpError(400, 'invalid_invite', 'Código no válido, caducado o agotado');

/** Une a un alumno a un grupo mediante código. Debe ejecutarse dentro de una transacción. */
export async function joinGroupWithCode(c: pg.PoolClient, studentId: string, code: string): Promise<string> {
  const { rows } = await c.query<{ id: string; ok: boolean }>(
    `SELECT id,
            (status = 'active'
             AND (invite_expires_at IS NULL OR invite_expires_at > now())
             AND (invite_max_uses IS NULL OR invite_uses < invite_max_uses)) AS ok
       FROM groups WHERE invite_code_hash = $1 FOR UPDATE`,
    [hashInviteCode(code)],
  );
  const g = rows[0];
  if (!g || !g.ok) throw invalid();
  const existing = await c.query<{ status: string }>(
    'SELECT status FROM memberships WHERE group_id = $1 AND user_id = $2',
    [g.id, studentId],
  );
  if (existing.rows[0]?.status === 'active') return g.id;
  if (existing.rows[0]?.status === 'removed') {
    // Un alumno retirado no puede volver por su cuenta: lo reincorpora el profesor.
    throw new HttpError(403, 'membership_removed', 'Tu acceso a este grupo fue retirado. Habla con tu profesor.');
  }
  await c.query(`INSERT INTO memberships (group_id, user_id, role) VALUES ($1, $2, 'student')`, [g.id, studentId]);
  await c.query('UPDATE groups SET invite_uses = invite_uses + 1 WHERE id = $1', [g.id]);
  await audit(c, studentId, 'group.joined', { type: 'group', id: g.id });
  return g.id;
}
