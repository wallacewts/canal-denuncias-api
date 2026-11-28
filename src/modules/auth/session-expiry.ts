import type { SessionRecord } from '@nestjs/authentication';
import { SESSION_IDLE_TTL_MS, SESSION_TOUCH_INTERVAL_MS } from '../../infra/auth/session-policy.js';

export interface SessionExpiry {
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

/**
 * Horários de expiração informados ao front (feature 005 R7, feature 006): inatividade a partir do último uso como
 * fica gravado depois desta requisição (nunca depois do real, até 1 min antes) e absoluta do registro da sessão.
 */
export function sessionExpiry(session: Pick<SessionRecord, 'lastActiveAt' | 'expiresAt'>, now: number): SessionExpiry {
  const stored = session.lastActiveAt.getTime();
  const lastActive = now - stored >= SESSION_TOUCH_INTERVAL_MS ? now : stored;
  return {
    idleExpiresAt: new Date(lastActive + SESSION_IDLE_TTL_MS).toISOString(),
    absoluteExpiresAt: session.expiresAt.toISOString(),
  };
}
