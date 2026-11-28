import { Injectable } from '@nestjs/common';
import { AuthenticationStorage } from '@nestjs/authentication';
import { PgMfaStore } from './stores/pg-mfa.store.js';
import { PgSessionStore } from './stores/pg-session.store.js';

/**
 * Registra os stores Postgres no pacote (definitivo, FR-023). Precisa ser um singleton que registra no construtor:
 * o registro fecha quando o módulo inicia. Em memória nunca: o módulo roda com `allowInMemoryStorage: false`.
 */
@Injectable()
export class AuthStorageRegistration {
  constructor(storage: AuthenticationStorage, sessions: PgSessionStore, mfa: PgMfaStore) {
    storage.registerSource({ sessions, mfa });
  }
}
