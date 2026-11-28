import { lockoutMinutes } from './lockout.js';

/** Bloqueio progressivo (feature 006, R3): base × 2^nível, com teto. */
describe('lockoutMinutes', () => {
  const config = { base: 15, max: 1440 };
  it.each([
    [0, 15],
    [1, 30],
    [2, 60],
    [6, 960],
    [7, 1440],
    [16, 1440],
  ])('nível %i → %i min', (level, minutes) => {
    expect(lockoutMinutes(level, config)).toBe(minutes);
  });

  it('respeita outra configuração', () => {
    expect(lockoutMinutes(3, { base: 1, max: 5 })).toBe(5);
    expect(lockoutMinutes(0, { base: 1, max: 5 })).toBe(1);
  });
});
