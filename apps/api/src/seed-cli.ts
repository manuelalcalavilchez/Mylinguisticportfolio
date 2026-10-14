/**
 * Datos ficticios de demostración: 1 profesor, 1 grupo con proyecto, 2 alumnos con contenido de ejemplo.
 * Uso:  npm run seed -w apps/api        (Docker: node dist/seed-cli.js)
 * Se niega a ejecutarse con NODE_ENV=production salvo SEED_FORCE=true.
 * Contraseña: SEED_PASSWORD o una aleatoria que se muestra al final.
 */
import { randomBytes } from 'node:crypto';
import { createPool, withTransaction } from './db.js';
import { migrate } from './migrate.js';
import { hashPassword } from './lib/password.js';
import { createProject } from './routes/projects.js';

const { DATABASE_URL, NODE_ENV, SEED_FORCE, SEED_PASSWORD } = process.env;
if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}
if (NODE_ENV === 'production' && SEED_FORCE !== 'true') {
  console.error('Seed bloqueado en producción. Usa SEED_FORCE=true solo en un entorno de pruebas.');
  process.exit(1);
}

const password = SEED_PASSWORD ?? randomBytes(9).toString('base64url');
if (password.length < 10) {
  console.error('SEED_PASSWORD debe tener al menos 10 caracteres');
  process.exit(1);
}

const db = createPool(DATABASE_URL, 2);
try {
  await migrate(db);
  const hash = await hashPassword(password);
  const exists = await db.query(`SELECT 1 FROM users WHERE lower(login) = 'demo.teacher@example.invalid'`);
  if (exists.rowCount) {
    console.info('Los datos de demostración ya existen; no se crea nada.');
  } else {
    await withTransaction(db, async (c) => {
      const user = async (login: string, name: string, role: string) =>
        (await c.query<{ id: string }>(
          `INSERT INTO users (login, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
          [login, name, hash, role],
        )).rows[0]!.id;
      const teacher = await user('demo.teacher@example.invalid', 'Demo Teacher', 'teacher');
      const group = (await c.query<{ id: string }>(
        `INSERT INTO groups (teacher_id, name, course, description) VALUES ($1, '4.º ESO Demo', '4.º ESO', 'Grupo ficticio') RETURNING id`,
        [teacher],
      )).rows[0]!.id;
      await c.query(`INSERT INTO memberships (group_id, user_id, role) VALUES ($1, $2, 'teacher')`, [group, teacher]);
      const project = await createProject(c, group, 'My Linguistic Portfolio', '4.º ESO');
      for (const [login, name, about] of [
        ['demo.alba', 'Alba', 'Hi! I am Alba. I love music and I want to travel to Ireland.'],
        ['demo.leo', 'Leo', 'Hello, I am Leo. I play football and I like video games.'],
      ] as const) {
        const sid = await user(login, name, 'student');
        await c.query(`INSERT INTO memberships (group_id, user_id, role) VALUES ($1, $2, 'student')`, [group, sid]);
        const content = {
          home: { title: `${name}’s portfolio`, aboutMe: about, goals: ['Speak more fluently', 'Read a book in English'] },
          passport: {
            languages: [{ language: 'Spanish', relation: 'mother_tongue' }, { language: 'English', relation: 'school' }],
            selfAssessment: { listening: 'B1', reading: 'B1', spokenInteraction: 'A2', spokenProduction: 'A2', writing: 'B1' },
          },
          biography: { languageHistory: 'I started learning English when I was six.' },
        };
        const pf = (await c.query<{ id: string }>(
          `INSERT INTO portfolios (student_id, project_id, content) VALUES ($1, $2, $3) RETURNING id`,
          [sid, project, JSON.stringify(content)],
        )).rows[0]!.id;
        await c.query(
          `INSERT INTO evidences (portfolio_id, title, evidence_date, skill, external_url, reflection, status)
           VALUES ($1, 'My favourite song review', current_date, 'writing', 'https://example.org/', $2, 'submitted')`,
          [pf, JSON.stringify({ learned: 'New adjectives', improvement: 'Use more connectors' })],
        );
      }
    });
    console.info('Datos de demostración creados:');
    console.info('  Profesor: demo.teacher@example.invalid');
    console.info('  Alumnos:  demo.alba, demo.leo');
    console.info(`  Contraseña de todos: ${password}`);
  }
} finally {
  await db.end();
}
