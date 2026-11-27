import { z } from 'zod';

/**
 * Variáveis de ambiente validadas na inicialização. Uma variável obrigatória ausente
 * impede a API de subir, em vez de falhar na primeira requisição que precisar dela.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Origens permitidas no CORS, separadas por vírgula (portal e backoffice). */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200,http://localhost:4300')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  /** A API usa o perfil app_runtime. O job de migrations usa app_migrator. */
  DATABASE_URL: z.url(),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;
