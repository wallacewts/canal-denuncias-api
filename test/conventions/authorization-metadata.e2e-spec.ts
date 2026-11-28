import { Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AuditPolicy } from '../../src/modules/access-control/policies/audit.policy.js';
import { AUTHORIZATION_METADATA } from './admin-route-checks.js';

/**
 * Sentinela (US5, research R4): o teste de convenção lê as marcas do `@nestjs/authorization` e do
 * `@nestjs/authentication` por chaves que os pacotes não exportam. Se uma atualização mudar as chaves, este teste
 * quebra — em vez de o teste de convenção passar em branco sem enxergar nenhuma declaração.
 */
describe('Chaves de metadata da autorização (sentinela)', () => {
  it('@Can(), @Can.Anyone() e @Public() gravam onde o teste de convenção lê', () => {
    class Probe {
      @Can(AuditPolicy, 'read')
      declared() {}

      @Can.Anyone()
      anyone() {}

      @Public()
      open() {}
    }
    const { can, canAnyone, isPublic } = AUTHORIZATION_METADATA;
    // O metadado fica na própria função do método: lido pelo descritor, sem referenciar o método solto.
    const handler = (name: keyof Probe) => Object.getOwnPropertyDescriptor(Probe.prototype, name)!.value as object;
    expect(Reflect.getMetadata(can, handler('declared'))).toEqual([{ policy: AuditPolicy, ability: 'read' }]);
    expect(Reflect.getMetadata(canAnyone, handler('anyone'))).toBe(true);
    expect(Reflect.getMetadata(isPublic, handler('open'))).toBe(true);
    expect(Reflect.getMetadata(can, handler('anyone'))).toBeUndefined();
  });
});
