import { createCipheriv, randomBytes } from 'node:crypto';
import { DecryptionFailedError, UnsupportedFormatError } from './crypto.errors.js';
import { encryptionContext } from './encryption-context.js';
import { openField, sealField } from './field-cipher.js';

const ID_A = '019a2f1f-709b-777e-8662-bc1280bce2a3';
const ID_B = '019a2f1f-709c-7aaa-8bbb-111122223333';
const dek = randomBytes(32);
const ctxA = encryptionContext('messages.body_enc', ID_A);

describe('field-cipher (formato v1)', () => {
  it.each([['XQZ'], [''], ['relato longo '.repeat(500)], ['acentuação e emoji 🔐']])('ida e volta: %#', (texto) => {
    const sealed = sealField(Buffer.from(texto, 'utf8'), dek, ctxA);
    expect(openField(sealed, dek, ctxA).toString('utf8')).toBe(texto);
  });

  it('tem o layout [versão][nonce 12][ciphertext][tag 16]', () => {
    const sealed = sealField(Buffer.from('XQZ'), dek, ctxA);
    expect(sealed[0]).toBe(1);
    expect(sealed.length).toBe(1 + 12 + 3 + 16);
  });

  it('não abre com o contexto de outro id, campo ou tabela', () => {
    const sealed = sealField(Buffer.from('XQZ'), dek, ctxA);
    for (const ctx of [
      encryptionContext('messages.body_enc', ID_B),
      encryptionContext('internal_notes.body_enc', ID_A),
      encryptionContext('reports.content_enc', ID_A),
    ]) {
      expect(() => openField(sealed, dek, ctx)).toThrow(DecryptionFailedError);
    }
  });

  it.each([
    ['nonce', 1],
    ['ciphertext', 13],
    ['tag', -1],
  ])('falha com um byte alterado no %s', (_parte, posicao) => {
    const sealed = sealField(Buffer.from('XQZ'), dek, ctxA);
    const i = posicao < 0 ? sealed.length + posicao : posicao;
    sealed[i] ^= 0x01;
    expect(() => openField(sealed, dek, ctxA)).toThrow(DecryptionFailedError);
  });

  it('falha com chave diferente', () => {
    const sealed = sealField(Buffer.from('XQZ'), dek, ctxA);
    expect(() => openField(sealed, randomBytes(32), ctxA)).toThrow(DecryptionFailedError);
  });

  it('versão desconhecida e tamanho impossível geram UnsupportedFormatError', () => {
    const sealed = sealField(Buffer.from('XQZ'), dek, ctxA);
    const v2 = Buffer.from(sealed);
    v2[0] = 2;
    expect(() => openField(v2, dek, ctxA)).toThrow(UnsupportedFormatError);
    expect(() => openField(sealed.subarray(0, 28), dek, ctxA)).toThrow(UnsupportedFormatError);
    expect(() => openField(Buffer.alloc(0), dek, ctxA)).toThrow(UnsupportedFormatError);
  });

  it('dois cifrados do mesmo texto com a mesma chave são diferentes', () => {
    const a = sealField(Buffer.from('XQZ'), dek, ctxA);
    const b = sealField(Buffer.from('XQZ'), dek, ctxA);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(1, 13).equals(b.subarray(1, 13))).toBe(false);
  });

  it('abre o formato que as factories da feature 001 gravavam (compatibilidade)', () => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(Buffer.from(`messages.body_enc:${ID_A}`, 'utf8'));
    const ct = Buffer.concat([cipher.update(Buffer.from('XQZ')), cipher.final()]);
    const legado = Buffer.concat([Buffer.from([1]), nonce, ct, cipher.getAuthTag()]);
    expect(openField(legado, dek, ctxA).toString()).toBe('XQZ');
  });

  it('o erro de abertura não carrega o texto, a chave nem o valor cifrado', () => {
    const sealed = sealField(Buffer.from('XQZ'), dek, ctxA);
    sealed[sealed.length - 1] ^= 0x01;
    try {
      openField(sealed, dek, ctxA);
      throw new Error('deveria falhar');
    } catch (e) {
      const text = [String(e), (e as Error).stack, JSON.stringify(e)].join('\n');
      for (const s of ['XQZ', dek.toString('hex'), dek.toString('base64'), sealed.toString('base64')]) {
        expect(text).not.toContain(s);
      }
      expect(e).not.toHaveProperty('cause');
    }
  });
});
