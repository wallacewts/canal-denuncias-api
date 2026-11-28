import { decodeBigintCursor, encodeBigintCursor } from './cursor-desc.js';

describe('cursor decrescente sobre id bigint', () => {
  it.each(['1', '42', '9007199254740993', '9223372036854775807'])('ida e volta de %s', (id) => {
    expect(decodeBigintCursor(encodeBigintCursor(id))).toBe(id);
  });

  it.each([
    ['curto', 'XQZ'],
    ['vazio', ''],
    ['caracteres fora do base64url', 'abc$def'],
    ['não canônico (zeros à esquerda)', Buffer.from('0042').toString('base64url')],
    ['não numérico', Buffer.from('12a').toString('base64url')],
    ['zero', Buffer.from('0').toString('base64url')],
    ['acima do bigint', Buffer.from('9223372036854775808').toString('base64url')],
  ])('recusa cursor %s', (_caso, cursor) => {
    expect(decodeBigintCursor(cursor)).toBeNull();
  });
});
