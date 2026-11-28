import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticationModule } from '@nestjs/authentication';
import { AuthorizationModule } from '@nestjs/authorization';
import type { Env } from '../../config/env.schema.js';
import { AuditModule } from '../../modules/audit/audit.module.js';
import { CryptoModule } from '../../modules/crypto/crypto.module.js';
import { AdminIdentityGuard } from './admin-identity.guard.js';
import { AUTH_CLOCK, systemClock, type AuthClock } from './auth-clock.js';
import { AUTH_IDENTITY } from './auth-identity.port.js';
import { AuthAuditSubscriber } from './auth-audit.subscriber.js';
import { AuthStorageRegistration } from './auth-storage.provider.js';
import { SessionAuthIdentity } from './session-auth-identity.js';
import { StaffSessionProvider } from './staff-session.provider.js';
import { PgMfaStore } from './stores/pg-mfa.store.js';
import { PgSessionStore } from './stores/pg-session.store.js';

/**
 * Autenticação e autorização (D53, D54, `contracts/auth-integration.md`):
 * - `@nestjs/authentication`: sessão por cookie no servidor (15 min sem uso, 8 h no máximo, `SameSite=Strict`), MFA
 *   TOTP com a cifragem local desligada (o `PgMfaStore` sela com o Vault), sem tokens de acesso nem de renovação, e
 *   nunca em memória;
 * - `@nestjs/authorization`: negação por padrão (importado depois do de autenticação: ordem dos guards globais);
 * - a porta de identidade da área administrativa (D47) e o seu guard.
 */
/** Fornece o relógio da autenticação (trocado nos testes por `overrides`). */
@Global()
@Module({ providers: [{ provide: AUTH_CLOCK, useValue: systemClock }], exports: [AUTH_CLOCK] })
export class AuthClockModule {}

/**
 * Guard da área administrativa (D47) num módulo próprio, importado DEPOIS dos módulos de autenticação e autorização:
 * os guards globais rodam na ordem em que os módulos são encontrados, e este precisa do usuário que o guard do pacote
 * deixa em `request.user`.
 */
@Module({
  providers: [
    { provide: AUTH_IDENTITY, useClass: SessionAuthIdentity },
    { provide: APP_GUARD, useClass: AdminIdentityGuard },
  ],
  exports: [AUTH_IDENTITY],
})
export class AdminAreaGuardModule {}

@Global()
@Module({
  imports: [
    CryptoModule,
    AuditModule,
    AuthClockModule,
    AuthenticationModule.forRootAsync({
      imports: [AuthClockModule],
      inject: [ConfigService, AUTH_CLOCK],
      useFactory: (config: ConfigService<Env, true>, clock: AuthClock) => ({
        session: {
          idleTtl: '15m',
          absoluteTtl: '8h',
          touchInterval: '1m',
          cookie: { sameSite: 'strict' },
          now: () => clock.now(),
        },
        mfa: {
          now: () => clock.now(),
          encryption: false,
          issuer: 'Canal de Denúncias',
          window: 1,
          maxAttempts: 5,
          lockoutWindow: '15m',
          recoveryCodes: 10,
          pendingTtl: '10m',
        },
        password: { logN: config.get('PASSWORD_HASH_LOG_N', { infer: true }) },
        allowInMemoryStorage: false,
      }),
    }),
    AuthorizationModule.forRoot(),
    AdminAreaGuardModule,
  ],
  providers: [PgSessionStore, PgMfaStore, AuthStorageRegistration, StaffSessionProvider, AuthAuditSubscriber],
  exports: [AdminAreaGuardModule, PgSessionStore, PgMfaStore],
})
export class AuthInfraModule {}
