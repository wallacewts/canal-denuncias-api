import { CreateBucketCommand, DeleteObjectsCommand, HeadBucketCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service.js';

function fakeClient(handler: (command: unknown) => unknown) {
  return { send: vi.fn(async (command: unknown) => handler(command)) };
}

const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });

describe('StorageService', () => {
  it('cria o bucket na inicialização quando configurado para isso (desenvolvimento)', async () => {
    const client = fakeClient((c) => {
      if (c instanceof HeadBucketCommand) throw notFound();
      return {};
    });
    await new StorageService(client as never, 'bucket-dev', { createBucketOnInit: true }).onModuleInit();
    expect(client.send.mock.calls.some(([c]) => c instanceof CreateBucketCommand)).toBe(true);
  });

  it('não toca no bucket na inicialização fora de desenvolvimento', async () => {
    const client = fakeClient(() => ({}));
    await new StorageService(client as never, 'bucket-prod', { createBucketOnInit: false }).onModuleInit();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('head devolve null para objeto inexistente e o tamanho para existente', async () => {
    const client = fakeClient((c) => {
      if (c instanceof HeadObjectCommand && (c.input as { Key: string }).Key === 'existe') return { ContentLength: 42 };
      throw notFound();
    });
    const storage = new StorageService(client as never, 'b', { createBucketOnInit: false });
    expect(await storage.head('existe')).toEqual({ size: 42 });
    expect(await storage.head('nao-existe')).toBeNull();
  });

  it('deleteMany apaga em lotes de até 1000 chaves', async () => {
    const client = fakeClient(() => ({ Errors: [] }));
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`);
    await new StorageService(client as never, 'b', { createBucketOnInit: false }).deleteMany(keys);
    const batches = client.send.mock.calls
      .map(([c]) => c)
      .filter((c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand)
      .map((c) => c.input.Delete!.Objects!.length);
    expect(batches).toEqual([1000, 1000, 500]);
  });

  it('deleteMany com lista vazia não chama o storage', async () => {
    const client = fakeClient(() => ({}));
    await new StorageService(client as never, 'b', { createBucketOnInit: false }).deleteMany([]);
    expect(client.send).not.toHaveBeenCalled();
  });
});
