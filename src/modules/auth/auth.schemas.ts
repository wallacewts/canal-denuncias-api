import { z } from 'zod';
import { strictObject, text } from '../../common/validation/schemas.js';
import { NextStep } from './next-step.js';

/** Entrada e respostas do login (contracts/auth-api.md, contrato do front). Mensagens fixas, sem valor recebido. */

export const signInSchema = strictObject({
  email: text({ max: 254 }).trim().min(1),
  password: text({ min: 1, max: 256 }),
});
export type SignInInput = z.infer<typeof signInSchema>;

const code = text({ min: 1, max: 16 });
const recoveryCode = text({ min: 1, max: 64 });

/** `{ code }` ou `{ recoveryCode }`, nunca os dois nem nenhum. */
export const challengeSchema = z.union([strictObject({ code }), strictObject({ recoveryCode })]);
export type ChallengeInput = z.infer<typeof challengeSchema>;

export const enrollmentConfirmationSchema = strictObject({ code });

export const passwordChangeSchema = strictObject({
  currentPassword: text({ min: 1, max: 256 }),
  newPassword: text({ min: 1, max: 256 }),
});
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

const isoDate = () => z.iso.datetime();

export const stepResponseSchema = z.strictObject({
  nextStep: z.enum(NextStep),
  idleExpiresAt: isoDate(),
  absoluteExpiresAt: isoDate(),
});
export type StepResponse = z.infer<typeof stepResponseSchema>;

export const enrollmentResponseSchema = z.strictObject({
  otpauthUri: z.string().startsWith('otpauth://totp/').max(2048),
  qrCodeDataUri: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
  secret: z
    .string()
    .regex(/^[A-Z2-7]+=*$/)
    .max(128),
});
export type EnrollmentResponse = z.infer<typeof enrollmentResponseSchema>;

export const confirmationResponseSchema = z.strictObject({
  recoveryCodes: z.array(z.string().max(64)).length(10),
  ...stepResponseSchema.shape,
});
export type ConfirmationResponse = z.infer<typeof confirmationResponseSchema>;

export const ownSessionSchema = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  createdAt: isoDate(),
  lastActiveAt: isoDate(),
  ip: z.string().max(64).nullable(),
  userAgent: z.string().max(255).nullable(),
  current: z.boolean(),
});
export type OwnSession = z.infer<typeof ownSessionSchema>;
