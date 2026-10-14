/**
 * Crea (o promociona) el primer administrador.
 * Uso:  ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... npm run create-admin -w apps/api
 * En Docker:  docker compose exec app node dist/create-admin-cli.js  (con las mismas variables)
 * La contraseña se lee de variable de entorno para que no quede en el historial de la shell como argumento.
 */
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { hashPassword } from './lib/password.js';
import { audit } from './lib/audit.js';

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Faltan variables: DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD (ADMIN_NAME opcional)');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 12) {
  console.error('La contraseña del administrador debe tener al menos 12 caracteres');
  process.exit(1);
}
const db = createPool(DATABASE_URL, 1);
try {
  await migrate(db);
  const hash = await hashPassword(ADMIN_PASSWORD);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash, role)
     VALUES (lower($1), $2, $3, 'admin')
     ON CONFLICT ((lower(email))) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash, status = 'active'
     RETURNING id`,
    [ADMIN_EMAIL.trim(), ADMIN_NAME ?? 'Administrador', hash],
  );
  const id = rows[0]!.id;
  await audit(db, id, 'admin.bootstrap', { type: 'user', id });
  console.info(`Administrador listo: ${ADMIN_EMAIL}`);
} finally {
  await db.end();
}
