import type { AuthClock } from '../../src/infra/auth/auth-clock.js';

/** Relógio controlável SÓ DE TESTE para a sessão e o MFA: `advance('15m')` sem esperar o tempo real. */
export class TestClock implements AuthClock {
  private current: number;

  constructor(start = Date.UTC(2026, 10, 28, 12, 0, 0)) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
