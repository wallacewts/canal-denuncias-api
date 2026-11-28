import { NextStep, nextStepFor } from './next-step.js';

/** Etapas do login (feature 006, R2, Q2): calculadas a cada resposta, nunca guardadas. */
describe('nextStepFor', () => {
  it.each([
    ['pendente, sem troca', 'pending', false, NextStep.MFA_REQUIRED],
    ['pendente, com troca (segundo fator antes, Q2)', 'pending', true, NextStep.MFA_REQUIRED],
    ['verificada, com troca', 'verified', true, NextStep.PASSWORD_CHANGE_REQUIRED],
    ['verificada, sem troca', 'verified', false, NextStep.DONE],
    ['sem MFA, com troca (primeiro acesso)', null, true, NextStep.PASSWORD_CHANGE_REQUIRED],
    ['sem MFA, sem troca', null, false, NextStep.MFA_ENROLLMENT_REQUIRED],
    ['sem MFA (undefined), sem troca', undefined, false, NextStep.MFA_ENROLLMENT_REQUIRED],
  ] as const)('%s', (_caso, mfa, passwordChangeRequired, expected) => {
    expect(nextStepFor({ mfa, passwordChangeRequired })).toBe(expected);
  });

  it('os códigos são os do contrato do front', () => {
    expect(Object.values(NextStep).sort()).toEqual([
      'DONE',
      'MFA_ENROLLMENT_REQUIRED',
      'MFA_REQUIRED',
      'PASSWORD_CHANGE_REQUIRED',
    ]);
  });
});
