/**
 * Ambiente dos testes de integração. Os serviços apontam para o docker compose local (ou para os serviços do CI).
 * Valores já definidos no ambiente ou no `.env` têm precedência, exceto os forçados abaixo.
 */
const DEFAULTS: Record<string, string> = {
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
  SESSION_SECRET: 'test-session-secret-com-pelo-menos-32-bytes',
  REPORTER_TOKEN_SECRET: 'test-reporter-token-secret-com-32-bytes-ou-mais',
};

/** Sempre aplicados: só fazem sentido no ambiente de teste. */
const FORCED: Record<string, string> = {
  NODE_ENV: 'test',
  // Custo mínimo do scrypt nos testes (FR-035). Fora de NODE_ENV=test o schema recusa este valor.
  PASSWORD_HASH_LOG_N: '10',
  // As suítes entram muitas vezes do mesmo IP e dividem o Redis: o limite de tentativas real fica no teste dele
  // (test/auth/rate-limit.e2e-spec.ts), com números próprios e prefixo exclusivo.
  AUTH_RATE_LIMIT_IP_LIMIT: '1000000',
  AUTH_RATE_LIMIT_ACCOUNT_LIMIT: '1000000',
};

export function applyTestEnv(): void {
  for (const [name, value] of Object.entries(DEFAULTS)) {
    process.env[name] ??= value;
  }
  Object.assign(process.env, FORCED);
}
