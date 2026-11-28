import type { Request } from 'express';
import type { Role } from '../../common/enums/role.enum.js';

/** Membro da equipe autenticado na requisição atual. */
export interface StaffIdentity {
  userId: string;
  roles: Role[];
}

/**
 * Porta de identidade da área administrativa (D47). A feature de autenticação (AUTH-06) troca a implementação
 * padrão; até lá, ninguém é reconhecido e toda rota em `/api/admin` responde 401 (negado por padrão, princípio IV).
 */
export interface AuthIdentity {
  resolve(request: Request): Promise<StaffIdentity | null>;
}

export const AUTH_IDENTITY = Symbol('AUTH_IDENTITY');

/** Implementação padrão: nenhuma identidade. */
export class NoAuthIdentity implements AuthIdentity {
  resolve(): Promise<StaffIdentity | null> {
    return Promise.resolve(null);
  }
}
