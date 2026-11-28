import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordPolicyResult =
  { ok: true } | { ok: false; reason: 'too_short' | 'too_long' | 'common'; message: string };

/** Lista local de senhas comuns (sem consulta externa). Copiada para dist/ pelo build (nest-cli.json). */
const COMMON_PASSWORDS = new Set(
  readFileSync(join(import.meta.dirname, 'common-passwords.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith('#')),
);

/**
 * Política de senha da equipe (AUTH-05): no mínimo 12 caracteres, no máximo 128, e fora da lista de senhas comuns.
 * Tamanho em caracteres (code points), não em bytes. As mensagens nunca repetem a senha.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const length = [...password.normalize('NFKC')].length;
  if (length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: 'too_short',
      message: `A senha precisa ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`,
    };
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: 'too_long', message: `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.` };
  }
  if (COMMON_PASSWORDS.has(password.normalize('NFKC').toLowerCase())) {
    return { ok: false, reason: 'common', message: 'Essa senha é comum demais. Escolha outra.' };
  }
  return { ok: true };
}
