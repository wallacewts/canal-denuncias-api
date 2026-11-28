import { z } from 'zod';
import { addValidatedJob, jobPayloadSchema } from './job-payload.schema.js';

const ID = '0190a6e2-7c1b-7d3e-9f00-1a2b3c4d5e6f';

describe('jobPayloadSchema', () => {
  const schema = jobPayloadSchema({
    reportId: z.uuid(),
    kind: z.enum(['NEW_REPORT', 'STATUS_CHANGED']),
    attempt: z.number().int(),
    userId: z.uuid().optional(),
  });

  it('aceita UUID, enum e número', () => {
    expect(schema.parse({ reportId: ID, kind: 'NEW_REPORT', attempt: 1 })).toEqual({
      reportId: ID,
      kind: 'NEW_REPORT',
      attempt: 1,
    });
  });

  it.each([
    ['texto num campo de UUID', { reportId: 'abc', kind: 'NEW_REPORT', attempt: 1 }],
    ['texto fora do enum', { reportId: ID, kind: 'x', attempt: 1 }],
    ['campo extra com texto livre', { reportId: ID, kind: 'NEW_REPORT', attempt: 1, note: 'relato' }],
  ])('recusa %s', (_caso, data) => {
    expect(schema.safeParse(data).success).toBe(false);
  });

  it.each([
    ['z.string()', z.string()],
    ['z.string().max(10)', z.string().max(10)],
    ['z.email()', z.email()],
    ['z.object()', z.object({ text: z.string() })],
    ['z.array(z.string())', z.array(z.string())],
    ['z.any()', z.any()],
  ])('não permite declarar um job com campo %s', (_nome, field) => {
    expect(() => jobPayloadSchema({ field })).toThrow(/texto livre|não permitido/);
  });
});

describe('addValidatedJob', () => {
  const schema = jobPayloadSchema({ reportId: z.uuid() });

  it('valida o payload antes de enfileirar e usa o jobId informado', async () => {
    const add = vi.fn(async () => ({ id: 'x' }));
    await addValidatedJob({ add } as never, 'notify', schema, { reportId: ID }, { jobId: `notify.${ID}` });
    expect(add).toHaveBeenCalledWith('notify', { reportId: ID }, { jobId: `notify.${ID}` });
  });

  it('não enfileira payload inválido, e o erro não repete o valor', async () => {
    const add = vi.fn();
    const error = await addValidatedJob({ add } as never, 'notify', schema, { reportId: 'XQZRELATO' } as never).catch(
      (e: Error) => e,
    );
    expect(add).not.toHaveBeenCalled();
    expect(String((error as Error).message)).not.toContain('XQZRELATO');
  });
});
