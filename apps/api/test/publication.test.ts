import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { privacyIssues } from '../src/lib/publication.js';
import {
  client, createUser, freshDb, inviteCode, openPortfolio, PDF, registerStudent, teacherWithGroup, testConfig,
  truncateAll, type App, type Client,
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

async function save(s: Client, id: string, section: string, data: object) {
  const v = (await s.get(`/api/portfolios/${id}`)).body.portfolio.version;
  const r = await s.put(`/api/portfolios/${id}/sections/${section}`, { version: v, data });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

/** Alumno con contenido y una evidencia aceptada con archivo. */
async function setup(a = app) {
  const t = await teacherWithGroup(a, db);
  const s = await registerStudent(a, await inviteCode(t.teacher, t.groupId), 'alba.r');
  const pid = await openPortfolio(s.student, t.projectId);
  await save(s.student, pid, 'home', { title: 'Alba’s portfolio', aboutMe: 'I love music and English.' });
  await save(s.student, pid, 'biography', { languageHistory: 'PRIVATE DRAFT TEXT' });
  const ev = await s.student.post(`/api/portfolios/${pid}/evidences`, {
    title: 'Song review', skill: 'writing', reflection: { learned: 'Adjectives', improvement: 'Connectors' },
  });
  const evId = ev.body.evidence.id as string;
  await s.student.upload(`/api/evidences/${evId}/file`, PDF);
  await s.student.post(`/api/evidences/${evId}/submit`);
  await t.teacher.post(`/api/evidences/${evId}/review`, { decision: 'accept' });
  // Una evidencia NO aceptada (borrador)
  const draft = await s.student.post(`/api/portfolios/${pid}/evidences`, { title: 'Draft listening', skill: 'listening' });
  return { ...t, ...s, pid, evId, draftEvId: draft.body.evidence.id as string };
}

async function grantConsent(t: Awaited<ReturnType<typeof setup>>) {
  const r = await t.teacher.post(`/api/groups/${t.groupId}/members/${t.id}/consents`, {
    purpose: 'public_publication', reference: 'Autorización firmada familia 2026-10-01',
  });
  expect(r.status).toBe(201);
}

const request1 = (evId: string) => ({ sections: ['home'], evidenceIds: [evId], publicName: 'Alba R.' });

async function publishFlow(t: Awaited<ReturnType<typeof setup>>) {
  await grantConsent(t);
  expect((await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId))).status).toBe(204);
  const ap = await t.teacher.post(`/api/portfolios/${t.pid}/publication/approve`);
  expect(ap.status, JSON.stringify(ap.body)).toBe(204);
  const pub = await t.teacher.post(`/api/portfolios/${t.pid}/publication/publish`);
  expect(pub.status, JSON.stringify(pub.body)).toBe(201);
  return pub.body.slug as string;
}

const anon = () => request(app);

describe('publicación: flujo completo', () => {
  it('privado por defecto: sin publicación no hay nada público', async () => {
    const t = await setup();
    const view = await t.student.get(`/api/portfolios/${t.pid}`);
    expect(view.body.portfolio.status).toBe('private_draft');
    expect(view.body.publication).toBeNull();
    const { rows } = await db.query('SELECT count(*)::int AS n FROM publications');
    expect(rows[0].n).toBe(0);
  });

  it('solicitar no publica; aprobar no publica; publicar crea snapshot con solo lo seleccionado', async () => {
    const t = await setup();
    await grantConsent(t);
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId));
    expect((await db.query('SELECT count(*)::int AS n FROM publications')).rows[0].n).toBe(0);
    await t.teacher.post(`/api/portfolios/${t.pid}/publication/approve`);
    expect((await db.query('SELECT count(*)::int AS n FROM publications')).rows[0].n).toBe(0);
    const pub = await t.teacher.post(`/api/portfolios/${t.pid}/publication/publish`);
    expect(pub.status).toBe(201);

    const res = await anon().get(`/api/public/portfolios/${pub.body.slug}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(res.body.portfolio.publicName).toBe('Alba R.');
    expect(res.body.portfolio.sections.home.aboutMe).toBe('I love music and English.');
    // No incluye secciones no seleccionadas, ni identificadores ni datos internos
    expect(body).not.toContain('PRIVATE DRAFT TEXT');
    expect(body).not.toContain('alba.r');
    expect(body).not.toContain(t.id);
    expect(body).not.toContain(t.groupId);
    expect(body).not.toContain('4ºA');
    expect(body).not.toContain('_files');
    expect(body).not.toMatch(/[a-f0-9]{48}/); // claves de almacenamiento
    expect(res.body.portfolio.evidences.map((e: { id: string }) => e.id)).toEqual([t.evId]);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('la versión publicada está congelada: editar el borrador no la cambia', async () => {
    const t = await setup();
    const slug = await publishFlow(t);
    await save(t.student, t.pid, 'home', { title: 'Changed', aboutMe: 'NEW TEXT AFTER PUBLISHING' });
    const res = await anon().get(`/api/public/portfolios/${slug}`);
    expect(JSON.stringify(res.body)).not.toContain('NEW TEXT AFTER PUBLISHING');
    expect(res.body.portfolio.sections.home.aboutMe).toBe('I love music and English.');
  });

  it('archivo público solo para evidencias incluidas en la publicación', async () => {
    const t = await setup();
    const slug = await publishFlow(t);
    const ok = await anon().get(`/api/public/portfolios/${slug}/files/${t.evId}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-security-policy']).toContain('sandbox');
    expect((await anon().get(`/api/public/portfolios/${slug}/files/${t.draftEvId}`)).status).toBe(404);
    // Las rutas privadas siguen cerradas para anónimos
    expect((await anon().get(`/api/evidences/${t.evId}/file`)).status).toBe(401);
    expect((await anon().get(`/api/portfolios/${t.pid}`)).status).toBe(401);
  });

  it('retirar invalida la URL y sus archivos, sin borrar el portfolio privado', async () => {
    const t = await setup();
    const slug = await publishFlow(t);
    expect((await t.student.post(`/api/portfolios/${t.pid}/publication/revoke`)).status).toBe(204);
    expect((await anon().get(`/api/public/portfolios/${slug}`)).status).toBe(404);
    expect((await anon().get(`/api/public/portfolios/${slug}/files/${t.evId}`)).status).toBe(404);
    const view = await t.student.get(`/api/portfolios/${t.pid}`);
    expect(view.body.portfolio.status).toBe('revoked');
    expect(view.body.portfolio.content.home.aboutMe).toBe('I love music and English.');
    expect(view.body.evidences).toHaveLength(2);
    // Segunda retirada: error controlado
    expect((await t.teacher.post(`/api/portfolios/${t.pid}/publication/revoke`)).status).toBe(409);
  });

  it('republicar sustituye la publicación anterior (la URL vieja deja de funcionar)', async () => {
    const t = await setup();
    const slug1 = await publishFlow(t);
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, { ...request1(t.evId), sections: ['home', 'biography'] });
    // Mientras se revisa, la publicación anterior sigue activa y el borrador está bloqueado
    expect((await anon().get(`/api/public/portfolios/${slug1}`)).status).toBe(200);
    const locked = await t.student.put(`/api/portfolios/${t.pid}/sections/home`, { version: 99, data: {} });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toBe('portfolio_locked');
    await t.teacher.post(`/api/portfolios/${t.pid}/publication/approve`);
    const pub2 = await t.teacher.post(`/api/portfolios/${t.pid}/publication/publish`);
    expect((await anon().get(`/api/public/portfolios/${slug1}`)).status).toBe(404);
    expect((await anon().get(`/api/public/portfolios/${pub2.body.slug}`)).body.portfolio.sections.biography).toBeDefined();
    const { rows } = await db.query('SELECT count(*)::int AS n FROM publications WHERE revoked_at IS NULL');
    expect(rows[0].n).toBe(1);
  });

  it('queda auditado quién solicitó, aprobó, publicó y retiró', async () => {
    const t = await setup();
    await publishFlow(t);
    await t.teacher.post(`/api/portfolios/${t.pid}/publication/revoke`);
    const { rows } = await db.query(
      `SELECT action FROM audit_events WHERE action LIKE 'publication.%' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'publication.requested', 'publication.approved', 'publication.published', 'publication.revoked',
    ]);
  });
});

describe('publicación: transiciones y requisitos', () => {
  it('no se pueden saltar estados', async () => {
    const t = await setup();
    await grantConsent(t);
    // publicar o aprobar sin solicitud
    expect((await t.teacher.post(`/api/portfolios/${t.pid}/publication/publish`)).status).toBe(409);
    expect((await t.teacher.post(`/api/portfolios/${t.pid}/publication/approve`)).status).toBe(409);
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId));
    // publicar sin aprobar
    expect((await t.teacher.post(`/api/portfolios/${t.pid}/publication/publish`)).status).toBe(409);
    // pedir de nuevo mientras está solicitada
    expect((await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId))).status).toBe(409);
  });

  it('el alumno no puede aprobar ni publicar su propio portfolio', async () => {
    const t = await setup();
    await grantConsent(t);
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId));
    expect((await t.student.post(`/api/portfolios/${t.pid}/publication/approve`)).status).toBe(403);
    expect((await t.student.post(`/api/portfolios/${t.pid}/publication/publish`)).status).toBe(403);
  });

  it('otro profesor no puede aprobar ni retirar', async () => {
    const t = await setup();
    const slug = await publishFlow(t);
    const other = await teacherWithGroup(app, db, 'otro@centro.test');
    expect((await other.teacher.post(`/api/portfolios/${t.pid}/publication/revoke`)).status).toBe(404);
    expect((await anon().get(`/api/public/portfolios/${slug}`)).status).toBe(200);
  });

  it('sin consentimiento registrado no se puede aprobar', async () => {
    const t = await setup();
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId));
    const r = await t.teacher.post(`/api/portfolios/${t.pid}/publication/approve`);
    expect(r.status).toBe(409);
    expect(r.body.details.map((d: { code: string }) => d.code)).toContain('consent_missing');
  });

  it('solo evidencias aceptadas', async () => {
    const t = await setup();
    const r = await t.student.post(`/api/portfolios/${t.pid}/publication/request`, { ...request1(t.evId), evidenceIds: [t.draftEvId] });
    expect(r.status).toBe(400);
  });

  it('bloquea datos personales detectables (email, teléfono, usuario)', async () => {
    const t = await setup();
    await grantConsent(t);
    await save(t.student, t.pid, 'home', { aboutMe: 'Write me at alba@example.com or 612 345 678' });
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId));
    const prev = await t.teacher.get(`/api/portfolios/${t.pid}/publication/preview`);
    expect(prev.body.problems.map((p: { code: string }) => p.code)).toContain('privacy_check_failed');
    const r = await t.teacher.post(`/api/portfolios/${t.pid}/publication/approve`);
    expect(r.status).toBe(409);
    // El profesor pide cambios; el alumno corrige y vuelve a solicitar
    expect((await t.teacher.post(`/api/portfolios/${t.pid}/publication/request-changes`, { feedback: 'Remove contact details' })).status).toBe(204);
    await save(t.student, t.pid, 'home', { aboutMe: 'I love music.' });
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId));
    expect((await t.teacher.post(`/api/portfolios/${t.pid}/publication/approve`)).status).toBe(204);
  });

  it('detector de privacidad: casos unitarios', () => {
    const base = { templateVersion: 1, projectTitle: 'x', language: 'en', course: 'x', evidences: [] };
    const chk = (text: string) => privacyIssues({ ...base, publicName: 'Ana', sections: { home: { aboutMe: text } } }, 'ana.lopez');
    expect(chk('My email is a.b@c.es')).toHaveLength(1);
    expect(chk('Call +34 612 34 56 78')).toHaveLength(1);
    expect(chk('Find me as ana.lopez')).toHaveLength(1);
    expect(chk('In 2019 2020 2021 I studied 3 hours a day')).toHaveLength(0);
    expect(chk('I am 15 and live near the sea')).toHaveLength(0);
    // Los identificadores internos no son teléfonos (regresión: UUID con muchas cifras seguidas)
    const ev = { id: '61234567-8901-4234-9567-890123456789', title: 'Essay', date: '2026-10-01', language: 'en', skill: 'writing', externalUrl: null, reflection: {}, fileMime: null };
    expect(privacyIssues({ ...base, evidences: [ev], publicName: 'Ana', sections: {} }, 'ana.lopez')).toHaveLength(0);
    expect(privacyIssues({ ...base, evidences: [{ ...ev, title: 'call 612345678' }], publicName: 'Ana', sections: {} }, 'ana.lopez')).toHaveLength(1);
  });

  it('cancelar la solicitud desbloquea la edición', async () => {
    const t = await setup();
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId));
    expect((await t.student.post(`/api/portfolios/${t.pid}/publication/cancel`)).status).toBe(204);
    await save(t.student, t.pid, 'home', { title: 'editable again' });
  });

  it('retirar el consentimiento retira automáticamente la publicación', async () => {
    const t = await setup();
    const slug = await publishFlow(t);
    const r = await t.teacher.post(`/api/groups/${t.groupId}/members/${t.id}/consents/withdraw`, { purpose: 'public_publication' });
    expect(r.body.revokedPublications).toBe(1);
    expect((await anon().get(`/api/public/portfolios/${slug}`)).status).toBe(404);
  });

  it('con PUBLICATION_ENABLED=false se puede aprobar pero no publicar', async () => {
    const off = createApp(db, testConfig({ PUBLICATION_ENABLED: 'false' }));
    const t = await setup(off);
    await grantConsent(t);
    await t.student.post(`/api/portfolios/${t.pid}/publication/request`, request1(t.evId));
    expect((await t.teacher.post(`/api/portfolios/${t.pid}/publication/approve`)).status).toBe(204);
    const r = await t.teacher.post(`/api/portfolios/${t.pid}/publication/publish`);
    expect(r.status).toBe(409);
    expect(r.body.details.map((d: { code: string }) => d.code)).toContain('publication_disabled');
  });

  it('slugs inválidos o inventados devuelven 404', async () => {
    await setup();
    for (const s of ['x', 'AAAAAAAAAAAA', '../../etc/passwd', "' OR 1=1 --"]) {
      expect((await anon().get(`/api/public/portfolios/${encodeURIComponent(s)}`)).status).toBe(404);
    }
  });

  it('el admin puede listar y retirar publicaciones sin ver el contenido', async () => {
    const t = await setup();
    const slug = await publishFlow(t);
    await createUser(db, 'admin@centro.test', 'admin');
    const admin = client(app);
    await admin.login('admin@centro.test');
    const list = await admin.get('/api/admin/publications');
    expect(list.body.publications).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('I love music');
    expect((await admin.post(`/api/admin/publications/${list.body.publications[0].id}/revoke`)).status).toBe(204);
    expect((await anon().get(`/api/public/portfolios/${slug}`)).status).toBe(404);
  });
});

describe('derechos sobre los datos', () => {
  it('el alumno exporta sus datos', async () => {
    const t = await setup();
    const r = await t.student.get('/api/me/export');
    expect(r.status).toBe(200);
    expect(r.body.portfolios[0].content.home.aboutMe).toBe('I love music and English.');
    expect(r.body.evidences).toHaveLength(2);
    expect(JSON.stringify(r.body)).not.toMatch(/password|scrypt|[a-f0-9]{48}/);
  });

  it('el admin borra un alumno con sus datos y archivos (con confirmación)', async () => {
    const t = await setup();
    const slug = await publishFlow(t);
    await createUser(db, 'admin@centro.test', 'admin');
    const admin = client(app);
    await admin.login('admin@centro.test');
    expect((await admin.del(`/api/admin/users/${t.id}`, { confirm: 'otro' })).status).toBe(400);
    const r = await admin.del(`/api/admin/users/${t.id}`, { confirm: 'alba.r' });
    expect(r.status).toBe(200);
    expect(r.body.deletedFiles).toBe(1);
    expect((await anon().get(`/api/public/portfolios/${slug}`)).status).toBe(404);
    const { rows } = await db.query('SELECT (SELECT count(*) FROM portfolios)::int AS p, (SELECT count(*) FROM evidences)::int AS e');
    expect(rows[0]).toEqual({ p: 0, e: 0 });
    // Un profesor con grupos no se puede borrar
    const teacherId = (await db.query(`SELECT id FROM users WHERE login = 'profe@centro.test'`)).rows[0].id;
    expect((await admin.del(`/api/admin/users/${teacherId}`, { confirm: 'profe@centro.test' })).status).toBe(409);
  });
});
