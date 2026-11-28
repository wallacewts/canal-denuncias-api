import { z } from 'zod';
import { mapValidationIssues } from './validation-error.mapper.js';

const SEGREDO = 'RELATO-SECRETO-QUE-NAO-PODE-VOLTAR';

async function issuesFor(schema: z.ZodType, input: unknown) {
  const result = await schema['~standard'].validate(input);
  if (!('issues' in result) || !result.issues) throw new Error('o schema deveria falhar');
  return result.issues;
}

describe('mapValidationIssues', () => {
  const schema = z.strictObject({
    description: z.string().max(10),
    count: z.number().int(),
    id: z.uuid(),
    kind: z.enum(['A', 'B']),
  });

  it('devolve só { path, code, message } para cada issue', async () => {
    const mapped = mapValidationIssues(
      await issuesFor(schema, { description: SEGREDO, count: 'x', id: SEGREDO, kind: SEGREDO }),
    );
    for (const issue of mapped) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path']);
    }
    expect(mapped.map((i) => [i.path, i.code])).toEqual([
      ['description', 'too_big'],
      ['count', 'invalid_type'],
      ['id', 'invalid_format'],
      ['kind', 'invalid_value'],
    ]);
  });

  it('too_big informa o limite sem repetir o texto', async () => {
    const [issue] = mapValidationIssues(await issuesFor(z.strictObject({ d: z.string().max(10) }), { d: SEGREDO }));
    expect(issue).toEqual({ path: 'd', code: 'too_big', message: 'Máximo de 10 caracteres' });
  });

  it('invalid_type informa o tipo esperado sem repetir o valor', async () => {
    const [issue] = mapValidationIssues(await issuesFor(z.strictObject({ n: z.number() }), { n: SEGREDO }));
    expect(issue).toEqual({ path: 'n', code: 'invalid_type', message: 'Tipo inválido: esperado number' });
  });

  it('unrecognized_keys não lista as chaves enviadas', async () => {
    const mapped = mapValidationIssues(await issuesFor(z.strictObject({}), { [SEGREDO]: 1 }));
    expect(mapped).toEqual([{ path: '', code: 'unrecognized_keys', message: 'Campo não permitido' }]);
  });

  it('nenhuma saída contém o valor recebido', async () => {
    const mapped = mapValidationIssues(
      await issuesFor(schema, { description: SEGREDO, count: SEGREDO, id: SEGREDO, kind: SEGREDO, [SEGREDO]: 1 }),
    );
    expect(JSON.stringify(mapped)).not.toContain(SEGREDO);
  });
});
