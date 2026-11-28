import { Writable } from 'node:stream';

export interface CapturedLogLine {
  level?: number;
  msg?: string;
  req?: { id?: string; method?: string; path?: string };
  [key: string]: unknown;
}

/**
 * Destino de log em memória para os testes de "não vazou no log" (FR-036).
 * Guarda cada linha bruta (para busca textual) e a versão interpretada (para filtrar por requisição).
 */
export class LogCapture extends Writable {
  private readonly raw: string[] = [];

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) this.raw.push(line);
    }
    callback();
  }

  /** Todas as linhas como texto bruto, na ordem em que foram escritas. */
  text(): string {
    return this.raw.join('\n');
  }

  lines(): CapturedLogLine[] {
    return this.raw.map((line) => {
      try {
        return JSON.parse(line) as CapturedLogLine;
      } catch {
        return { msg: line };
      }
    });
  }

  /** Linhas que pertencem a uma requisição (pelo `req.id`, que é o mesmo `requestId` das respostas de erro). */
  forRequest(requestId: string): CapturedLogLine[] {
    return this.lines().filter((line) => line.req?.id === requestId || line['reqId'] === requestId);
  }

  clear(): void {
    this.raw.length = 0;
  }
}
