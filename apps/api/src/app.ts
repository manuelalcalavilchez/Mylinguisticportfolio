import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { loadSession } from './middleware/auth.js';
import { csrfGuard } from './middleware/csrf.js';
import { errorHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { groupsRouter } from './routes/groups.js';
import { projectsRouter } from './routes/projects.js';
import { portfoliosRouter } from './routes/portfolios.js';
import { evidencesRouter } from './routes/evidences.js';
import { publicationsRouter, publicRouter } from './routes/publications.js';
import { meRouter } from './routes/me.js';
import { Storage } from './lib/storage.js';
import { notFound } from './lib/errors.js';

export function createApp(db: Db, cfg: Config) {
  const app = express();
  const storage = new Storage(cfg.STORAGE_DIR);
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: cfg.APP_ORIGIN.startsWith('https://') ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Por defecto, ni buscadores ni cachés compartidas (ver política de indexación en la fase 5).
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  // Health check sin autenticación y sin datos sensibles. Antes del CSRF guard y la carga de sesión.
  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  app.use('/api', express.json({ limit: '200kb' }), cookieParser(), csrfGuard(cfg.APP_ORIGIN), loadSession(db));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/auth', authRouter(db, cfg));
  app.use('/api/admin', adminRouter(db, cfg, storage));
  app.use('/api/public', publicRouter(db, cfg, storage));
  app.use('/api/groups', groupsRouter(db, cfg));
  app.use('/api/portfolios', portfoliosRouter(db));
  app.use('/api/portfolios', publicationsRouter(db, cfg));
  app.use('/api/me', meRouter(db));
  app.use('/api', evidencesRouter(db, cfg, storage));
  app.use('/api', projectsRouter(db));
  app.use('/api', (_req, _res, next) => next(notFound()));

  // En producción la API sirve también el frontend compilado: un solo contenedor, menos RAM.
  if (cfg.STATIC_DIR && existsSync(cfg.STATIC_DIR)) {
    const dir = path.resolve(cfg.STATIC_DIR);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
