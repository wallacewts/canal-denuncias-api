import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ReporterType } from '../../src/common/enums/reporter-type.enum.js';
import type { Role } from '../../src/common/enums/role.enum.js';
import type { KeyService } from '../../src/infra/vault/key-service.js';
import { Category } from '../../src/modules/catalog/entities/category.entity.js';
import type { ReportContentV1 } from '../../src/modules/reports/report-content.js';
import { Report } from '../../src/modules/reports/entities/report.entity.js';
import { User } from '../../src/modules/users/entities/user.entity.js';

/**
 * Formato dos campos cifrados definido na constituição (princípio III):
 * `[1 byte versão][12 bytes nonce][ciphertext][16 bytes tag GCM]`, AES-256-GCM, AAD `"<tabela>.<campo>:<id>"`.
 * Pendência I3 do analyze: quando a feature crypto existir, estas funções passam a usar o `CryptoService`.
 */
const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function encryptField(plaintext: Buffer, dek: Buffer, aad: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dek, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, ciphertext, cipher.getAuthTag()]);
}

export function decryptField(encrypted: Buffer, dek: Buffer, aad: string): Buffer {
  if (encrypted[0] !== FORMAT_VERSION) throw new Error('Versão de formato desconhecida');
  const nonce = encrypted.subarray(1, 1 + NONCE_BYTES);
  const tag = encrypted.subarray(encrypted.length - TAG_BYTES);
  const ciphertext = encrypted.subarray(1 + NONCE_BYTES, encrypted.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', dek, nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

let sequence = 0;
const unique = () => `${Date.now().toString(36)}${(sequence++).toString(36)}${randomBytes(2).toString('hex')}`;

/** Usuário da equipe com perfis. O hash é um marcador: o login real chega com a feature de auth. */
export async function createUser(
  ds: DataSource,
  options: { roles: Role[]; name?: string; email?: string } = { roles: [] },
): Promise<User> {
  const repo = ds.getRepository(User);
  const id = unique();
  const saved = await repo.save(
    repo.create({
      name: options.name ?? `Usuário ${id}`,
      email: options.email ?? `usuario.${id}@teste.local`,
      passwordHash: '$test$sem-login',
      roles: options.roles.map((role) => ({ role })),
    }),
  );
  return repo.findOneOrFail({ where: { id: saved.id }, relations: { roles: true } });
}

export async function createCategory(ds: DataSource, overrides: Partial<Category> = {}): Promise<Category> {
  const repo = ds.getRepository(Category);
  const code = `TESTE_${unique()}`.toUpperCase().slice(0, 40);
  return repo.save(repo.create({ code, name: `Categoria ${code}`, ...overrides }));
}

/**
 * Denúncia com o relato cifrado como a API vai gravar: DEK nova do serviço de chaves (report-kek), conteúdo em
 * AES-256-GCM com AAD `reports.content_enc:<id>` e a DEK protegida em `wrapped_dek`.
 */
export async function createEncryptedReport(
  ds: DataSource,
  keys: KeyService,
  content: ReportContentV1,
  overrides: Partial<Pick<Report, 'reporterType' | 'categoryId' | 'status'>> = {},
): Promise<{ report: Report }> {
  const [{ id }] = (await ds.query(`SELECT uuidv7() AS id`)) as Array<{ id: string }>;
  const categoryId = overrides.categoryId ?? (await createCategory(ds)).id;

  const dek = await keys.generateDataKey('report-kek');
  try {
    const contentEnc = encryptField(
      Buffer.from(JSON.stringify(content), 'utf8'),
      dek.plaintext,
      `reports.content_enc:${id}`,
    );
    const repo = ds.getRepository(Report);
    await repo.insert({
      id,
      protocol: `DV-${unique().toUpperCase().slice(0, 12)}`,
      accessKeyHash: '$test$sem-acesso',
      reporterType: overrides.reporterType ?? ReporterType.EMPLOYEE,
      categoryId,
      ...(overrides.status ? { status: overrides.status } : {}),
      wrappedDek: Buffer.from(dek.wrapped, 'utf8'),
      contentEnc,
    });
    return { report: await repo.findOneByOrFail({ id }) };
  } finally {
    dek.plaintext.fill(0);
  }
}
