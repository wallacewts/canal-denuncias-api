import { decodeCursor, encodeCursor } from './cursor.js';
import { pageQuerySchema } from './page.schema.js';

const ID = '0190a6e2-7c1b-7d3e-9f00-1a2b3c4d5e6f';

describe('cursor de paginação', () => {
  it('codifica o UUID em base64url opaco e decodifica de volta', () => {
    const cursor = encodeCursor(ID);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(cursor).not.toContain(ID.slice(0, 8));
    expect(decodeCursor(cursor)).toBe(ID);
  });

  it.each(['', 'X', 'XQZ!', 'não-é-base64', encodeCursor(ID).slice(0, 10), `${encodeCursor(ID)}AA`])(
    'cursor adulterado %j é recusado',
    (cursor) => {
      expect(decodeCursor(cursor)).toBeNull();
    },
  );
});

describe('pageQuerySchema', () => {
  const parse = (input: unknown) => pageQuerySchema.safeParse(input);

  it('limite padrão 20 e sem cursor', () => {
    expect(parse({})).toMatchObject({ success: true, data: { limit: 20 } });
  });

  it('converte limit da query string e aceita até 100', () => {
    expect(parse({ limit: '100' })).toMatchObject({ success: true, data: { limit: 100 } });
  });

  it.each(['0', '101', '-1', '1.5', 'abc'])('recusa limit %s', (limit) => {
    expect(parse({ limit }).success).toBe(false);
  });

  it('decodifica o cursor válido e recusa o adulterado', () => {
    expect(parse({ after: encodeCursor(ID) })).toMatchObject({ success: true, data: { after: ID } });
    expect(parse({ after: 'XQZ!' }).success).toBe(false);
  });

  it('recusa parâmetros desconhecidos', () => {
    expect(parse({ offset: '10' }).success).toBe(false);
  });
});
