import { Module } from '@nestjs/common';
import { ExampleAdminController } from './example-admin.controller.js';
import { ExamplePolicy } from './example.policy.js';
import { ExampleReportRepository } from './example.repository.js';

/**
 * Módulo de exemplo SÓ DE TESTE (nunca importado por `src/`): rotas e políticas de autorização da feature 004. O login
 * de exemplo virou o definitivo na feature 006 (`src/modules/auth/`).
 */
@Module({
  controllers: [ExampleAdminController],
  providers: [ExampleReportRepository, ExamplePolicy],
})
export class ExampleAuthModule {}
