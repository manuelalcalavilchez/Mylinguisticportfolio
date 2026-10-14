import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import type { Db } from '../src/db.js';
import { client, createUser, freshDb, ORIGIN, testConfig } from './helpers.js';

const cfg = testConfig();
let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb(cfg);
  app = createApp(db, cfg);
});
afterAll(async () => db.end());
beforeEach(async () => {
  await db.query('TRUNCATE users, sessions, password_resets, audit_events CASCADE');
});

describe('infraestructura', () => {
  it('health check responde ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('las migraciones son idempotentes', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it('envía cabeceras de seguridad y noindex', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rutas API desconocidas devuelven 404 JSON', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('registro de profesores', () => {
  const body = { email: 'Profe@Centro.test', displayName: 'Profe', password: 'contraseña-segura-1', signupCode: 'piloto-2026' };

  it('registra con código válido, normaliza el email y abre sesión', async () => {
    const c = client(app);
    const res = await c.post('/api/auth/register-teacher', body);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ login: 'profe@centro.test', role: 'teacher' });
    const me = await c.get('/api/auth/me');
    expect(me.body.user.role).toBe('teacher');
  });

  it('rechaza código incorrecto', async () => {
    const res = await client(app).post('/api/auth/register-teacher', { ...body, signupCode: 'otro' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_signup_code');
  });

  it('no permite registro si TEACHER_SIGNUP_CODE está vacío', async () => {
    const closed = createApp(db, testConfig({ TEACHER_SIGNUP_CODE: '' }));
    const res = await client(closed).post('/api/auth/register-teacher', body);
    expect(res.status).toBe(403);
  });

  it('no revela si el email ya existe', async () => {
    await createUser(db, 'profe@centro.test', 'teacher');
    const res = await client(app).post('/api/auth/register-teacher', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('registration_failed');
  });

  it('valida la contraseña en servidor', async () => {
    const res = await client(app).post('/api/auth/register-teacher', { ...body, password: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

describe('login y sesiones', () => {
  it('login correcto crea cookie HttpOnly + SameSite=Strict y el token no se guarda en claro', async () => {
    await createUser(db, 'alumno@centro.test', 'student');
    const res = await client(app).login('alumno@centro.test');
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/mlp_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const token = cookie.match(/mlp_session=([^;]+)/)![1]!;
    // La BD solo contiene SHA-256(token): la fila existe buscando por hash, y la columna es bytea de 32 bytes.
    const { rows } = await db.query(`SELECT octet_length(token_hash) AS len FROM sessions WHERE token_hash = digest($1, 'sha256')`, [token]);
    expect(rows).toHaveLength(1);
    expect(rows[0].len).toBe(32);
  });

  it('credenciales incorrectas y email inexistente dan el mismo error', async () => {
    await createUser(db, 'alumno@centro.test', 'student');
    const a = await client(app).login('alumno@centro.test', 'mala-contraseña-x');
    const b = await client(app).login('nadie@centro.test', 'mala-contraseña-x');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('bloquea la cuenta tras 5 fallos aunque luego la contraseña sea correcta', async () => {
    await createUser(db, 'alumno@centro.test', 'student');
    for (let i = 0; i < 5; i++) await client(app).login('alumno@centro.test', 'mala-contraseña-x');
    const res = await client(app).login('alumno@centro.test');
    expect(res.status).toBe(401);
  });

  it('/me sin sesión devuelve 401', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('logout invalida la sesión en el servidor', async () => {
    await createUser(db, 'alumno@centro.test', 'student');
    const c = client(app);
    await c.login('alumno@centro.test');
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM sessions');
    expect(rows[0].n).toBe(0);
  });

  it('una sesión caducada no autentica', async () => {
    await createUser(db, 'alumno@centro.test', 'student');
    const c = client(app);
    await c.login('alumno@centro.test');
    await db.query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('cambiar contraseña cierra las demás sesiones', async () => {
    await createUser(db, 'alumno@centro.test', 'student');
    const a = client(app);
    const b = client(app);
    await a.login('alumno@centro.test');
    await b.login('alumno@centro.test');
    const res = await a.post('/api/auth/change-password', { currentPassword: 'contraseña-segura-1', newPassword: 'otra-contraseña-larga' });
    expect(res.status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
  });
});

describe('rate limit', () => {
  it('login: límite por IP+usuario, no por IP (aulas con IP compartida)', async () => {
    const prod = createApp(db, testConfig({ NODE_ENV: 'development' }));
    for (let i = 0; i < 20; i++) await client(prod).login('mismo@centro.test', 'x-incorrecta');
    const blocked = await client(prod).login('mismo@centro.test', 'x-incorrecta');
    expect(blocked.status).toBe(429);
    const other = await client(prod).login('otro@centro.test', 'x-incorrecta');
    expect(other.status).toBe(401);
  });
});

describe('protección CSRF', () => {
  it('rechaza peticiones mutantes sin Origin', async () => {
    const res = await request(app).post('/api/auth/login').send({ login: 'x@y.test', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bad_origin');
  });

  it('rechaza Origin ajeno', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.test').send({ login: 'x@y.test', password: 'x' });
    expect(res.status).toBe(403);
  });

  it('rechaza formularios url-encoded', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .type('form')
      .send('login=x@y.test&password=x');
    expect(res.status).toBe(415);
  });
});

describe('roles y administración', () => {
  it('profesor y alumno no acceden a /api/admin', async () => {
    await createUser(db, 'profe@centro.test', 'teacher');
    await createUser(db, 'alumno@centro.test', 'student');
    for (const email of ['profe@centro.test', 'alumno@centro.test']) {
      const c = client(app);
      await c.login(email);
      expect((await c.get('/api/admin/users')).status).toBe(403);
      expect((await c.post('/api/admin/users', { email: 'z@z.test', displayName: 'z', role: 'admin', password: 'contraseña-segura-1' })).status).toBe(403);
    }
  });

  it('anónimo recibe 401 en /api/admin', async () => {
    expect((await request(app).get('/api/admin/users')).status).toBe(401);
  });

  it('admin crea profesor, no puede crear alumnos directamente y la lista no expone hashes', async () => {
    await createUser(db, 'admin@centro.test', 'admin');
    const c = client(app);
    await c.login('admin@centro.test');
    const ok = await c.post('/api/admin/users', { email: 'nuevo@centro.test', displayName: 'Nuevo', role: 'teacher', password: 'contraseña-segura-1' });
    expect(ok.status).toBe(201);
    const bad = await c.post('/api/admin/users', { email: 'al@centro.test', displayName: 'Al', role: 'student', password: 'contraseña-segura-1' });
    expect(bad.status).toBe(400);
    const list = await c.get('/api/admin/users');
    expect(JSON.stringify(list.body)).not.toMatch(/scrypt|password/i);
    expect((await client(app).login('nuevo@centro.test')).status).toBe(200);
  });

  it('desactivar un usuario cierra sus sesiones e impide el login', async () => {
    await createUser(db, 'admin@centro.test', 'admin');
    const teacherId = await createUser(db, 'profe@centro.test', 'teacher');
    const admin = client(app);
    const teacher = client(app);
    await admin.login('admin@centro.test');
    await teacher.login('profe@centro.test');
    expect((await admin.patch(`/api/admin/users/${teacherId}`, { status: 'disabled' })).status).toBe(204);
    expect((await teacher.get('/api/auth/me')).status).toBe(401);
    expect((await client(app).login('profe@centro.test')).status).toBe(401);
  });

  it('enlace de recuperación: un solo uso, cierra sesiones y deja entrar con la nueva contraseña', async () => {
    await createUser(db, 'admin@centro.test', 'admin');
    const teacherId = await createUser(db, 'profe@centro.test', 'teacher');
    const admin = client(app);
    const teacher = client(app);
    await admin.login('admin@centro.test');
    await teacher.login('profe@centro.test');
    const link = await admin.post(`/api/admin/users/${teacherId}/reset-link`);
    expect(link.status).toBe(201);
    const token = new URL(link.body.resetUrl).hash.replace('#token=', '');

    const first = await client(app).post('/api/auth/password-reset', { token, password: 'nueva-contraseña-larga' });
    expect(first.status).toBe(204);
    const second = await client(app).post('/api/auth/password-reset', { token, password: 'otra-mas-larga-123' });
    expect(second.status).toBe(400);

    expect((await teacher.get('/api/auth/me')).status).toBe(401);
    expect((await client(app).login('profe@centro.test', 'nueva-contraseña-larga')).status).toBe(200);
  });

  it('enlace de recuperación caducado no sirve', async () => {
    await createUser(db, 'admin@centro.test', 'admin');
    const teacherId = await createUser(db, 'profe@centro.test', 'teacher');
    const admin = client(app);
    await admin.login('admin@centro.test');
    const link = await admin.post(`/api/admin/users/${teacherId}/reset-link`);
    await db.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute'`);
    const token = new URL(link.body.resetUrl).hash.replace('#token=', '');
    expect((await client(app).post('/api/auth/password-reset', { token, password: 'nueva-contraseña-larga' })).status).toBe(400);
  });

  it('las acciones sensibles quedan auditadas sin secretos', async () => {
    await createUser(db, 'admin@centro.test', 'admin');
    await client(app).login('admin@centro.test');
    await client(app).login('admin@centro.test', 'incorrecta-xxxxx');
    const { rows } = await db.query('SELECT action, metadata FROM audit_events ORDER BY id');
    expect(rows.map((r) => r.action)).toEqual(['auth.login', 'auth.login_failed']);
    expect(JSON.stringify(rows)).not.toMatch(/incorrecta|contraseña/);
  });
});

describe('CLI create-admin', () => {
  it('crea el admin y registra la auditoría', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('npx', ['tsx', new URL('../src/create-admin-cli.ts', import.meta.url).pathname], {
      env: { ...process.env, DATABASE_URL: cfg.DATABASE_URL, ADMIN_EMAIL: 'Jefe@Centro.test', ADMIN_PASSWORD: 'una-contraseña-admin-larga' },
      stdio: 'pipe',
    });
    const { rows } = await db.query(`SELECT u.login, u.role, a.action FROM users u JOIN audit_events a ON a.actor_id = u.id`);
    expect(rows).toEqual([{ login: 'jefe@centro.test', role: 'admin', action: 'admin.bootstrap' }]);
    expect((await client(app).login('jefe@centro.test', 'una-contraseña-admin-larga')).status).toBe(200);
  });
});

describe('configuración', () => {
  it('APP_ORIGIN admite varios orígenes: todos pasan el CSRF y la cookie Secure depende del origen', async () => {
    const multi = createApp(db, testConfig({ APP_ORIGIN: 'https://mylinguisticportfolio.es, http://192.168.1.134:8090' }));
    await createUser(db, 'alumno@centro.test', 'student');
    const https = await request(multi).post('/api/auth/login').set('Origin', 'https://mylinguisticportfolio.es')
      .send({ login: 'alumno@centro.test', password: 'contraseña-segura-1' });
    expect(https.status).toBe(200);
    expect(String(https.headers['set-cookie'])).toMatch(/Secure/);
    const lan = await request(multi).post('/api/auth/login').set('Origin', 'http://192.168.1.134:8090')
      .send({ login: 'alumno@centro.test', password: 'contraseña-segura-1' });
    expect(lan.status).toBe(200);
    expect(String(lan.headers['set-cookie'])).not.toMatch(/Secure/);
    const other = await request(multi).post('/api/auth/login').set('Origin', 'https://otro.test')
      .send({ login: 'alumno@centro.test', password: 'contraseña-segura-1' });
    expect(other.status).toBe(403);
  });

  it('rechaza orígenes no válidos y valores de ejemplo en producción', () => {
    expect(() => testConfig({ APP_ORIGIN: 'ftp://x.test' })).toThrow(/Origen no válido/);
    expect(() => testConfig({ NODE_ENV: 'production', SESSION_SECRET: '<64 caracteres hex: openssl rand -hex 32>' })).toThrow(/SESSION_SECRET/);
    expect(() => testConfig({ NODE_ENV: 'production', TEACHER_SIGNUP_CODE: '<código para que se registren>' })).toThrow(/TEACHER_SIGNUP_CODE/);
    expect(testConfig({ APP_ORIGIN: 'https://a.test/, https://b.test' }).APP_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
  });
});
