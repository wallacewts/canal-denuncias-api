import type { MigrationInterface, QueryRunner } from 'typeorm';

const CATEGORIES = [
  [
    'DATA_LEAK',
    'Vazamento de dados',
    'Dados da empresa, de clientes ou de colaboradores expostos ou acessados indevidamente.',
    1,
  ],
  [
    'BAD_SECURITY_PRACTICE',
    'Prática inadequada de segurança',
    'Senhas compartilhadas, acessos sem necessidade, dados guardados ou enviados sem proteção.',
    2,
  ],
  [
    'SUSPICIOUS_ACTIVITY',
    'Atividade suspeita',
    'Comportamento ou acesso fora do padrão que pode indicar um incidente.',
    3,
  ],
] as const;

/**
 * Valores padrão. Os prazos de retenção ainda precisam ser validados com o jurídico e o DPO
 * e podem ser alterados depois pela tela de Configurações.
 */
const SETTINGS: Record<string, unknown> = {
  'sla.triageHours': 72,
  'sla.investigationDays': 30,
  'reporter.replyDeadlineDays': 30,
  'identityReveal.windowMinutes': 30,
  'retention.invalidDays': 180,
  'retention.unsubstantiatedDays': 365,
  'retention.substantiatedDays': 1825,
};

export class SeedCatalog1795818449300 implements MigrationInterface {
  name = 'SeedCatalog1795818449300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, name, description, sortOrder] of CATEGORIES) {
      await queryRunner.query(`INSERT INTO categories (code, name, description, sort_order) VALUES ($1, $2, $3, $4)`, [
        code,
        name,
        description,
        sortOrder,
      ]);
    }
    for (const [key, value] of Object.entries(SETTINGS)) {
      await queryRunner.query(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)`, [key, JSON.stringify(value)]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM settings WHERE key = ANY($1)`, [Object.keys(SETTINGS)]);
    await queryRunner.query(`DELETE FROM categories WHERE code = ANY($1)`, [CATEGORIES.map(([code]) => code)]);
  }
}
