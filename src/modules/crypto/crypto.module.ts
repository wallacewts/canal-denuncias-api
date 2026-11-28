import { Module } from '@nestjs/common';
import { VaultModule } from '../../infra/vault/vault.module.js';
import { AppSecretService } from './app-secret.service.js';
import { DataKeyService } from './data-key.service.js';
import { RecordCipher } from './record-cipher.service.js';

/**
 * Envelope encryption (AES-256-GCM) sobre o Vault Transit (contracts/crypto-module.md da feature 002).
 * Único caminho para cifrar e abrir conteúdo sensível. O streaming de arquivos é exportado como funções em
 * `stream-cipher.ts` (`createEncryptStream`/`createDecryptStream`).
 */
@Module({
  imports: [VaultModule],
  providers: [DataKeyService, RecordCipher, AppSecretService],
  exports: [DataKeyService, RecordCipher, AppSecretService],
})
export class CryptoModule {}
