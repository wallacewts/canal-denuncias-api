import { PasswordHasher } from '@nestjs/authentication';
import { Role } from '../../src/common/enums/role.enum.js';
import { createStaff } from '../contract/auth/example/auth-helpers.js';
import type { TestClock } from '../support/auth-clock.js';
import type { TestApp } from '../support/test-app.js';
import type { DataSource } from 'typeorm';
import { createAuthApp, signIn } from './support.js';

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * SC-002 nas rotas reais: e-mail inexistente e senha errada levam o mesmo tempo (diferença das medianas menor que 10%
 * da verificação de senha), com o custo do scrypt próximo do de produção (logN 14) e 20 tentativas de cada.
 */
describe('Entrada: tempo constante (e2e)', () => {
  let t: TestApp & { clock: TestClock; ds: DataSource };
  beforeAll(async () => {
    // Custo próximo do de produção só nesta suíte (o ambiente de teste usa logN 10).
    t = await createAuthApp(undefined, {
      overrides: [{ provide: PasswordHasher, useValue: new PasswordHasher({ logN: 14 }) }],
    });
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  it('diferença entre inexistente e senha errada < 10% da verificação de senha', async () => {
    const hasher = t.app.get(PasswordHasher);
    const accounts = [];
    for (let i = 0; i < 20; i++) accounts.push(await createStaff(t.app, [Role.ANALYST], { mfa: false }));
    const sample = await hasher.hash('qualquer-coisa');
    const verify: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await hasher.verify('outra-coisa', sample);
      verify.push(performance.now() - start);
    }
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < 20; i++) {
      let start = performance.now();
      await signIn(t.app, `ninguem.${i}@empresa.test`, 'senha-errada-qualquer').expect(401);
      unknown.push(performance.now() - start);
      start = performance.now();
      await signIn(t.app, accounts[i].email, 'senha-errada-qualquer').expect(401);
      wrong.push(performance.now() - start);
    }
    const diff = Math.abs(median(unknown) - median(wrong));
    process.stderr.write(
      `SC-002 (rotas reais): inexistente ${median(unknown).toFixed(1)} ms, senha errada ${median(wrong).toFixed(1)} ms, ` +
        `diferença ${diff.toFixed(1)} ms, verificação ${median(verify).toFixed(1)} ms\n`,
    );
    expect(diff).toBeLessThan(median(verify) * 0.1);
  }, 120_000);
});
