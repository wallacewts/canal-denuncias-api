import { BadRequestException } from '@nestjs/common';
import type { ApiValidationIssue } from '../http/api-error.js';

/** Issue no formato Standard Schema (https://standardschema.dev), como o `StandardSchemaValidationPipe` entrega. */
export interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/** Campos extras que o zod acrescenta às issues do Standard Schema. */
type ZodLikeIssue = SchemaIssue & {
  code?: string;
  origin?: string;
  maximum?: number | bigint;
  minimum?: number | bigint;
  expected?: string;
  format?: string;
};

function pathOf(issue: SchemaIssue): string {
  return (issue.path ?? [])
    .map((segment) => (typeof segment === 'object' && segment !== null ? segment.key : segment))
    .map(String)
    .join('.');
}

function sizeMessage(kind: 'max' | 'min', issue: ZodLikeIssue): string {
  const limit = String(kind === 'max' ? issue.maximum : issue.minimum);
  const label = kind === 'max' ? 'Máximo' : 'Mínimo';
  switch (issue.origin) {
    case 'string':
      return `${label} de ${limit} caracteres`;
    case 'array':
    case 'set':
      return `${label} de ${limit} itens`;
    default:
      return `Valor ${kind === 'max' ? 'máximo' : 'mínimo'}: ${limit}`;
  }
}

/**
 * Converte as issues de validação em `{ path, code, message }` com mensagens fixas em português (FR-008).
 * Nunca usa a mensagem original da biblioteca: no zod, `unrecognized_keys` repete as chaves enviadas e outras
 * mensagens podem citar o que foi recebido. Só limites numéricos e tipos esperados entram no texto.
 */
export function mapValidationIssues(issues: readonly SchemaIssue[]): ApiValidationIssue[] {
  return issues.map((raw) => {
    const issue = raw as ZodLikeIssue;
    const code = issue.code ?? 'invalid';
    const path = pathOf(issue);
    switch (code) {
      case 'too_big':
        return { path, code, message: sizeMessage('max', issue) };
      case 'too_small':
        return { path, code, message: sizeMessage('min', issue) };
      case 'invalid_type':
        return { path, code, message: `Tipo inválido: esperado ${issue.expected ?? 'outro tipo'}` };
      case 'invalid_format':
        return {
          path,
          code,
          message: issue.format ? `Formato inválido: esperado ${issue.format}` : 'Formato inválido',
        };
      case 'unrecognized_keys':
        return { path, code, message: 'Campo não permitido' };
      case 'invalid_value':
        return { path, code, message: 'Valor não permitido' };
      default:
        return { path, code, message: 'Valor inválido' };
    }
  });
}

/** `exceptionFactory` do pipe global: o filtro de erros repassa a lista sem alterações. */
export function validationExceptionFactory(issues: readonly SchemaIssue[]): BadRequestException {
  return new BadRequestException({ message: mapValidationIssues(issues) });
}
