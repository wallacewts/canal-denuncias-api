import { Module } from '@nestjs/common';
import { ExampleAdminController } from './example-admin.controller.js';
import { ExampleAuthController, ExampleCredentials } from './example-auth.controller.js';
import { ExamplePolicy } from './example.policy.js';
import { ExampleReportRepository } from './example.repository.js';

/** Módulo de exemplo SÓ DE TESTE (nunca importado por `src/`): login, MFA, rotas protegidas e políticas. */
@Module({
  controllers: [ExampleAuthController, ExampleAdminController],
  providers: [ExampleCredentials, ExampleReportRepository, ExamplePolicy],
})
export class ExampleAuthModule {}
