import { Controller, Get, Inject, Module } from '@nestjs/common';
import { KEY_SERVICE, type KeyService } from '../../../src/infra/vault/key-service.js';
import { VaultModule } from '../../../src/infra/vault/vault.module.js';

/** Rota só de teste que depende do serviço de chaves. */
@Controller('fixtures/key-service')
class KeyServiceFixtureController {
  constructor(@Inject(KEY_SERVICE) private readonly keys: KeyService) {}

  @Get('datakey')
  async datakey() {
    const dek = await this.keys.generateDataKey('report-kek');
    dek.plaintext.fill(0);
    return { ok: true };
  }
}

@Module({ imports: [VaultModule], controllers: [KeyServiceFixtureController] })
export class KeyServiceFixtureModule {}
