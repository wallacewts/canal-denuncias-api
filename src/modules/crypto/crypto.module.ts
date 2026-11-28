import { Module } from '@nestjs/common';
import { VaultModule } from '../../infra/vault/vault.module.js';

/**
 * Envelope encryption (AES-256-GCM) sobre o Vault Transit (contracts/crypto-module.md da feature 002).
 * Único caminho para cifrar e abrir conteúdo sensível. Os serviços entram em cada história da feature.
 */
@Module({
  imports: [VaultModule],
  providers: [],
  exports: [],
})
export class CryptoModule {}
