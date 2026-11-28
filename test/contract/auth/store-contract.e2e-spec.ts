import type { MfaStore, SessionRecord, SessionStore } from '@nestjs/authentication';
import { authenticationStoreContract } from '@nestjs/authentication/testing';
import type { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PgMfaStore } from '../../../src/infra/auth/stores/pg-mfa.store.js';
import { PgSessionStore } from '../../../src/infra/auth/stores/pg-session.store.js';
import { createTestApp, type TestApp } from '../../support/test-app.js';

/**
 * Contrato do próprio pacote (`authenticationStoreContract`, com concorrência) contra os stores Postgres definitivos
 * (T004). O contrato gera ids de usuário como `user-<uuid>`; aqui um adaptador SÓ DE TESTE troca esse formato pelo
 * uuid e garante a linha em `users` (a FK é real), devolvendo o formato original. Os stores não são alterados.
 */
const PREFIX = 'user-';
const toDb = (userId: string) => (userId.startsWith(PREFIX) ? userId.slice(PREFIX.length) : userId);
const fromDb = (userId: string) => `${PREFIX}${userId}`;

describe('Contrato dos stores Postgres (e2e)', () => {
  let t: TestApp;
  let ds: DataSource;
  let sessions: SessionStore;
  let mfa: MfaStore;

  const ensureUser = async (userId: string) => {
    const id = toDb(userId);
    await ds.query(
      `INSERT INTO users (id, name, email, password_hash) VALUES ($1, 'Contrato', $2, 'x') ON CONFLICT DO NOTHING`,
      [id, `${id}@contract.test`],
    );
    return id;
  };

  const mapRecord = (r: SessionRecord | undefined) => (r ? { ...r, userId: fromDb(r.userId) } : r);

  const sessionAdapter = (): SessionStore => ({
    getSession: async (id) => mapRecord(await sessions.getSession(id)),
    createSession: async (record) => sessions.createSession({ ...record, userId: await ensureUser(record.userId) }),
    touchSession: (id, at) => sessions.touchSession(id, at),
    deleteSession: (id) => sessions.deleteSession(id),
    listUserSessions: async (userId) =>
      (await sessions.listUserSessions(await ensureUser(userId))).map((r) => mapRecord(r) as SessionRecord),
    deleteUserSessions: async (userId) => sessions.deleteUserSessions(await ensureUser(userId)),
  });

  const mfaAdapter = (): MfaStore => ({
    getTotp: async (u) => mfa.getTotp(await ensureUser(u)),
    saveTotp: async (u, record) => mfa.saveTotp(await ensureUser(u), record),
    claimTotpStep: async (u, step) => mfa.claimTotpStep(await ensureUser(u), step),
    saveRecoveryCodes: async (u, hashes) => mfa.saveRecoveryCodes(await ensureUser(u), hashes),
    consumeRecoveryCode: async (u, hash) => mfa.consumeRecoveryCode(await ensureUser(u), hash),
    countRecoveryCodes: async (u) => mfa.countRecoveryCodes(await ensureUser(u)),
    recordMfaFailure: async (u, w, now) => mfa.recordMfaFailure(await ensureUser(u), w, now),
    countMfaFailures: async (u, w, now) => mfa.countMfaFailures(await ensureUser(u), w, now),
    clearMfaFailures: async (u) => mfa.clearMfaFailures(await ensureUser(u)),
  });

  beforeAll(async () => {
    t = await createTestApp({ vault: 'api' });
    ds = t.app.get<DataSource>(getDataSourceToken());
    sessions = t.app.get(PgSessionStore);
    mfa = t.app.get(PgMfaStore);
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  const cases = authenticationStoreContract(() => ({ sessions: sessionAdapter(), mfa: mfaAdapter() }), {
    contracts: ['sessions', 'mfa'],
    concurrent: true,
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    await c.run();
  });
});
