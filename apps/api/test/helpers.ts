import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { hashPassword } from '../src/lib/password.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'contraseña-segura-1';

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: ORIGIN,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://mlp:mlp_dev_password@localhost:5432/mlp_test',
    SESSION_SECRET: 'test-secret-test-secret-test-secret-0000',
    TEACHER_SIGNUP_CODE: 'piloto-2026',
    STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'mlp-test-')),
    MAX_UPLOAD_MB: '1',
    PUBLICATION_ENABLED: 'true',
    ...overrides,
  });
}

/** BD de test limpia: borra el esquema y vuelve a migrar. Nunca apuntar a una BD real. */
export async function freshDb(cfg: Config): Promise<Db> {
  if (!/_test$/.test(new URL(cfg.DATABASE_URL).pathname)) {
    throw new Error('Por seguridad, las pruebas solo corren contra una base de datos cuyo nombre termina en _test');
  }
  const db = createPool(cfg.DATABASE_URL, 3);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  return db;
}

export async function createUser(db: Db, login: string, role: 'admin' | 'teacher' | 'student', password = PASSWORD) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (login, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [login, login.split('@')[0], await hashPassword(password), role],
  );
  return rows[0]!.id;
}

export type App = ReturnType<typeof createApp>;
export type Client = ReturnType<typeof client>;

/** Cliente con cookie jar y cabecera Origin correcta. */
export function client(app: App) {
  const agent = request.agent(app);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('Origin', ORIGIN).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set('Origin', ORIGIN).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set('Origin', ORIGIN).send(body ?? {}),
    del: (url: string, body?: object) => agent.delete(url).set('Origin', ORIGIN).send(body ?? {}),
    upload: (url: string, buf: Buffer, filename = 'file.bin') =>
      agent.put(url).set('Origin', ORIGIN).attach('file', buf, filename),
    login: (login: string, password = PASSWORD) =>
      agent.post('/api/auth/login').set('Origin', ORIGIN).send({ login, password }),
  };
}

export async function truncateAll(db: Db) {
  await db.query('TRUNCATE users, sessions, password_resets, audit_events CASCADE');
}

/** Profesor con un grupo y su proyecto por defecto. */
export async function teacherWithGroup(app: App, db: Db, login = 'profe@centro.test', name = '4ºA') {
  await createUser(db, login, 'teacher');
  const teacher = client(app);
  expect((await teacher.login(login)).status).toBe(200);
  const res = await teacher.post('/api/groups', { name });
  expect(res.status).toBe(201);
  return { teacher, groupId: res.body.group.id as string, projectId: res.body.projectId as string };
}

export async function inviteCode(teacher: Client, groupId: string, opts: object = {}) {
  const res = await teacher.post(`/api/groups/${groupId}/invite`, opts);
  expect(res.status).toBe(201);
  return res.body.code as string;
}

export async function registerStudent(app: App, code: string, username: string) {
  const s = client(app);
  const res = await s.post('/api/auth/register-student', { inviteCode: code, username, displayName: username, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { student: s, id: res.body.user.id as string };
}

export async function openPortfolio(student: Client, projectId: string) {
  const res = await student.post(`/api/projects/${projectId}/my-portfolio`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.portfolioId as string;
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
