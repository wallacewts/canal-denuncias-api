/** Corpo de toda resposta de erro da API (contracts/error-response.schema.json). */
export interface ApiError {
  statusCode: number;
  error: string;
  /** Texto seguro ou, em erros de validação, a lista de `{ path, code, message }` sem valores recebidos. */
  message: string | ApiValidationIssue[];
  requestId: string;
}

export interface ApiValidationIssue {
  path: string;
  code: string;
  message: string;
}

/** Mensagens fixas. Nenhuma delas leva dado recebido na requisição. */
export const ERROR_MESSAGES = {
  internal: 'Erro interno. Tente novamente mais tarde.',
  unavailable: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
  invalidBody: 'Corpo da requisição inválido.',
  bodyTooLarge: 'Corpo da requisição grande demais.',
  unsupportedMediaType: 'Tipo de conteúdo não suportado.',
  notFound: 'Recurso não encontrado.',
  conflict: 'A operação conflita com um registro existente.',
  relatedConflict: 'A operação conflita com registros relacionados.',
} as const;
