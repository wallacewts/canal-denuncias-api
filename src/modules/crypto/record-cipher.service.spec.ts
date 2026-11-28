import { randomBytes } from 'node:crypto';
import { ReportContentV1Schema, type ReportContentV1 } from '../reports/report-content.js';
import { ContentSchemaError, DecryptionFailedError } from './crypto.errors.js';
import { encryptionContext } from './encryption-context.js';
import { RecordCipher } from './record-cipher.service.js';

const ID_A = '019a2f1f-709b-777e-8662-bc1280bce2a3';
const ID_B = '019a2f1f-709c-7aaa-8bbb-111122223333';
const dek = randomBytes(32);
const rc = new RecordCipher();
const reportCtx = encryptionContext('reports.content_enc', ID_A);
const schemas = { 1: ReportContentV1Schema };

const completo: ReportContentV1 = {
  v: 1,
  description: 'XQZ',
  occurredOn: '2026-10',
  location: 'Filial Centro',
  affectedSystems: 'ERP',
  dataTypes: ['PERSONAL', 'CREDENTIALS'],
  involved: [{ name: 'Fulano', role: 'TI' }, {}],
  howKnown: 'Vi a planilha',
  evidenceNotes: 'print guardado',
};

function exposed(e: unknown): string {
  return [String(e), (e as Error).stack, JSON.stringify(e)].join('\n');
}

describe('RecordCipher', () => {
  it.each([
    ['mínimo', { v: 1, description: 'XQZ' } as ReportContentV1],
    ['completo', completo],
    ['data ISO', { v: 1, description: 'XQZ', occurredOn: '2026-10-05' } as ReportContentV1],
  ])('ReportContentV1 %s sela e abre igual, validado pelo schema', (_caso, content) => {
    const sealed = rc.sealJson(dek, reportCtx, content);
    expect(sealed.includes(Buffer.from('XQZ'))).toBe(false);
    expect(rc.openJson(dek, reportCtx, sealed, schemas)).toEqual(content);
  });

  it('versão fora do mapa gera ContentSchemaError', () => {
    const sealed = rc.sealJson(dek, reportCtx, { v: 2, description: 'XQZ' });
    expect(() => rc.openJson(dek, reportCtx, sealed, schemas)).toThrow(ContentSchemaError);
  });

  it.each([
    ['campo a mais', { v: 1, description: 'XQZ', extra: 'XQZ-EXTRA' }],
    ['descrição faltando', { v: 1 }],
    ['tipo de dado desconhecido', { v: 1, description: 'XQZ', dataTypes: ['XQZ-TIPO'] }],
    ['tipo de dado repetido', { v: 1, description: 'XQZ', dataTypes: ['PERSONAL', 'PERSONAL'] }],
    ['data em formato livre', { v: 1, description: 'XQZ', occurredOn: 'ontem XQZ' }],
    ['envolvido com campo a mais', { v: 1, description: 'XQZ', involved: [{ cpf: 'XQZ-CPF' }] }],
  ])('objeto fora do schema (%s) falha sem devolver parcial e sem as issues na mensagem', (_caso, value) => {
    const sealed = rc.sealJson(dek, reportCtx, value as { v: number; [field: string]: unknown });
    let error: unknown;
    try {
      rc.openJson(dek, reportCtx, sealed, schemas);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ContentSchemaError);
    expect(exposed(error)).not.toMatch(/XQZ|issues|invalid|expected/i);
  });

  it('texto sela e abre (vazio, curto e longo)', () => {
    const ctx = encryptionContext('messages.body_enc', ID_A);
    for (const texto of ['', 'XQZ', 'mensagem longa '.repeat(300)]) {
      expect(rc.openText(dek, ctx, rc.sealText(dek, ctx, texto))).toBe(texto);
    }
  });

  it('texto de uma mensagem não abre com o contexto de outra', () => {
    const sealed = rc.sealText(dek, encryptionContext('messages.body_enc', ID_A), 'XQZ');
    expect(() => rc.openText(dek, encryptionContext('messages.body_enc', ID_B), sealed)).toThrow(DecryptionFailedError);
  });
});
