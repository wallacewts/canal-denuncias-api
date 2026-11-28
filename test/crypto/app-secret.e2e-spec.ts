import { KeyServiceRequestError } from '../../src/infra/vault/key-service.errors.js';
import { AppSecretService } from '../../src/modules/crypto/app-secret.service.js';
import { encryptionContext } from '../../src/modules/crypto/encryption-context.js';
import { newRecordId } from '../../src/modules/crypto/record-id.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** CRYPTO-05 / D42, contra o Vault local com o AppRole `api` (G1). */
describe('AppSecretService contra o Vault real (e2e)', () => {
  let t: TestApp;
  let svc: AppSecretService;

  beforeAll(async () => {
    t = await createTestApp({ vault: 'api' });
    svc = t.app.get(AppSecretService);
  });

  afterAll(async () => {
    await t.close();
  });

  it.each([
    ['curto', 'XQZ'],
    ['segredo TOTP', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'],
  ])('ida e volta (%s), e o valor guardado não contém o segredo', async (_caso, segredo) => {
    const ctx = encryptionContext('users.mfa_secret_enc', newRecordId());
    const before = t.logs.lines().length;
    const stored = await svc.seal(ctx, Buffer.from(segredo));
    expect(stored).toMatch(/^vault:v\d+:/);
    expect(stored).not.toContain(segredo);
    expect(stored).not.toContain(Buffer.from(segredo).toString('base64'));
    const opened = await svc.open(ctx, stored);
    expect(opened.toString()).toBe(segredo);
    opened.fill(0);
    expect(JSON.stringify(t.logs.lines().slice(before))).not.toContain(segredo);
  });

  it('não abre com o contexto de outro usuário, com erro de mensagem fixa', async () => {
    const stored = await svc.seal(encryptionContext('users.mfa_secret_enc', newRecordId()), Buffer.from('XQZ'));
    const otherCtx = encryptionContext('users.mfa_secret_enc', newRecordId());
    const error = await svc.open(otherCtx, stored).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeyServiceRequestError);
    expect((error as Error).message).toBe('Operação recusada pelo serviço de chaves');
    const text = [String(error), JSON.stringify(error), (error as Error).stack].join('\n');
    for (const s of ['XQZ', stored, otherCtx.aad.toString('utf8')]) expect(text).not.toContain(s);
  });

  it('só aceita contexto de segredo da aplicação', async () => {
    const reportCtx = encryptionContext('reports.content_enc', newRecordId());
    await expect(svc.seal(reportCtx, Buffer.from('XQZ'))).rejects.toThrow();
  });
});
