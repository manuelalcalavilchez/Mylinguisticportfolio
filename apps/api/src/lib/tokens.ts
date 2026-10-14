import { createHash, randomBytes } from 'node:crypto';

/** Token aleatorio de 256 bits en base64url. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** En la base de datos solo se guarda el hash: si se filtra la BD, los tokens no son reutilizables. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
