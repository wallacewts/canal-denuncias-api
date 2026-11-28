/**
 * Tempos da sessão da equipe (D53), em milissegundos. Fonte única para a configuração do pacote e para os horários
 * de expiração que o `GET /me` informa (feature 005, research R7).
 */
export const SESSION_IDLE_TTL_MS = 15 * 60_000;
export const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60_000;
/** O último uso é gravado no máximo uma vez por este intervalo. */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;
