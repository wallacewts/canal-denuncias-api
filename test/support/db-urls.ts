import { existsSync } from 'node:fs';

/** Carrega o `.env` local, se existir. No CI as variáveis já vêm do ambiente e têm precedência. */
export function loadLocalEnv(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

/** Mesma URL de conexão, apontando para outro banco. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Defina ${name} para rodar os testes de integração (veja .env.example)`);
  }
  return value;
}

export const TEMPLATE_DATABASE = 'canal_test_template';
export const SUITE_DATABASE_PREFIX = 'canal_test_s_';
