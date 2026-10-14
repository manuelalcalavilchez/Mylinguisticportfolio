import { z } from 'zod';

// z.coerce.boolean() convierte "false" en true; por eso se usa un enum explícito.
const boolFlag = z
  .enum(['true', 'false', ''])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 caracteres'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  TEACHER_SIGNUP_CODE: z.string().optional().default(''),
  STORAGE_DIR: z.string().default('./data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  STATIC_DIR: z.string().optional(),
  // Nº de proxies inversos delante (Traefik de EasyPanel, Caddy...). Necesario para que el rate limit vea la IP real.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // Interruptor general de publicación pública. Desactivado hasta completar la revisión legal con el centro.
  PUBLICATION_ENABLED: boolFlag,
  // Permitir que un profesor marque un portfolio publicado como indexable por buscadores.
  ALLOW_PUBLIC_INDEXING: boolFlag,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Solo se muestran los nombres de variables con problemas, nunca sus valores.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración inválida:\n  ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && /sustituye|cambia|example/i.test(cfg.SESSION_SECRET)) {
    throw new Error('SESSION_SECRET contiene un valor de ejemplo; genera uno real con `openssl rand -hex 32`.');
  }
  return cfg;
}
