import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { Role } from '../../../common/enums/role.enum.js';
import { User } from './user.entity.js';

@Entity('user_roles')
export class UserRole {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @PrimaryColumn({ type: 'enum', enum: Role, enumName: 'role' })
  role: Role;

  @Column({ type: 'uuid', nullable: true })
  grantedById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  grantedAt: Date;

  @ManyToOne(() => User, (u) => u.roles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'granted_by_id' })
  grantedBy: Relation<User> | null;
}
