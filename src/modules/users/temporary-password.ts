import { randomInt } from 'node:crypto';

/** Sem caracteres que se confundem ao ler ou ditar (0/O/o, 1/l/I): 8 dígitos + 24 maiúsculas + 24 minúsculas. */
export const TEMPORARY_PASSWORD_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';

const LENGTH = 20;

/**
 * Senha provisória do cadastro (feature 005, research R5): 20 caracteres de 56 símbolos (≈116 bits), muito acima da
 * política de senha. Exibida uma única vez; só o hash é guardado.
 */
export function generateTemporaryPassword(): string {
  let password = '';
  for (let i = 0; i < LENGTH; i++)
    password += TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)];
  return password;
}
