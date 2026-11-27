import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityRevealRequest } from './entities/identity-reveal-request.entity.js';
import { ReporterIdentity } from './entities/reporter-identity.entity.js';

/** Identidade lacrada do denunciante e fluxo de revelação com aprovação de outra pessoa. */
@Module({
  imports: [TypeOrmModule.forFeature([ReporterIdentity, IdentityRevealRequest])],
  exports: [TypeOrmModule],
})
export class IdentityVaultModule {}
