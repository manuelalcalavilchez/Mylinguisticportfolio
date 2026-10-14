import { createPool } from './db.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}
const db = createPool(url, 1);
try {
  const applied = await migrate(db, (m) => console.info(m));
  console.info(applied.length ? `${applied.length} migraciones aplicadas` : 'Base de datos al día');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
