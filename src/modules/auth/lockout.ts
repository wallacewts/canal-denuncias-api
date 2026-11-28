/** Configuração do bloqueio progressivo (feature 006, R3), vinda do ambiente. */
export interface LockoutConfig {
  threshold: number;
  base: number;
  max: number;
}

/** Minutos do bloqueio no nível dado: base × 2^nível, com teto. Mesma regra do `UPDATE` atômico do repositório. */
export function lockoutMinutes(level: number, { base, max }: Pick<LockoutConfig, 'base' | 'max'>): number {
  return Math.min(base * 2 ** level, max);
}
