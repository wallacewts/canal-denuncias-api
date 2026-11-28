import { Module } from '@nestjs/common';
import { ExampleAuthController, ExampleCredentials } from './example-auth.controller.js';

/** Módulo de exemplo SÓ DE TESTE (nunca importado por `src/`): login, MFA, rotas protegidas e políticas. */
@Module({ controllers: [ExampleAuthController], providers: [ExampleCredentials] })
export class ExampleAuthModule {}
