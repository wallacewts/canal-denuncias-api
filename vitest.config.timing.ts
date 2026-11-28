import { defineConfig } from 'vitest/config';

/**
 * Teste de tempo constante da entrada (SC-002 da feature 006), isolado da suíte e2e: com outras suítes rodando em
 * paralelo, a carga da máquina vira ruído na medição. Roda sozinho, um arquivo por vez (`npm run test:timing`), como
 * passo próprio no CI. O limite de 10% da verificação de senha não muda.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.timing-spec.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
