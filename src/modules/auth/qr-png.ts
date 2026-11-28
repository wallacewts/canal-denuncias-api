import { crc32, deflateSync } from 'node:zlib';
import { encode } from 'uqr';

/** Pixels por módulo e margem em módulos (a margem de 4 é a recomendada pela norma do QR code). */
export const QR_SCALE = 6;
export const QR_BORDER = 4;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(typeBytes)));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * QR code da URI de configuração do autenticador como PNG embutido (feature 006, R5): a matriz vem do `uqr` (sem
 * dependências) e o PNG é montado aqui com `node:zlib` (1 bit, tons de cinza, sem entrelaçamento). Nada sai do servidor.
 */
export function qrPngDataUri(text: string): string {
  const qr = encode(text, { ecc: 'M', border: QR_BORDER });
  const size = qr.size * QR_SCALE;
  const rowBytes = Math.ceil(size / 8);
  const raw = Buffer.alloc((rowBytes + 1) * size, 0);
  for (let y = 0; y < size; y++) {
    const row = y * (rowBytes + 1);
    raw[row] = 0; // filtro nenhum
    for (let x = 0; x < size; x++) {
      // Bit 1 = branco, 0 = preto (tons de cinza de 1 bit).
      if (!qr.data[Math.floor(y / QR_SCALE)][Math.floor(x / QR_SCALE)]) raw[row + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 1; // profundidade de bit
  ihdr[9] = 0; // tons de cinza
  const png = Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}
