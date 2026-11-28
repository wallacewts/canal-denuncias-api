import { AsyncLocalStorage } from 'node:async_hooks';
import { ActorType } from '../../common/enums/actor-type.enum.js';

/** Quem está agindo na requisição, job ou comando atual. */
export interface ActorContext {
  readonly actorType: ActorType;
  readonly actorUserId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Registro feito fora de qualquer requisição, job ou comando conhecido (FR-011). Mensagem fixa. */
export class AuditActorUndetermined extends Error {
  override readonly name = 'AuditActorUndetermined';

  constructor() {
    super('Ator da auditoria indeterminado.');
  }
}

const storage = new AsyncLocalStorage<ActorContext>();

/**
 * Contexto do ator da auditoria (D46). Aberto só em três pontos: o interceptor das rotas (por área), `runAsSystem`
 * (jobs e comandos) e os testes. O `AuditService` lê daqui; nenhum módulo informa o ator.
 */
export const AuditContext = {
  run<T>(context: ActorContext, fn: () => T): T {
    return storage.run(Object.freeze({ ...context }), fn);
  },
  current(): ActorContext | null {
    return storage.getStore() ?? null;
  },
};

const SYSTEM: ActorContext = Object.freeze({
  actorType: ActorType.SYSTEM,
  actorUserId: null,
  ip: null,
  userAgent: null,
});

/** Roda `fn` com ator sistema (jobs agendados, comandos de linha de comando). */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return AuditContext.run(SYSTEM, fn);
}
