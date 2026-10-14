import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { hashPassword } from '../src/lib/password.js';

export const ORIGIN = 'http://localhost:5173';

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: ORIGIN,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://mlp:mlp_dev_password@localhost:5432/mlp_test',
    SESSION_SECRET: 'test-secret-test-secret-test-secret-0000',
    TEACHER_SIGNUP_CODE: 'piloto-2026',
    ...overrides,
  });
}

/** BD de test limpia: borra el esquema y vuelve a migrar. Nunca apuntar a una BD real. */
export async function freshDb(cfg: Config): Promise<Db> {
  if (!/_test\b|_test$/.test(new URL(cfg.DATABASE_URL).pathname)) {
    throw new Error('Por seguridad, las pruebas solo corren contra una base de datos cuyo nombre termina en _test');
  }
  const db = createPool(cfg.DATABASE_URL, 3);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  return db;
}

export async function createUser(db: Db, email: string, role: 'admin' | 'teacher' | 'student', password = 'contraseña-segura-1') {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, email.split('@')[0], await hashPassword(password), role],
  );
  return rows[0]!.id;
}

/** Cliente con cookie jar y cabecera Origin correcta. */
export function client(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('Origin', ORIGIN).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set('Origin', ORIGIN).send(body ?? {}),
    login: (email: string, password = 'contraseña-segura-1') =>
      agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password }),
  };
}
