import type { Role } from '../../common/enums/role.enum.js';
import type { UserStatus } from '../../common/enums/user-status.enum.js';

/**
 * Membro da equipe como os pacotes de autenticação e autorização o veem. Carregado do banco a cada requisição (junto
 * com a sessão, numa leitura): usuário desativado ou com perfil alterado vale na requisição seguinte (FR-012).
 */
export interface StaffUser {
  id: string;
  roles: Role[];
  status: UserStatus;
  /** Troca de senha obrigatória pendente (`password_changed_at` nulo; feature 006). */
  passwordChangeRequired?: boolean;
  /** A sessão desta requisição tem o segundo fator verificado (feature 006). */
  mfaVerified?: boolean;
}

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: StaffUser;
    sessionExtra: { user: StaffUser };
  }
}
