import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';
import { ActorType } from '../../../common/enums/actor-type.enum.js';
import { ScanStatus } from '../../../common/enums/scan-status.enum.js';
import { Message } from '../../messages/entities/message.entity.js';
import { Report } from '../../reports/entities/report.entity.js';

/**
 * Metadados do anexo. O arquivo fica no storage S3, cifrado com a DEK da denúncia (um nonce por arquivo).
 * Nome original e metadados do arquivo nunca vão para o storage.
 */
@Entity('attachments')
@Index(['reportId'])
@Check('attachment_uploader_type', `"uploaded_by_type" IN ('REPORTER', 'STAFF')`)
@Check('attachment_size_positive', `"size_bytes" > 0`)
export class Attachment {
  @UuidV7PrimaryColumn()
  id: string;

  @Column({ type: 'uuid' })
  reportId: string;

  /** null = anexado no envio da denúncia */
  @Column({ type: 'uuid', nullable: true })
  messageId: string | null;

  @Column({ type: 'enum', enum: ActorType, enumName: 'actor_type' })
  uploadedByType: ActorType;

  /** UUID aleatório, sem relação com o conteúdo. */
  @Column({ type: 'varchar', unique: true })
  storageKey: string;

  @Column({ type: 'bytea' })
  originalNameEnc: Buffer;

  /** Validado pelo conteúdo real do arquivo, não pela extensão. */
  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'int' })
  sizeBytes: number;

  /** sha256 do arquivo cifrado (integridade). */
  @Column({ type: 'varchar', length: 64 })
  ciphertextHash: string;

  @Column({ type: 'enum', enum: ScanStatus, enumName: 'scan_status', default: ScanStatus.PENDING })
  scanStatus: ScanStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Report, (r) => r.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'report_id' })
  report: Relation<Report>;

  @ManyToOne(() => Message, (m) => m.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: Relation<Message> | null;
}
