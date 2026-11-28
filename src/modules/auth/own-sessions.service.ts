import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SessionService, SignInService, type SessionRecord } from '@nestjs/authentication';
import { HMAC_KEYS, hmacHex, type HmacKeys } from '../../infra/auth/hmac-keys.js';
import type { OwnSession } from './auth.schemas.js';

/**
 * Sessões da própria pessoa (AUTH-02, feature 006, R13). Cada sessão aparece com um id público derivado por HMAC
 * (chave `session-public-id`): nunca o valor do cookie nem o id interno. Encerrar uma sessão de outra pessoa (ou que
 * não existe) responde 404, sem revelar nada.
 */
@Injectable()
export class OwnSessionsService {
  constructor(
    private readonly sessions: SessionService,
    private readonly signIn: SignInService,
    @Inject(HMAC_KEYS) private readonly keys: HmacKeys,
  ) {}

  async list(userId: string, currentId: string): Promise<OwnSession[]> {
    const live = await this.sessions.list(userId);
    return live.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((s) => this.view(s, currentId));
  }

  async revoke(userId: string, publicId: string): Promise<void> {
    const target = (await this.sessions.list(userId)).find((s) => this.publicId(s.id) === publicId);
    if (!target || !(await this.sessions.revoke(target.id, { userId }))) {
      throw new NotFoundException('Sessão não encontrada.');
    }
  }

  /** Encerra todas, inclusive a atual (o cookie é apagado; o pacote grava `AUTH_SESSION_REVOKED`). */
  async revokeAll(userId: string): Promise<void> {
    await this.signIn.signOutEverywhere(userId);
  }

  private publicId(sessionId: string): string {
    return hmacHex(this.keys['session-public-id'], sessionId).slice(0, 32);
  }

  private view(s: SessionRecord, currentId: string): OwnSession {
    const metadata = (s.metadata ?? {}) as { ip?: unknown; userAgent?: unknown };
    return {
      id: this.publicId(s.id),
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      ip: typeof metadata.ip === 'string' ? metadata.ip : null,
      userAgent: typeof metadata.userAgent === 'string' ? metadata.userAgent : null,
      current: s.id === currentId,
    };
  }
}
