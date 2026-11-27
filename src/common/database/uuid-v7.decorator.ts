import { PrimaryColumn } from 'typeorm';

/** Chave primária UUID v7 gerada pelo próprio Postgres 18 (`uuidv7()`). */
export const UuidV7PrimaryColumn = (): PropertyDecorator => PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' });
