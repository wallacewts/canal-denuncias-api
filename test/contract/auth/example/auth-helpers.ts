import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MfaService, PasswordHasher } from '@nestjs/authentication';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { Role } from '../../../../src/common/enums/role.enum.js';

/** Apoio SÓ DE TESTE para os testes de contrato de autenticação. */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const ch of clean) bits += BASE32.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** TOTP RFC 6238 (SHA-1, 6 dígitos, 30 s), como os aplicativos autenticadores. */
export function totp(secret: string, nowMs: number, offsetSteps = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30_000) + offsetSteps));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}

export interface Staff {
  id: string;
  email: string;
  password: string;
  secret: string | null;
}

/** Cria um membro da equipe com senha (hash do pacote, D32), perfis e, opcionalmente, TOTP confirmado. */
export async function createStaff(
  app: INestApplication,
  roles: Role[],
  { mfa = true, nowMs = Date.now() }: { mfa?: boolean; nowMs?: number } = {},
): Promise<Staff> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const hasher = app.get(PasswordHasher);
  const password = `Senha-de-teste-${randomUUID()}`;
  const email = `${randomUUID()}@equipe.test`;
  const rows = (await ds.query(
    `INSERT INTO users (name, email, password_hash) VALUES ('Equipe', $1, $2) RETURNING id`,
    [email, await hasher.hash(password)],
  )) as Array<{ id: string }>;
  const id = rows[0].id;
  for (const role of roles) await ds.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
  let secret: string | null = null;
  if (mfa) {
    const mfaService = app.get(MfaService);
    const { uri } = await mfaService.enroll(id, email);
    secret = new URL(uri).searchParams.get('secret');
    if (!secret || !(await mfaService.confirm(id, totp(secret, nowMs)))) throw new Error('falha ao confirmar o TOTP');
  }
  return { id, email, password, secret };
}

/** Valor `nome=valor` do cookie de sessão da resposta, ou `null`. */
export function sessionCookie(res: request.Response): string | null {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const found = cookies.find((c) => c.startsWith('__Host-sid=') || c.startsWith('sid='));
  if (!found) return null;
  const pair = found.split(';')[0];
  return pair.endsWith('=') ? null : pair;
}

export function rawSetCookie(res: request.Response): string | undefined {
  return ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.includes('sid='));
}

/** Entra com senha e, se houver segredo, com o TOTP; devolve o cookie final. */
export async function signInFully(app: INestApplication, staff: Staff, nowMs: number, step = 0): Promise<string> {
  const server = app.getHttpServer();
  const first = await request(server)
    .post('/api/admin/v1/example-auth/sign-in')
    .send({ email: staff.email, password: staff.password })
    .expect(200);
  let cookie = sessionCookie(first);
  if (!cookie) throw new Error('sem cookie de sessão');
  if (staff.secret) {
    const second = await request(server)
      .post('/api/admin/v1/example-auth/mfa')
      .set('Cookie', cookie)
      .send({ code: totp(staff.secret, nowMs, step) })
      .expect(200);
    cookie = sessionCookie(second) ?? cookie;
  }
  return cookie;
}

/** Espera os registros de auditoria (gravados de forma assíncrona a partir dos eventos). */
export async function waitForAudit(
  app: INestApplication,
  userId: string,
  action: string,
  timeoutMs = 3_000,
): Promise<Array<{ metadata: unknown; result: string; ip: string | null }>> {
  const ds = app.get<DataSource>(getDataSourceToken());
  const end = Date.now() + timeoutMs;
  for (;;) {
    const rows = (await ds.query(
      `SELECT metadata, result::text, host(ip) AS ip FROM audit_logs WHERE actor_user_id = $1 AND action = $2`,
      [userId, action],
    )) as Array<{ metadata: unknown; result: string; ip: string | null }>;
    if (rows.length > 0 || Date.now() > end) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
}
