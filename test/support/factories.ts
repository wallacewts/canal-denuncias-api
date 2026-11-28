import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ReporterType } from '../../src/common/enums/reporter-type.enum.js';
import type { Role } from '../../src/common/enums/role.enum.js';
import { DataKeyService } from '../../src/modules/crypto/data-key.service.js';
import { encryptionContext } from '../../src/modules/crypto/encryption-context.js';
import { RecordCipher } from '../../src/modules/crypto/record-cipher.service.js';
import { newRecordId } from '../../src/modules/crypto/record-id.js';
import { Category } from '../../src/modules/catalog/entities/category.entity.js';
import type { ReportContentV1 } from '../../src/modules/reports/report-content.js';
import { Report } from '../../src/modules/reports/entities/report.entity.js';
import { User } from '../../src/modules/users/entities/user.entity.js';

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

/** Serviços do CryptoModule usados pelas factories (a mesma camada que os módulos usam). */
export interface CryptoDeps {
  dataKeys: DataKeyService;
  records: RecordCipher;
}

export function cryptoDeps(app: INestApplication): CryptoDeps {
  return { dataKeys: app.get(DataKeyService), records: app.get(RecordCipher) };
}

/**
 * Denúncia com o relato cifrado exatamente como a API vai gravar (pendência I3 da 001, resolvida na 002): id gerado
 * na aplicação, DEK nova da report-kek, conteúdo selado pelo `RecordCipher` com o contexto `reports.content_enc:<id>`
 * e só a DEK protegida em `wrapped_dek`. O Vault é chamado antes da gravação, nunca dentro de transação.
 */
export async function createEncryptedReport(
  ds: DataSource,
  crypto: CryptoDeps,
  content: ReportContentV1,
  overrides: Partial<Pick<Report, 'reporterType' | 'categoryId' | 'status'>> = {},
): Promise<{ report: Report }> {
  const id = newRecordId();
  const categoryId = overrides.categoryId ?? (await createCategory(ds)).id;
  const ctx = encryptionContext('reports.content_enc', id);
  const { result: contentEnc, wrapped } = await crypto.dataKeys.createReportKey((dek) =>
    crypto.records.sealJson(dek, ctx, content),
  );
  const repo = ds.getRepository(Report);
  await repo.insert({
    id,
    protocol: `DV-${unique().toUpperCase().slice(0, 12)}`,
    accessKeyHash: '$test$sem-acesso',
    reporterType: overrides.reporterType ?? ReporterType.EMPLOYEE,
    categoryId,
    ...(overrides.status ? { status: overrides.status } : {}),
    wrappedDek: Buffer.from(wrapped, 'utf8'),
    contentEnc,
  });
  return { report: await repo.findOneByOrFail({ id }) };
}
