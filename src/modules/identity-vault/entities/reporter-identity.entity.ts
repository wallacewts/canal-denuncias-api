import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, type Relation } from 'typeorm';
import { Report } from '../../reports/entities/report.entity.js';

/** Identidade opcional do denunciante. Chave própria (identity-kek), separada da denúncia. */
@Entity('reporter_identities')
export class ReporterIdentity {
  @PrimaryColumn({ type: 'uuid' })
  reportId: string;

  @Column({ type: 'bytea', select: false })
  wrappedDek: Buffer;

  /** { name, contact, jobTitle } cifrado */
  @Column({ type: 'bytea', select: false })
  payloadEnc: Buffer;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToOne(() => Report, (r) => r.identity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: Relation<Report>;
}
