import { Column, Entity } from 'typeorm';
import { UuidV7PrimaryColumn } from '../../../common/database/uuid-v7.decorator.js';

@Entity('categories')
export class Category {
  @UuidV7PrimaryColumn()
  id: string;

  /** DATA_LEAK, BAD_SECURITY_PRACTICE, SUSPICIOUS_ACTIVITY */
  @Column({ type: 'varchar', length: 40, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
