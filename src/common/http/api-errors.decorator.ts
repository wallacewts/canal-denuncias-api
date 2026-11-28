import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

/** Status de erro de uma rota → códigos estáveis (D56) que ela pode devolver, ou uma descrição sem código. */
export type ApiErrorMap = Partial<Record<400 | 401 | 403 | 404 | 409 | 422 | 423 | 429, readonly string[] | string>>;

/**
 * Documenta as respostas de erro de uma rota no OpenAPI, todas no formato `ApiError`. Os códigos entram na descrição
 * (`códigos: A, B`), que o teste de contrato com o front confere (feature 006, R12).
 */
export function ApiErrors(errors: ApiErrorMap): MethodDecorator {
  return applyDecorators(
    ...Object.entries(errors).map(([status, value]) => {
      const codes = Array.isArray(value) ? (value as string[]) : [];
      const description = typeof value === 'string' ? value : `códigos: ${codes.join(', ')}`;
      return ApiResponse({
        status: Number(status),
        description,
        schema: { $ref: '#/components/schemas/ApiError' },
      });
    }),
  );
}
