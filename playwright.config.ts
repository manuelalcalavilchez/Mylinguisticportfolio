import { defineConfig, devices } from '@playwright/test';

// Pruebas de extremo a extremo en navegador (escritorio y móvil) contra la app compilada.
// Requiere: `npm run build` y una BD vacía de pruebas (E2E_DATABASE_URL, por defecto mlp_e2e_test).
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://mlp:mlp_dev_password@localhost:5432/mlp_e2e_test';
const PORT = 3100;
// Con E2E_BASE_URL se prueba una instancia ya desplegada (p. ej. Docker local). ¡Crea datos de prueba! Solo en entornos de pruebas.
const EXTERNAL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: EXTERNAL ?? `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: EXTERNAL ? undefined : {
    command: `node e2e/reset-db.mjs && node apps/api/dist/server.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      APP_ORIGIN: `http://localhost:${PORT}`,
      DATABASE_URL: DB,
      SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-0000',
      TEACHER_SIGNUP_CODE: 'e2e-code',
      STATIC_DIR: 'apps/web/dist',
      STORAGE_DIR: '/tmp/mlp-e2e-uploads',
      PUBLICATION_ENABLED: 'true',
    },
  },
});
