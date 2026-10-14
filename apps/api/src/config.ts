import { z } from 'zod';

// z.coerce.boolean() convierte "false" en true; por eso se usa un enum explícito.
const boolFlag = z
  .enum(['true', 'false', ''])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Uno o varios orígenes separados por comas. El primero es el principal (enlaces de recuperación y publicación).
  APP_ORIGIN: z
    .string()
    .min(1)
    .transform((v, ctx) => {
      const list = v.split(',').map((s) => s.trim()).filter(Boolean);
      const origins: string[] = [];
      for (const item of list) {
        try {
          const u = new URL(item);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
          origins.push(u.origin);
        } catch {
          ctx.addIssue({ code: 'custom', message: `Origen no válido: ${item}` });
          return z.NEVER;
        }
      }
      if (!origins.length) {
        ctx.addIssue({ code: 'custom', message: 'APP_ORIGIN vacío' });
        return z.NEVER;
      }
      return origins;
    }),
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

type Parsed = z.infer<typeof schema>;
export type Config = Omit<Parsed, 'APP_ORIGIN'> & {
  /** Origen principal (el primero de la lista). */
  APP_ORIGIN: string;
  /** Todos los orígenes permitidos. */
  APP_ORIGINS: string[];
};

/** Detecta valores copiados de la guía sin sustituir (p. ej. "<64 caracteres hex: ...>"). */
export function looksLikePlaceholder(v: string): boolean {
  return /[<>]|sustituye|cambia|example/i.test(v);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Solo se muestran los nombres de variables con problemas, nunca sus valores.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuración inválida:\n  ${issues}`);
  }
  const { APP_ORIGIN: origins, ...rest } = parsed.data;
  const cfg: Config = { ...rest, APP_ORIGIN: origins[0]!, APP_ORIGINS: origins };
  if (cfg.NODE_ENV === 'production') {
    // Valores copiados de la documentación pública = secretos conocidos: no se arranca.
    if (looksLikePlaceholder(cfg.SESSION_SECRET)) {
      throw new Error('SESSION_SECRET tiene un valor de ejemplo. Genera uno real con `openssl rand -hex 32`.');
    }
    if (cfg.TEACHER_SIGNUP_CODE && looksLikePlaceholder(cfg.TEACHER_SIGNUP_CODE)) {
      throw new Error('TEACHER_SIGNUP_CODE tiene un valor de ejemplo. Pon un código propio o déjalo vacío.');
    }
  }
  return cfg;
}
