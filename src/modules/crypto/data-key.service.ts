import { Inject, Injectable } from '@nestjs/common';
import { KEY_SERVICE, type KeyService } from '../../infra/vault/key-service.js';
import { ContentUnavailableError } from './crypto.errors.js';

const DEK_BYTES = 32;

/**
 * Chave de dados por denúncia (CRYPTO-02, R2). Único jeito de obter a DEK em claro: dentro de `fn`, numa cópia
 * própria (`Buffer.alloc`, fora do pool) que é zerada no `finally`, com sucesso ou com erro.
 *
 * Limites conhecidos da zeragem em Node: a resposta do Vault chega como JSON e a chave em base64 vive numa string
 * imutável até o coletor liberar; o OpenSSL copia a chave para o contexto nativo da cifra. A zeragem reduz a janela de
 * exposição; a proteção contra leitura de memória é operacional (sem core dump, sem `--inspect`, sem heap snapshot).
 *
 * Regra de uso (FR-009): chame antes de abrir a transação do banco. Nada de HTTP dentro de transação.
 */
@Injectable()
export class DataKeyService {
  constructor(@Inject(KEY_SERVICE) private readonly keys: KeyService) {}

  /** Gera a DEK de uma nova denúncia, executa `fn` com ela e devolve o resultado e a versão protegida. */
  async createReportKey<T>(fn: (dek: Buffer) => T | Promise<T>): Promise<{ result: T; wrapped: string }> {
    const { plaintext, wrapped } = await this.keys.generateDataKey('report-kek');
    return { result: await useKey(plaintext, fn), wrapped };
  }

  /** Abre a DEK guardada e executa `fn`. `wrapped` nulo (expurgado) gera `ContentUnavailableError` sem chamar o Vault. */
  async withReportKey<T>(wrapped: string | null | undefined, fn: (dek: Buffer) => T | Promise<T>): Promise<T> {
    if (!wrapped) throw new ContentUnavailableError();
    return useKey(await this.keys.decryptDataKey('report-kek', wrapped), fn);
  }
}

async function useKey<T>(source: Buffer, fn: (dek: Buffer) => T | Promise<T>): Promise<T> {
  const dek = Buffer.alloc(DEK_BYTES);
  try {
    if (source.length !== DEK_BYTES) throw new Error('Chave de dados com tamanho inválido');
    source.copy(dek);
  } finally {
    source.fill(0);
  }
  try {
    return await fn(dek);
  } finally {
    dek.fill(0);
  }
}
