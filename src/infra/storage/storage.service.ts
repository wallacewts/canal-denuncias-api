import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NotFoundException, type OnModuleInit } from '@nestjs/common';

const DELETE_BATCH = 1000;

/** Objeto inexistente. A mensagem é fixa: não cita a chave nem o bucket. */
export class StorageObjectNotFoundError extends NotFoundException {
  constructor() {
    super('Arquivo não encontrado.');
    this.name = 'StorageObjectNotFoundError';
  }
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.name === 'NoSuchBucket' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

export interface StorageServiceOptions {
  /** Só em desenvolvimento: cria o bucket na inicialização se ele não existir. */
  createBucketOnInit: boolean;
}

/**
 * Storage S3-compatível em streaming (TRV-06, D29). As chaves são UUIDs aleatórios gerados por quem chama, e o
 * conteúdo chega já cifrado (módulo attachments): o storage nunca vê dado em claro.
 */
export class StorageService implements OnModuleInit {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly bucket: string,
    private readonly options: StorageServiceOptions,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.options.createBucketOnInit) await this.ensureBucket();
  }

  /** Grava em multipart, em fluxo contínuo: o arquivo nunca é montado inteiro em memória. */
  async put(key: string, body: Readable, contentLength?: number): Promise<void> {
    await new Upload({
      client: this.client as S3Client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
      },
    }).done();
  }

  async get(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body as Readable;
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError();
      throw error;
    }
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(res.ContentLength ?? 0) };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteMany(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (res.Errors && res.Errors.length > 0) {
        throw new Error(`Falha ao apagar ${res.Errors.length} de ${batch.length} arquivos do storage`);
      }
    }
  }

  async bucketExists(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async ensureBucket(): Promise<void> {
    if (!(await this.bucketExists())) await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
  }

  /** Só para os testes de integração: esvazia e remove o bucket da execução. */
  async dropBucketForTests(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') throw new Error('dropBucketForTests só pode rodar com NODE_ENV=test');
    if (!(await this.bucketExists())) return;
    const listed = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket }));
    await this.deleteMany((listed.Contents ?? []).map((o) => o.Key!).filter(Boolean));
    await this.client.send(new DeleteBucketCommand({ Bucket: this.bucket }));
  }
}
