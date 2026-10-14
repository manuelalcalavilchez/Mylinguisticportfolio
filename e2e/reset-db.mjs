// Vacía la base de datos de pruebas E2E antes de arrancar el servidor. Solo acepta nombres que terminen en _test.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !/_test$/.test(new URL(url).pathname)) {
  console.error('reset-db: DATABASE_URL debe apuntar a una base de datos *_test');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await client.end();
console.info('reset-db: base de datos E2E vaciada');
