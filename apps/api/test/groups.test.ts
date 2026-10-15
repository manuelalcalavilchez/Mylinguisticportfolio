import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import {
  client, createUser, freshDb, inviteCode, registerStudent, teacherWithGroup, testConfig, truncateAll, PASSWORD,
  type App,
} from './helpers.js';

const cfg = testConfig();
let db: Db;
let app: App;

beforeAll(async () => {
  db = await freshDb(cfg);
  app = createApp(db, cfg);
});
afterAll(async () => db.end());
beforeEach(async () => truncateAll(db));

describe('grupos e invitaciones', () => {
  it('el profesor crea un grupo con proyecto y actividades por defecto', async () => {
    const { teacher, groupId, projectId } = await teacherWithGroup(app, db);
    const g = await teacher.get(`/api/groups/${groupId}`);
    expect(g.status).toBe(200);
    expect(g.body.projects).toHaveLength(1);
    const p = await teacher.get(`/api/projects/${projectId}`);
    expect(p.body.activities.length).toBe(9);
    expect(p.body.project.rubric.length).toBeGreaterThan(0);
  });

  it('el alumno se registra con código, sin email, y ve su grupo', async () => {
    const { teacher, groupId } = await teacherWithGroup(app, db);
    const code = await inviteCode(teacher, groupId);
    const { student } = await registerStudent(app, code.toLowerCase().replace('-', ' '), 'lucia.g');
    const groups = await student.get('/api/groups');
    expect(groups.body.groups.map((g: { id: string }) => g.id)).toEqual([groupId]);
    // Antes de abrirlo no hay portfolio; después el panel muestra su progreso y aspecto
    const projectId = groups.body.groups[0].projects[0].id;
    expect(groups.body.groups[0].projects[0].portfolio).toBeNull();
    const pid = (await student.post(`/api/projects/${projectId}/my-portfolio`)).body.portfolioId;
    const again = (await student.get('/api/groups')).body.groups[0].projects[0].portfolio;
    expect(again).toMatchObject({ id: pid, status: 'private_draft', progress: { percent: 0 }, look: { palette: 'ocean', avatar: '' } });
    const members = await teacher.get(`/api/groups/${groupId}`);
    expect(members.body.members.map((m: { login: string }) => m.login)).toEqual(['lucia.g']);
  });

  it('el código solo se guarda como hash', async () => {
    const { teacher, groupId } = await teacherWithGroup(app, db);
    const code = await inviteCode(teacher, groupId);
    const { rows } = await db.query(`SELECT invite_code_hash::text AS h FROM groups`);
    expect(rows[0].h).not.toContain(code.replace('-', ''));
  });

  it('código incorrecto: no se crea el usuario', async () => {
    const s = client(app);
    const res = await s.post('/api/auth/register-student', { inviteCode: 'AAAAA-BBBBB', username: 'pepe', displayName: 'Pepe', password: PASSWORD });
    expect(res.status).toBe(400);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE login = 'pepe'`);
    expect(rows[0].n).toBe(0);
  });

  it('código caducado, agotado o revocado no sirve', async () => {
    const { teacher, groupId } = await teacherWithGroup(app, db);
    const one = await inviteCode(teacher, groupId, { maxUses: 1 });
    await registerStudent(app, one, 'primero');
    const second = await client(app).post('/api/auth/register-student', { inviteCode: one, username: 'segundo', displayName: 'S', password: PASSWORD });
    expect(second.status).toBe(400);

    const exp = await inviteCode(teacher, groupId);
    await db.query(`UPDATE groups SET invite_expires_at = now() - interval '1 minute'`);
    expect((await client(app).post('/api/auth/register-student', { inviteCode: exp, username: 'tercero', displayName: 'T', password: PASSWORD })).status).toBe(400);

    const rev = await inviteCode(teacher, groupId);
    expect((await teacher.del(`/api/groups/${groupId}/invite`)).status).toBe(204);
    expect((await client(app).post('/api/auth/register-student', { inviteCode: rev, username: 'cuarto', displayName: 'C', password: PASSWORD })).status).toBe(400);
  });

  it('un alumno retirado pierde el acceso y no puede volver con el código', async () => {
    const { teacher, groupId, projectId } = await teacherWithGroup(app, db);
    const code = await inviteCode(teacher, groupId);
    const { student, id } = await registerStudent(app, code, 'mario');
    expect((await teacher.patch(`/api/groups/${groupId}/members/${id}`, { status: 'removed' })).status).toBe(204);
    expect((await student.get(`/api/projects/${projectId}`)).status).toBe(404);
    const rejoin = await student.post('/api/groups/join', { code });
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error).toBe('membership_removed');
  });

  it('un alumno existente se une a un segundo grupo', async () => {
    const a = await teacherWithGroup(app, db, 'a@centro.test', 'A');
    const b = await teacherWithGroup(app, db, 'b@centro.test', 'B');
    const { student } = await registerStudent(app, await inviteCode(a.teacher, a.groupId), 'eva');
    expect((await student.post('/api/groups/join', { code: await inviteCode(b.teacher, b.groupId) })).status).toBe(200);
    expect((await student.get('/api/groups')).body.groups).toHaveLength(2);
  });

  it('el profesor genera enlace de recuperación solo para su alumnado', async () => {
    const a = await teacherWithGroup(app, db, 'a@centro.test');
    const b = await teacherWithGroup(app, db, 'b@centro.test');
    const { id } = await registerStudent(app, await inviteCode(a.teacher, a.groupId), 'nora');
    expect((await a.teacher.post(`/api/groups/${a.groupId}/members/${id}/reset-link`)).status).toBe(201);
    expect((await b.teacher.post(`/api/groups/${b.groupId}/members/${id}/reset-link`)).status).toBe(404);
  });
});

describe('actualizaciones parciales', () => {
  it('PATCH de grupo y actividad no sobrescribe campos no enviados', async () => {
    const { teacher, groupId, projectId } = await teacherWithGroup(app, db);
    await teacher.patch(`/api/groups/${groupId}`, { course: '1.º Bachillerato' });
    await teacher.patch(`/api/groups/${groupId}`, { name: 'Nuevo nombre' });
    expect((await teacher.get(`/api/groups/${groupId}`)).body.group).toMatchObject({ name: 'Nuevo nombre', course: '1.º Bachillerato' });
    const act = (await teacher.get(`/api/projects/${projectId}`)).body.activities[0];
    expect((await teacher.patch(`/api/activities/${act.id}`, { title: 'Otro título' })).status).toBe(204);
    const after = (await teacher.get(`/api/projects/${projectId}`)).body.activities.find((x: { id: string }) => x.id === act.id);
    expect(after).toMatchObject({ title: 'Otro título', instructions: act.instructions });
  });
});

describe('aislamiento entre profesores y alumnos', () => {
  it('el profesor B no puede ver ni modificar el grupo del profesor A', async () => {
    const a = await teacherWithGroup(app, db, 'a@centro.test');
    const b = await teacherWithGroup(app, db, 'b@centro.test');
    const { id } = await registerStudent(app, await inviteCode(a.teacher, a.groupId), 'ana');
    expect((await b.teacher.get(`/api/groups/${a.groupId}`)).status).toBe(404);
    expect((await b.teacher.post(`/api/groups/${a.groupId}/invite`)).status).toBe(404);
    expect((await b.teacher.patch(`/api/groups/${a.groupId}`, { name: 'hack' })).status).toBe(404);
    expect((await b.teacher.patch(`/api/groups/${a.groupId}/members/${id}`, { status: 'removed' })).status).toBe(404);
    expect((await b.teacher.get(`/api/projects/${a.projectId}`)).status).toBe(404);
    expect((await b.teacher.get(`/api/projects/${a.projectId}/progress`)).status).toBe(404);
    expect((await b.teacher.post(`/api/groups/${a.groupId}/projects`, { title: 'x' })).status).toBe(404);
    const list = await b.teacher.get('/api/groups');
    expect(list.body.groups.map((g: { id: string }) => g.id)).toEqual([b.groupId]);
  });

  it('un alumno no puede crear grupos ni ver detalles de grupo', async () => {
    const a = await teacherWithGroup(app, db);
    const { student } = await registerStudent(app, await inviteCode(a.teacher, a.groupId), 'leo');
    expect((await student.post('/api/groups', { name: 'x' })).status).toBe(403);
    expect((await student.get(`/api/groups/${a.groupId}`)).status).toBe(404);
  });

  it('un alumno no ve proyectos de grupos ajenos', async () => {
    const a = await teacherWithGroup(app, db, 'a@centro.test');
    const b = await teacherWithGroup(app, db, 'b@centro.test');
    const { student } = await registerStudent(app, await inviteCode(a.teacher, a.groupId), 'sol');
    expect((await student.get(`/api/projects/${b.projectId}`)).status).toBe(404);
    expect((await student.post(`/api/projects/${b.projectId}/my-portfolio`)).status).toBe(404);
  });

  it('el admin no lee portfolios ni grupos', async () => {
    const a = await teacherWithGroup(app, db);
    await createUser(db, 'admin@centro.test', 'admin');
    const admin = client(app);
    await admin.login('admin@centro.test');
    expect((await admin.get(`/api/groups/${a.groupId}`)).status).toBe(404);
    expect((await admin.get(`/api/projects/${a.projectId}`)).status).toBe(404);
  });
});
