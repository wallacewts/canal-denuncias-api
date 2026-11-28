import { mapValidationIssues } from '../common/validation/validation-error.mapper.js';
import { envSchema, type Env } from './env.schema.js';

/**
 * Valida o ambiente para o `ConfigModule`. A mensagem de erro cita só o **nome** de cada variável e o motivo,
 * nunca o valor recebido (segredos e URLs com senha não podem ir para o log de inicialização).
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const mapped = mapValidationIssues(result.error.issues);
  const lines = result.error.issues.map((issue, i) => {
    const name = mapped[i]?.path || '(ambiente)';
    // Mensagens `custom` são escritas no próprio schema e nunca interpolam valores.
    const reason = issue.code === 'custom' ? issue.message : (mapped[i]?.message ?? 'inválida');
    return `  - ${name}: ${reason}`;
  });
  throw new Error(`Configuração de ambiente inválida:\n${lines.join('\n')}`);
}
