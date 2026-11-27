import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InternalNote } from './entities/internal-note.entity.js';
import { ReportAccessBlock } from './entities/report-access-block.entity.js';
import { ReportAssignment } from './entities/report-assignment.entity.js';
import { ReportStatusHistory } from './entities/report-status-history.entity.js';

/** Triagem, atribuição, máquina de estados, notas internas e conflito de interesse. */
@Module({
  imports: [TypeOrmModule.forFeature([ReportStatusHistory, ReportAssignment, ReportAccessBlock, InternalNote])],
  exports: [TypeOrmModule],
})
export class CaseManagementModule {}
