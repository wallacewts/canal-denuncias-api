import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';
import { newRecordId } from './record-id.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newRecordId', () => {
  it('gera UUID v7 válido e único', () => {
    const ids = Array.from({ length: 200 }, () => newRecordId());
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ids gerados em sequência ordenam por tempo', async () => {
    const a = newRecordId();
    await new Promise((r) => setTimeout(r, 2));
    const b = newRecordId();
    expect(a < b).toBe(true);
  });

  it('é aceito pelo cursor de paginação da feature 001', () => {
    const id = newRecordId();
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });
});
