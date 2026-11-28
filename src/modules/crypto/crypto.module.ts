import { Module } from '@nestjs/common';
import { VaultModule } from '../../infra/vault/vault.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AppSecretService } from './app-secret.service.js';
import { DataKeyService } from './data-key.service.js';
import { RecordCipher } from './record-cipher.service.js';
import { RewrapService } from './rewrap.service.js';

/**
 * Envelope encryption (AES-256-GCM) sobre o Vault Transit (contracts/crypto-module.md da feature 002).
 * Único caminho para cifrar e abrir conteúdo sensível. O streaming de arquivos é exportado como funções em
 * `stream-cipher.ts` (`createEncryptStream`/`createDecryptStream`).
 */
@Module({
  imports: [VaultModule, AuditModule],
  providers: [DataKeyService, RecordCipher, AppSecretService, RewrapService],
  exports: [DataKeyService, RecordCipher, AppSecretService, RewrapService],
})
export class CryptoModule {}
