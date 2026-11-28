import request from 'supertest';
import { DataSource } from 'typeorm';
import { PaginationFixtureModule } from '../support/fixtures/pagination-fixture.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

interface PageBody {
  items: Array<{ id: string; code: string }>;
  nextCursor: string | null;
}

describe('Paginação por cursor (e2e)', () => {
  let t: TestApp;
  let created = 0;

  async function insertCategories(count: number): Promise<void> {
    const ds = t.app.get(DataSource);
    for (let i = 0; i < count; i++) {
      created += 1;
      await ds.query(`INSERT INTO categories (code, name) VALUES ($1, $2)`, [`PAG_${created}`, `Categoria ${created}`]);
    }
  }

  const page = (query: string) => request(t.app.getHttpServer()).get(`/api/fixtures/pagination/categories${query}`);

  beforeAll(async () => {
    t = await createTestApp({ imports: [PaginationFixtureModule] });
    await insertCategories(25); // + 3 categorias da migration de seed = 28
  });

  afterAll(async () => {
    await t.close();
  });

  it('percorre todas as páginas sem repetir nem perder itens, com inserções no meio', async () => {
    const before = (await t.app.get(DataSource).query(`SELECT id FROM categories ORDER BY id`)) as Array<{
      id: string;
    }>;
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await page(`?limit=10${cursor ? `&after=${cursor}` : ''}`).expect(200);
      const body = res.body as PageBody;
      expect(body.items.length).toBeLessThanOrEqual(10);
      seen.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
      pages += 1;
      if (pages === 1) await insertCategories(5); // entram depois do último id existente
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length);
    for (const { id } of before) expect(seen).toContain(id);
    expect(seen).toEqual([...seen].sort());
  });

  it('a última página tem nextCursor nulo', async () => {
    const all = (await page('?limit=100').expect(200)).body as PageBody;
    expect(all.nextCursor).toBeNull();
    const last = all.items.at(-1)!;
    const res = await page(`?limit=1&after=${(await page(`?limit=${all.items.length - 1}`)).body.nextCursor}`).expect(
      200,
    );
    expect((res.body as PageBody).items.map((i) => i.id)).toEqual([last.id]);
    expect((res.body as PageBody).nextCursor).toBeNull();
  });

  it.each([['XQZ'], ['XQZ!'], ['%00XQZ']])('cursor adulterado %s responde 400 sem repetir o valor', async (after) => {
    const res = await page(`?after=${after}`).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('XQZ');
    expect(t.logs.text()).not.toContain('XQZ');
  });

  it.each([['0'], ['101']])('limit %s responde 400', async (limit) => {
    await page(`?limit=${limit}`).expect(400);
  });
});
