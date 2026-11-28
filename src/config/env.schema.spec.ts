import { validateEnv } from './env.validate.js';

const SEGREDO = 'valor-secreto-que-nao-pode-aparecer';

/** Ambiente de desenvolvimento válido, com todos os serviços externos. */
function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://app_runtime:pw@localhost:5432/canal_denuncias',
    REDIS_URL: 'redis://localhost:6379',
    VAULT_ADDR: 'http://localhost:8200',
    VAULT_TOKEN: 'dev-root-token',
    S3_ENDPOINT: 'http://localhost:8333',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'attachments',
    S3_ACCESS_KEY: 'dev-access-key',
    S3_SECRET_KEY: 'dev-secret-key',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    CLAMAV_HOST: 'localhost',
    CLAMAV_PORT: '3310',
    SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-bytes',
    REPORTER_TOKEN_SECRET: 'segredo-do-token-do-denunciante-32-bytes',
    ...overrides,
  };
}

/** Ambiente de produção válido: AppRole em vez de token. */
function prodEnv(overrides: Record<string, string | undefined> = {}) {
  return baseEnv({
    NODE_ENV: 'production',
    VAULT_TOKEN: undefined,
    VAULT_ROLE_ID: 'role-id',
    VAULT_SECRET_ID: 'secret-id',
    ...overrides,
  });
}

function errorOf(env: Record<string, string | undefined>): string {
  try {
    validateEnv(env);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('a validação deveria ter falhado');
}

describe('validateEnv', () => {
  it('aceita um ambiente de desenvolvimento completo, com padrões', () => {
    const env = validateEnv(baseEnv());
    expect(env.VAULT_TIMEOUT_MS).toBe(2000);
    expect(env.PASSWORD_HASH_LOG_N).toBe(17);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.MAX_ATTACHMENT_BYTES).toBe(10_485_760);
  });

  it('aceita produção com AppRole', () => {
    expect(validateEnv(prodEnv()).NODE_ENV).toBe('production');
  });

  it('recusa VAULT_TOKEN em produção', () => {
    const message = errorOf(prodEnv({ VAULT_TOKEN: SEGREDO }));
    expect(message).toContain('VAULT_TOKEN');
    expect(message).not.toContain(SEGREDO);
  });

  it('recusa produção sem VAULT_ROLE_ID e VAULT_SECRET_ID', () => {
    const message = errorOf(prodEnv({ VAULT_ROLE_ID: undefined, VAULT_SECRET_ID: undefined }));
    expect(message).toContain('VAULT_ROLE_ID');
    expect(message).toContain('VAULT_SECRET_ID');
  });

  it('recusa desenvolvimento sem nenhuma credencial do Vault', () => {
    expect(errorOf(baseEnv({ VAULT_TOKEN: undefined }))).toContain('VAULT_TOKEN');
  });

  it.each(['SESSION_SECRET', 'REPORTER_TOKEN_SECRET'])(
    'recusa %s com menos de 32 bytes, sem mostrar o valor',
    (name) => {
      const message = errorOf(baseEnv({ [name]: 'curto-demais' }));
      expect(message).toContain(name);
      expect(message).not.toContain('curto-demais');
    },
  );

  it('recusa SESSION_SECRET igual a REPORTER_TOKEN_SECRET', () => {
    const same = `${SEGREDO}-com-32-bytes-ou-mais`;
    const message = errorOf(baseEnv({ SESSION_SECRET: same, REPORTER_TOKEN_SECRET: same }));
    expect(message).toContain('REPORTER_TOKEN_SECRET');
    expect(message).not.toContain(SEGREDO);
  });

  it('recusa PASSWORD_HASH_LOG_N abaixo de 17 fora do ambiente de teste', () => {
    expect(errorOf(baseEnv({ PASSWORD_HASH_LOG_N: '10' }))).toContain('PASSWORD_HASH_LOG_N');
    expect(errorOf(prodEnv({ PASSWORD_HASH_LOG_N: '10' }))).toContain('PASSWORD_HASH_LOG_N');
  });

  it('aceita PASSWORD_HASH_LOG_N baixo com NODE_ENV=test', () => {
    expect(validateEnv(baseEnv({ NODE_ENV: 'test', PASSWORD_HASH_LOG_N: '10' })).PASSWORD_HASH_LOG_N).toBe(10);
  });

  it('recusa REDIS_URL que não seja redis:// ou rediss://', () => {
    expect(errorOf(baseEnv({ REDIS_URL: 'http://localhost:6379' }))).toContain('REDIS_URL');
  });

  it('cita todas as variáveis obrigatórias que faltam, sem valores', () => {
    const message = errorOf(baseEnv({ REDIS_URL: undefined, S3_BUCKET: undefined, SMTP_HOST: undefined }));
    for (const name of ['REDIS_URL', 'S3_BUCKET', 'SMTP_HOST']) expect(message).toContain(name);
    expect(message).not.toContain('dev-secret-key');
    expect(message).not.toContain('postgres://');
  });
});
