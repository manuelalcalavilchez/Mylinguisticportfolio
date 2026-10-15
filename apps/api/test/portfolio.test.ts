import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Db } from '../src/db.js';
import { computeProgress } from '../src/lib/template.js';
import {
  freshDb, inviteCode, openPortfolio, PDF, PNG, registerStudent, teacherWithGroup, testConfig, truncateAll,
  type App, type Client,
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

async function setup() {
  const t = await teacherWithGroup(app, db);
  const code = await inviteCode(t.teacher, t.groupId);
  const a = await registerStudent(app, code, 'alumna.a');
  const b = await registerStudent(app, code, 'alumno.b');
  const pa = await openPortfolio(a.student, t.projectId);
  const pb = await openPortfolio(b.student, t.projectId);
  return { ...t, a, b, pa, pb };
}

async function save(s: Client, id: string, section: string, data: object, version?: number) {
  const v = version ?? (await s.get(`/api/portfolios/${id}`)).body.portfolio.version;
  return s.put(`/api/portfolios/${id}/sections/${section}`, { version: v, data });
}

describe('portfolio: diseño', () => {
  const put = async (s: Client, id: string, design: unknown) => {
    const v = (await s.get(`/api/portfolios/${id}`)).body.portfolio.version;
    return s.put(`/api/portfolios/${id}/design`, { version: v, design });
  };

  it('por defecto devuelve un diseño completo', async () => {
    const { a, pa } = await setup();
    const d = (await a.student.get(`/api/portfolios/${pa}`)).body.portfolio.design;
    expect(d).toMatchObject({ layout: 'notebook', palette: 'ocean', font: 'modern', sectionOrder: ['home', 'passport', 'biography', 'dossier'] });
  });

  it('el alumno guarda su diseño y el profesor lo ve', async () => {
    const { a, pa, teacher } = await setup();
    const r = await put(a.student, pa, { layout: 'magazine', palette: 'forest', accent: '#ff8800', cardStyle: 'tape', sectionOrder: ['dossier', 'home', 'passport', 'biography'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = (await teacher.get(`/api/portfolios/${pa}`)).body.portfolio.design;
    expect(d).toMatchObject({ layout: 'magazine', accent: '#ff8800', cardStyle: 'tape', sectionOrder: ['dossier', 'home', 'passport', 'biography'] });
  });

  it('solo admite opciones cerradas: nada de CSS, URLs ni emojis fuera de la lista', async () => {
    const { a, pa } = await setup();
    for (const bad of [
      { accent: 'red; background:url(https://x)' },
      { layout: 'custom' },
      { stickers: ['<script>'] },
      { stickers: Array(7).fill('⭐') },
      { cover: { avatar: '💩' } },
      { cover: { motto: 'x'.repeat(141) } },
      { sectionOrder: ['home', 'home', 'passport', 'biography'] },
      { css: 'body{}' },
    ]) {
      expect((await put(a.student, pa, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('otro alumno o el profesor no pueden cambiar el diseño', async () => {
    const { b, pa, teacher } = await setup();
    expect((await b.student.put(`/api/portfolios/${pa}/design`, { version: 1, design: {} })).status).toBe(404);
    expect((await teacher.put(`/api/portfolios/${pa}/design`, { version: 1, design: {} })).status).toBe(403);
  });

  it('control de versión compartido con las secciones', async () => {
    const { a, pa } = await setup();
    expect((await a.student.put(`/api/portfolios/${pa}/design`, { version: 1, design: {} })).status).toBe(200);
    expect((await a.student.put(`/api/portfolios/${pa}/sections/home`, { version: 1, data: {} })).status).toBe(409);
  });
});

describe('portfolio: plantilla y guardado', () => {
  it('abrir el portfolio es idempotente', async () => {
    const t = await setup();
    expect(await openPortfolio(t.a.student, t.projectId)).toBe(t.pa);
  });

  it('el alumno guarda las cuatro secciones y se conservan', async () => {
    const { a, pa } = await setup();
    expect((await save(a.student, pa, 'home', { aboutMe: 'Hi! I am Alba.', goals: ['Speak fluently'] })).status).toBe(200);
    expect((await save(a.student, pa, 'passport', { languages: [{ language: 'Spanish', relation: 'mother_tongue' }], selfAssessment: { listening: 'B1' } })).status).toBe(200);
    expect((await save(a.student, pa, 'biography', { languageHistory: 'I started at 6.', objectives: [{ goal: 'Read a novel', achieved: 'partly' }], canDo: { l1: 'yes' } })).status).toBe(200);
    expect((await save(a.student, pa, 'dossier', { intro: 'My best work' })).status).toBe(200);
    const res = await a.student.get(`/api/portfolios/${pa}`);
    expect(res.body.portfolio.content.home.aboutMe).toBe('Hi! I am Alba.');
    expect(res.body.portfolio.content.passport.selfAssessment.listening).toBe('B1');
    expect(res.body.portfolio.content.biography.canDo.l1).toBe('yes');
    expect(res.body.portfolio.content.dossier.intro).toBe('My best work');
    expect(res.body.portfolio.version).toBe(5);
    expect(res.body.progress.percent).toBeGreaterThan(0);
  });

  it('el guardado parcial está permitido pero se validan tipos y longitudes', async () => {
    const { a, pa } = await setup();
    expect((await save(a.student, pa, 'home', {})).status).toBe(200);
    expect((await save(a.student, pa, 'home', { aboutMe: 'x'.repeat(3001) })).status).toBe(400);
    expect((await save(a.student, pa, 'home', { unknownField: 1 })).status).toBe(400);
    expect((await save(a.student, pa, 'passport', { selfAssessment: { listening: 'Z9' } })).status).toBe(400);
    expect((await save(a.student, pa, 'biography', { canDo: { inventado: 'yes' } })).status).toBe(400);
  });

  it('detecta conflictos de versión (dos pestañas)', async () => {
    const { a, pa } = await setup();
    const v = (await a.student.get(`/api/portfolios/${pa}`)).body.portfolio.version;
    expect((await save(a.student, pa, 'home', { title: 'uno' }, v)).status).toBe(200);
    const stale = await save(a.student, pa, 'home', { title: 'dos' }, v);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('version_conflict');
  });

  it('el texto con HTML se guarda como texto y se devuelve como JSON', async () => {
    const { a, pa } = await setup();
    await save(a.student, pa, 'home', { aboutMe: '<script>alert(1)</script><img src=x onerror=alert(1)>' });
    const res = await a.student.get(`/api/portfolios/${pa}`);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.portfolio.content.home.aboutMe).toBe('<script>alert(1)</script><img src=x onerror=alert(1)>');
  });
});

describe('portfolio: autorización', () => {
  it('el alumno A no puede leer ni modificar el portfolio de B', async () => {
    const { a, pb } = await setup();
    expect((await a.student.get(`/api/portfolios/${pb}`)).status).toBe(404);
    expect((await save(a.student, pb, 'home', { title: 'hack' }, 1)).status).toBe(404);
    expect((await a.student.post(`/api/portfolios/${pb}/evidences`, { title: 'x', skill: 'writing' })).status).toBe(404);
  });

  it('el profesor lee pero no edita; otro profesor no lee', async () => {
    const t = await setup();
    const other = await teacherWithGroup(app, db, 'otro@centro.test');
    expect((await t.teacher.get(`/api/portfolios/${t.pa}`)).status).toBe(200);
    expect((await t.teacher.put(`/api/portfolios/${t.pa}/sections/home`, { version: 1, data: {} })).status).toBe(403);
    expect((await other.teacher.get(`/api/portfolios/${t.pa}`)).status).toBe(404);
    expect((await other.teacher.post(`/api/portfolios/${t.pa}/comments`, { feedback: 'x' })).status).toBe(404);
  });

  it('si el alumno es retirado del grupo, su profesor deja de verlo y el alumno no puede editar', async () => {
    const t = await setup();
    await t.teacher.patch(`/api/groups/${t.groupId}/members/${t.a.id}`, { status: 'removed' });
    expect((await t.teacher.get(`/api/portfolios/${t.pa}`)).status).toBe(404);
    expect((await save(t.a.student, t.pa, 'home', { title: 'x' })).status).toBe(403);
  });

  it('proyecto cerrado: no se edita', async () => {
    const t = await setup();
    await t.teacher.patch(`/api/projects/${t.projectId}`, { status: 'closed' });
    const r = await save(t.a.student, t.pa, 'home', { title: 'x' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('project_closed');
  });
});

describe('progreso', () => {
  it('cálculo orientativo por secciones', () => {
    const p = computeProgress(
      { home: { aboutMe: 'Hello', goals: ['a'] }, passport: { languages: [{ language: 'es' }] } },
      [{ skill: 'writing', status: 'submitted' }, { skill: 'reading', status: 'draft' }],
    );
    expect(p.sections.home).toEqual({ done: 2, total: 2 });
    expect(p.sections.passport).toEqual({ done: 1, total: 2 });
    expect(p.sections.dossier).toEqual({ done: 1, total: 6 });
    expect(p.percent).toBe(31);
  });

  it('el profesor ve el progreso del grupo, incluidos alumnos sin empezar', async () => {
    const t = await setup();
    await registerStudent(app, await inviteCode(t.teacher, t.groupId), 'sin.empezar');
    await save(t.a.student, t.pa, 'home', { aboutMe: 'Hello', goals: ['x'] });
    const res = await t.teacher.get(`/api/projects/${t.projectId}/progress`);
    expect(res.status).toBe(200);
    expect(res.body.students).toHaveLength(3);
    const byLogin = Object.fromEntries(res.body.students.map((s: { login: string }) => [s.login, s]));
    expect(byLogin['alumna.a'].progress.sections.home.done).toBe(2);
    expect(byLogin['sin.empezar'].status).toBe('not_started');
  });
});

describe('evidencias y archivos', () => {
  async function evidence(s: Client, pid: string, extra: object = {}) {
    const r = await s.post(`/api/portfolios/${pid}/evidences`, { title: 'My essay', skill: 'writing', date: '2026-10-01', ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.evidence.id as string;
  }

  it('sube un PDF, detecta el tipo real y lo sirve con cabeceras seguras', async () => {
    const { a, pa, teacher } = await setup();
    const id = await evidence(a.student, pa);
    const up = await a.student.upload(`/api/evidences/${id}/file`, PDF, 'trabajo.exe');
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.fileMime).toBe('application/pdf');
    const dl = await teacher.get(`/api/evidences/${id}/file`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-disposition']).not.toContain('trabajo');
  });

  it('rechaza tipos no permitidos aunque la extensión parezca válida, y archivos grandes', async () => {
    const { a, pa } = await setup();
    const id = await evidence(a.student, pa);
    const html = await a.student.upload(`/api/evidences/${id}/file`, Buffer.from('<html><script>alert(1)</script></html>'), 'foto.png');
    expect(html.status).toBe(415);
    const big = await a.student.upload(`/api/evidences/${id}/file`, Buffer.concat([PNG, Buffer.alloc(1.2 * 1024 * 1024)]), 'big.png');
    expect(big.status).toBe(413);
    const { rows } = await db.query('SELECT private_storage_key FROM evidences WHERE id = $1', [id]);
    expect(rows[0].private_storage_key).toBeNull();
  });

  it('acceso a archivos denegado a otros alumnos, otros profesores y anónimos', async () => {
    const { a, b, pa } = await setup();
    const other = await teacherWithGroup(app, db, 'otro@centro.test');
    const id = await evidence(a.student, pa);
    await a.student.upload(`/api/evidences/${id}/file`, PDF);
    expect((await b.student.get(`/api/evidences/${id}/file`)).status).toBe(404);
    expect((await other.teacher.get(`/api/evidences/${id}/file`)).status).toBe(404);
    expect((await b.student.post(`/api/evidences/${id}/file-link`)).status).toBe(404);
    const anon = await (await import('supertest')).default(app).get(`/api/evidences/${id}/file`);
    expect(anon.status).toBe(401);
  });

  it('enlace temporal: funciona sin sesión, falla si caduca o se manipula', async () => {
    const { a, pa } = await setup();
    const id = await evidence(a.student, pa);
    await a.student.upload(`/api/evidences/${id}/file`, PNG);
    const link = await a.student.post(`/api/evidences/${id}/file-link`);
    const st = (await import('supertest')).default;
    expect((await st(app).get(link.body.url)).status).toBe(200);
    const sig = new URL(link.body.url, 'http://x').searchParams.get('sig')!;
    const tampered = link.body.url.replace(`sig=${sig}`, `sig=${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`);
    expect((await st(app).get(tampered)).status).toBe(403);
    const url = new URL(link.body.url, 'http://x');
    url.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 10));
    expect((await st(app).get(url.pathname + url.search)).status).toBe(403);
  });

  it('rechaza enlaces javascript: y data:', async () => {
    const { a, pa } = await setup();
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://x.test']) {
      const r = await a.student.post(`/api/portfolios/${pa}/evidences`, { title: 't', skill: 'reading', externalUrl: bad });
      expect(r.status).toBe(400);
    }
    expect((await a.student.post(`/api/portfolios/${pa}/evidences`, { title: 't', skill: 'reading', externalUrl: 'https://example.org/x' })).status).toBe(201);
  });

  it('flujo entrega → devolución → corrección → aceptación', async () => {
    const { a, pa, teacher } = await setup();
    const id = await evidence(a.student, pa);
    // Entrega incompleta: falta archivo/enlace y reflexión
    const inc = await a.student.post(`/api/evidences/${id}/submit`);
    expect(inc.status).toBe(400);
    await a.student.upload(`/api/evidences/${id}/file`, PDF);
    const pr = await a.student.patch(`/api/evidences/${id}`, { reflection: { learned: 'Linkers', improvement: 'More vocabulary' } });
    expect(pr.status, JSON.stringify(pr.body)).toBe(204);
    expect((await a.student.post(`/api/evidences/${id}/submit`)).status).toBe(204);
    // Entregada: el alumno ya no puede modificarla
    expect((await a.student.patch(`/api/evidences/${id}`, { title: 'cambio' })).status).toBe(409);
    expect((await a.student.del(`/api/evidences/${id}`)).status).toBe(409);
    // Devolver exige feedback
    expect((await teacher.post(`/api/evidences/${id}/review`, { decision: 'return' })).status).toBe(400);
    expect((await teacher.post(`/api/evidences/${id}/review`, { decision: 'return', feedback: 'Add a conclusion' })).status).toBe(204);
    expect((await a.student.patch(`/api/evidences/${id}`, { title: 'My essay v2' })).status).toBe(204);
    expect((await a.student.post(`/api/evidences/${id}/submit`)).status).toBe(204);
    expect((await teacher.post(`/api/evidences/${id}/review`, { decision: 'accept', feedback: 'Great' })).status).toBe(204);
    // No se puede revisar dos veces
    expect((await teacher.post(`/api/evidences/${id}/review`, { decision: 'accept' })).status).toBe(409);
    const view = await a.student.get(`/api/portfolios/${pa}`);
    expect(view.body.evidences[0].status).toBe('accepted');
    expect(view.body.reviews.filter((r: { kind: string }) => r.kind === 'evidence_review')).toHaveLength(2);
  });

  it('el alumno no puede revisar; un profesor ajeno tampoco', async () => {
    const { a, pa } = await setup();
    const other = await teacherWithGroup(app, db, 'otro@centro.test');
    const id = await evidence(a.student, pa, { externalUrl: 'https://example.org' });
    await a.student.patch(`/api/evidences/${id}`, { reflection: { learned: 'x', improvement: 'y' } });
    await a.student.post(`/api/evidences/${id}/submit`);
    expect((await a.student.post(`/api/evidences/${id}/review`, { decision: 'accept' })).status).toBe(403);
    expect((await other.teacher.post(`/api/evidences/${id}/review`, { decision: 'accept' })).status).toBe(404);
  });

  it('borrar una evidencia en borrador elimina su archivo del disco', async () => {
    const { a, pa } = await setup();
    const id = await evidence(a.student, pa);
    await a.student.upload(`/api/evidences/${id}/file`, PDF);
    const { rows } = await db.query('SELECT private_storage_key AS k FROM evidences WHERE id = $1', [id]);
    const { existsSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    const k = rows[0].k as string;
    const file = path.join(cfg.STORAGE_DIR, k.slice(0, 2), k.slice(2, 4), k);
    expect(existsSync(file)).toBe(true);
    expect((await a.student.del(`/api/evidences/${id}`)).status).toBe(204);
    expect(existsSync(file)).toBe(false);
  });

  it('una actividad de otro proyecto no se puede vincular', async () => {
    const { a, pa } = await setup();
    const other = await teacherWithGroup(app, db, 'otro@centro.test');
    const acts = await other.teacher.get(`/api/projects/${other.projectId}`);
    const r = await a.student.post(`/api/portfolios/${pa}/evidences`, { title: 't', skill: 'writing', activityId: acts.body.activities[0].id });
    expect(r.status).toBe(400);
  });
});

describe('comentarios y rúbrica', () => {
  it('el profesor comenta y evalúa con la rúbrica; puntuaciones fuera de rango se rechazan', async () => {
    const { teacher, a, pa, projectId } = await setup();
    expect((await teacher.post(`/api/portfolios/${pa}/comments`, { section: 'home', feedback: 'Add your goals' })).status).toBe(201);
    const bad = await teacher.post(`/api/portfolios/${pa}/assessment`, { scores: { completeness: 99 } });
    expect(bad.status).toBe(400);
    const ok = await teacher.post(`/api/portfolios/${pa}/assessment`, { scores: { completeness: 3, reflection: 2 }, feedback: 'Good start' });
    expect(ok.status).toBe(201);
    expect(ok.body.review).toMatchObject({ total: 5, max: 16, complete: false });
    const view = await a.student.get(`/api/portfolios/${pa}`);
    expect(view.body.reviews.map((r: { kind: string }) => r.kind).sort()).toEqual(['assessment', 'comment']);
    // Rúbrica configurable
    const rub = [{ id: 'oral', name: 'Oral skills', levels: [{ score: 1, descriptor: 'Low' }, { score: 2, descriptor: 'High' }] }];
    expect((await teacher.put(`/api/projects/${projectId}/rubric`, { rubric: rub })).status).toBe(204);
    expect((await teacher.post(`/api/portfolios/${pa}/assessment`, { scores: { completeness: 3 } })).status).toBe(400);
    expect((await teacher.post(`/api/portfolios/${pa}/assessment`, { scores: { oral: 2 } })).status).toBe(201);
  });

  it('el alumno no puede comentar ni evaluar', async () => {
    const { a, pa } = await setup();
    expect((await a.student.post(`/api/portfolios/${pa}/comments`, { feedback: 'x' })).status).toBe(403);
    expect((await a.student.post(`/api/portfolios/${pa}/assessment`, { scores: {} })).status).toBe(403);
  });
});
