import { Can } from '@nestjs/authorization';
import { Get, Module, Param } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AdminApi } from '../../../src/common/http/route-decorators.js';
import { VaultAuth } from '../../../src/infra/vault/vault-auth.js';
import { VaultClient } from '../../../src/infra/vault/vault.client.js';
import { CryptoModule } from '../../../src/modules/crypto/crypto.module.js';
import { DataKeyService } from '../../../src/modules/crypto/data-key.service.js';
import { encryptionContext } from '../../../src/modules/crypto/encryption-context.js';
import { RecordCipher } from '../../../src/modules/crypto/record-cipher.service.js';
import { newRecordId } from '../../../src/modules/crypto/record-id.js';
import { ReportContentV1Schema } from '../../../src/modules/reports/report-content.js';

export type CryptoFailureMode =
  'ok' | 'wrong-context' | 'tampered' | 'unknown-version' | 'bad-schema' | 'corrupted-dek' | 'vault-down';

/**
 * Rota só de teste (US5): abre uma denúncia gravada e provoca, sob demanda, cada falha de criptografia. A resposta de
 * sucesso nunca devolve o conteúdo; as falhas chegam ao filtro global como em produção.
 */
@Can.Anyone()
@AdminApi('fixtures/crypto')
class CryptoFixtureController {
  private readonly offline = new DataKeyService(
    new VaultClient({
      addr: 'http://127.0.0.1:1',
      timeoutMs: 300,
      auth: new VaultAuth({ addr: 'http://127.0.0.1:1', token: 'offline', timeoutMs: 300 }),
    }),
  );

  constructor(
    private readonly dataKeys: DataKeyService,
    private readonly records: RecordCipher,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Get('reports/:id/:mode')
  async open(@Param('id') id: string, @Param('mode') mode: CryptoFailureMode): Promise<{ ok: true }> {
    const [row] = (await this.ds.query(`SELECT content_enc, wrapped_dek FROM reports WHERE id = $1`, [id])) as Array<{
      content_enc: Buffer;
      wrapped_dek: Buffer;
    }>;
    let sealed = Buffer.from(row.content_enc);
    let wrapped = row.wrapped_dek.toString('utf8');
    let ctx = encryptionContext('reports.content_enc', id);
    if (mode === 'wrong-context') ctx = encryptionContext('reports.content_enc', newRecordId());
    if (mode === 'tampered') sealed[sealed.length - 5] ^= 0x01;
    if (mode === 'unknown-version') sealed = Buffer.concat([Buffer.from([0x02]), sealed.subarray(1)]);
    if (mode === 'corrupted-dek') wrapped = `${wrapped.slice(0, -8)}AAAAAAA=`;
    const keys = mode === 'vault-down' ? this.offline : this.dataKeys;

    await keys.withReportKey(wrapped, (dek) => this.records.openJson(dek, ctx, sealed, { 1: ReportContentV1Schema }));
    return { ok: true };
  }
}

@Module({ imports: [CryptoModule], controllers: [CryptoFixtureController] })
export class CryptoFixtureModule {}
