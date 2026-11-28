import { z } from 'zod';

const MIN_SECRET_BYTES = 32;
const PRODUCTION_MIN_HASH_LOG_N = 17;

const secret = z
  .string()
  .refine((v) => Buffer.byteLength(v, 'utf8') >= MIN_SECRET_BYTES, `precisa ter no mínimo ${MIN_SECRET_BYTES} bytes`);

const port = z.coerce.number().int().min(1).max(65_535);

const boolFlag = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');

/**
 * Variáveis de ambiente validadas na inicialização (contracts/environment.md). Uma variável obrigatória ausente
 * ou insegura impede a API de subir, em vez de falhar na primeira requisição que precisar dela.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: port.default(3000),
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
    DATABASE_SSL: boolFlag('false'),

    REDIS_URL: z.url().refine((v) => /^rediss?:\/\//.test(v), 'precisa começar com redis:// ou rediss://'),

    VAULT_ADDR: z.url(),
    /** Só fora de produção. Em produção, a presença dele recusa a inicialização. */
    VAULT_TOKEN: z.string().min(1).optional(),
    /** AppRole: obrigatório em produção. */
    VAULT_ROLE_ID: z.string().min(1).optional(),
    VAULT_SECRET_ID: z.string().min(1).optional(),
    VAULT_TIMEOUT_MS: z.coerce.number().int().min(100).max(5000).default(2000),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: boolFlag('true'),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: port,
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(1).optional(),

    CLAMAV_HOST: z.string().min(1),
    CLAMAV_PORT: port,

    SESSION_SECRET: secret,
    REPORTER_TOKEN_SECRET: secret,

    /** logN do scrypt do PasswordHasher (D32). Abaixo de 17 só com NODE_ENV=test. */
    PASSWORD_HASH_LOG_N: z.coerce.number().int().min(10).max(22).default(PRODUCTION_MIN_HASH_LOG_N),
    /** Tamanho máximo de anexo. Também é a referência do limite de corpo do proxy. */
    MAX_ATTACHMENT_BYTES: z.coerce.number().int().positive().default(10_485_760),
  })
  .superRefine((env, ctx) => {
    const isProduction = env.NODE_ENV === 'production';

    if (isProduction && env.VAULT_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['VAULT_TOKEN'], message: 'não é aceito em produção (use AppRole)' });
    }
    if (isProduction) {
      for (const name of ['VAULT_ROLE_ID', 'VAULT_SECRET_ID'] as const) {
        if (!env[name]) ctx.addIssue({ code: 'custom', path: [name], message: 'obrigatório em produção' });
      }
    } else if (!env.VAULT_TOKEN && !(env.VAULT_ROLE_ID && env.VAULT_SECRET_ID)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAULT_TOKEN'],
        message: 'defina VAULT_TOKEN ou o par VAULT_ROLE_ID e VAULT_SECRET_ID',
      });
    }

    if (env.SESSION_SECRET === env.REPORTER_TOKEN_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['REPORTER_TOKEN_SECRET'],
        message: 'precisa ser diferente de SESSION_SECRET',
      });
    }

    if (env.NODE_ENV !== 'test' && env.PASSWORD_HASH_LOG_N < PRODUCTION_MIN_HASH_LOG_N) {
      ctx.addIssue({
        code: 'custom',
        path: ['PASSWORD_HASH_LOG_N'],
        message: `abaixo de ${PRODUCTION_MIN_HASH_LOG_N} só é aceito com NODE_ENV=test`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
