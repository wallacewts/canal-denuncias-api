/** Próxima etapa do login, no formato do contrato do front (feature 006, R2). */
export enum NextStep {
  MFA_REQUIRED = 'MFA_REQUIRED',
  MFA_ENROLLMENT_REQUIRED = 'MFA_ENROLLMENT_REQUIRED',
  PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED',
  DONE = 'DONE',
}

export interface StepState {
  /** Estado do segundo fator na sessão: `pending` (tem autenticador, falta o desafio), `verified` ou ausente. */
  mfa: 'pending' | 'verified' | null | undefined;
  /** Troca de senha obrigatória (`password_changed_at` nulo). */
  passwordChangeRequired: boolean;
}

/**
 * Calcula a etapa a cada resposta (nunca guardada). Com autenticador, o segundo fator vem antes da troca obrigatória
 * (Q2); sem autenticador, a troca (se obrigatória) vem antes do cadastro.
 */
export function nextStepFor({ mfa, passwordChangeRequired }: StepState): NextStep {
  if (mfa === 'pending') return NextStep.MFA_REQUIRED;
  if (passwordChangeRequired) return NextStep.PASSWORD_CHANGE_REQUIRED;
  return mfa === 'verified' ? NextStep.DONE : NextStep.MFA_ENROLLMENT_REQUIRED;
}
