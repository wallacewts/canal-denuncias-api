import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Testes de integração usam Postgres, Redis, Vault e S3 reais (docker compose).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
