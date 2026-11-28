import { defineConfig } from 'vitest/config';

/**
 * Cobertura combinada (unitários + integração). Parte do código só é exercitada contra os serviços reais (Vault,
 * Redis, S3, Postgres), então a cobertura vale para as duas suítes juntas. Uso: npm run test:cov:all
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    globalSetup: ['test/support/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/cli.ts', 'src/database/migrations/**'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        'src/common/**': { lines: 80, functions: 80, statements: 80, branches: 70 },
        'src/infra/**': { lines: 80, functions: 80, statements: 80, branches: 70 },
        'src/infra/auth/**': { lines: 80, functions: 80, statements: 80, branches: 70 },
        'src/modules/crypto/**': { lines: 80, functions: 80, statements: 80, branches: 70 },
        'src/modules/audit/**': { lines: 80, functions: 80, statements: 80, branches: 70 },
      },
    },
  },
});
