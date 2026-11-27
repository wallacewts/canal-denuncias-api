import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Parâmetros do sistema: sla.triageHours, retention.unsubstantiatedDays etc. */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ type: 'uuid', nullable: true })
  updatedById: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
