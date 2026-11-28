/**
 * Chave do advisory lock que serializa as operações que podem mudar a quantidade de Administradores ativos: o
 * comando `create-admin` e as mudanças de status e perfis da feature 005 (research R3). "ADMN" em ASCII.
 */
export const ADMIN_LOCK = 0x41_44_4d_4e;
