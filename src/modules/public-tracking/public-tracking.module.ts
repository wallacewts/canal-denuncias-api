import { Module } from '@nestjs/common';

/** Acesso anônimo do denunciante por protocolo + chave. Nunca registra IP. */
@Module({})
export class PublicTrackingModule {}
