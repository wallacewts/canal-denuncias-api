import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminIdentityGuard } from './admin-identity.guard.js';
import { AUTH_IDENTITY, NoAuthIdentity } from './auth-identity.port.js';

/** Porta de identidade (padrão: ninguém) e o guard global da área administrativa (D47). */
@Global()
@Module({
  providers: [
    { provide: AUTH_IDENTITY, useClass: NoAuthIdentity },
    { provide: APP_GUARD, useClass: AdminIdentityGuard },
  ],
  exports: [AUTH_IDENTITY],
})
export class AuthInfraModule {}
