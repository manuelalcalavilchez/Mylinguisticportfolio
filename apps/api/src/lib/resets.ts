import type { Db } from '../db.js';
import { audit } from './audit.js';
import { hashToken, newToken } from './tokens.js';

const RESET_TTL_MINUTES = 60;

/** Enlace de recuperación de un solo uso. El token va en el fragmento (#) para no llegar a logs. */
export async function createResetLink(db: Db, appOrigin: string, userId: string, createdBy: string) {
  const token = newToken();
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO password_resets (token_hash, user_id, created_by, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING expires_at`,
    [hashToken(token), userId, createdBy, RESET_TTL_MINUTES],
  );
  await audit(db, createdBy, 'auth.reset_link_created', { type: 'user', id: userId });
  return { resetUrl: `${new URL(appOrigin).origin}/reset-password#token=${token}`, expiresAt: rows[0]!.expires_at };
}
