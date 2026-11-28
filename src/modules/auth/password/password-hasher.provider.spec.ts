import { PasswordHasher } from '@nestjs/authentication';
import { passwordHasherProvider } from './password-hasher.provider.js';

describe('passwordHasherProvider', () => {
  const config = (logN: number) => ({ get: (key: string) => (key === 'PASSWORD_HASH_LOG_N' ? logN : undefined) });

  it('usa o PasswordHasher (scrypt) do @nestjs/authentication com o logN da configuração', async () => {
    const hasher = passwordHasherProvider.useFactory(config(10) as never) as PasswordHasher;
    expect(hasher).toBeInstanceOf(PasswordHasher);
    const hash = await hasher.hash('frase senha de teste longa');
    expect(hash).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$/);
    expect(await hasher.verify('frase senha de teste longa', hash)).toBe(true);
    expect(await hasher.verify('outra senha qualquer', hash)).toBe(false);
  });

  it('um hash feito com custo menor pede rehash no custo de produção', async () => {
    const cheap = passwordHasherProvider.useFactory(config(10) as never) as PasswordHasher;
    const prod = passwordHasherProvider.useFactory(config(17) as never) as PasswordHasher;
    expect(prod.needsRehash(await cheap.hash('frase senha de teste longa'))).toBe(true);
  });
});
