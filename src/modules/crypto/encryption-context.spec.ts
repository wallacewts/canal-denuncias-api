import { ENCRYPTED_FIELDS, encryptionContext } from './encryption-context.js';

const ID = '019a2f1f-709b-777e-8662-bc1280bce2a3';
const ID2 = '019a2f1f-709c-7aaa-8bbb-111122223333';

describe('encryptionContext', () => {
  it.each(ENCRYPTED_FIELDS.filter((f) => f !== 'report_access_blocks.reason_enc'))(
    'monta "<tabela>.<campo>:<id>" em UTF-8 para %s',
    (field) => {
      const ctx = encryptionContext(field, ID);
      expect(ctx.field).toBe(field);
      expect(ctx.aad.toString('utf8')).toBe(`${field}:${ID}`);
    },
  );

  it('usa os dois ids, separados por ponto, na chave composta de report_access_blocks', () => {
    const ctx = encryptionContext('report_access_blocks.reason_enc', ID, ID2);
    expect(ctx.aad.toString('utf8')).toBe(`report_access_blocks.reason_enc:${ID}.${ID2}`);
  });

  it('recusa id que não é UUID (inclusive curto)', () => {
    expect(() => encryptionContext('messages.body_enc', 'XQZ')).toThrow();
    expect(() => encryptionContext('messages.body_enc', `${ID}x`)).toThrow();
    expect(() => encryptionContext('messages.body_enc', ID.toUpperCase().replace(/-/g, ''))).toThrow();
  });

  it('recusa quantidade errada de ids', () => {
    expect(() => encryptionContext('messages.body_enc', ID, ID2)).toThrow();
    expect(() => encryptionContext('report_access_blocks.reason_enc', ID)).toThrow();
  });

  it('recusa campo fora da lista, mesmo se o tipo for contornado', () => {
    expect(() => encryptionContext('reporter_identities.payload_enc' as never, ID)).toThrow();
    expect(() => encryptionContext('users.password_hash' as never, ID)).toThrow();
  });

  it('a mensagem de erro não repete o id recebido', () => {
    try {
      encryptionContext('messages.body_enc', 'XQZ');
    } catch (e) {
      expect((e as Error).message).not.toContain('XQZ');
    }
  });
});
