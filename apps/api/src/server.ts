import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL, cfg.DB_POOL_MAX);

await migrate(db, (m) => console.info(m));
await mkdir(cfg.STORAGE_DIR, { recursive: true });

const app = createApp(db, cfg);
const server = app.listen(cfg.PORT, () => console.info(`API escuchando en :${cfg.PORT} (${cfg.NODE_ENV})`));

// Limpieza periódica de sesiones y enlaces caducados (barato; evita un cron externo).
const cleanup = setInterval(() => {
  db.query('DELETE FROM sessions WHERE expires_at <= now()').catch(() => {});
  db.query(`DELETE FROM password_resets WHERE expires_at <= now() - interval '7 days'`).catch(() => {});
}, 60 * 60 * 1000);
cleanup.unref();

function shutdown(signal: string) {
  console.info(`${signal} recibido, cerrando...`);
  server.close(() => {
    db.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
