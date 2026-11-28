# Contrato: storage (TRV-06)

```ts
interface StorageService {
  put(key: string, body: Readable, contentLength?: number): Promise<void>; // multipart em streaming
  get(key: string): Promise<Readable>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>; // DeleteObjects em lotes de até 1000
}
```

- As chaves são UUIDs aleatórios gerados pelo chamador, sem relação com o conteúdo.
- O conteúdo chega já cifrado (módulo attachments). O storage nunca vê dado em claro.
- O bucket é criado na inicialização só quando `NODE_ENV=development`.
