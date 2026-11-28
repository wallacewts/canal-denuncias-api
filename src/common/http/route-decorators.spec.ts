import { INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DECORATORS } from '@nestjs/swagger';
import { NoStoreInterceptor } from './no-store.interceptor.js';
import {
  AdminApi,
  ALLOW_DURING_PASSWORD_CHANGE_METADATA,
  AllowDuringPasswordChange,
  API_AREA_METADATA,
  PublicApi,
  STEP_ROUTE_METADATA,
  StepRoute,
} from './route-decorators.js';

@PublicApi('reports')
class PublicController {}

@AdminApi('reports')
class AdminController {}

describe('@PublicApi e @AdminApi', () => {
  it('@PublicApi monta /api/public/v1/<recurso> com a tag public', () => {
    // O prefixo global "api" é aplicado por setupApp.
    expect(Reflect.getMetadata(PATH_METADATA, PublicController)).toBe('public/v1/reports');
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, PublicController)).toEqual(['public']);
    expect(Reflect.getMetadata(API_AREA_METADATA, PublicController)).toBe('public');
  });

  it('@AdminApi monta /api/admin/v1/<recurso> com a tag admin', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminController)).toBe('admin/v1/reports');
    expect(Reflect.getMetadata(DECORATORS.API_TAGS, AdminController)).toEqual(['admin']);
    expect(Reflect.getMetadata(API_AREA_METADATA, AdminController)).toBe('admin');
  });

  it.each([PublicController, AdminController])('%o aplica o interceptor de no-store', (controller) => {
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, controller)).toContain(NoStoreInterceptor);
  });
});

describe('@StepRoute e @AllowDuringPasswordChange (feature 006, R2 e R11)', () => {
  class Steps {
    @StepRoute('PASSWORD_CHANGE_REQUIRED', 'DONE')
    change() {}

    @AllowDuringPasswordChange()
    me() {}
  }

  it('StepRoute guarda as etapas aceitas e abre a rota para sessão sem segundo fator', () => {
    const handler = Object.getOwnPropertyDescriptor(Steps.prototype, 'change')!.value as object;
    expect(Reflect.getMetadata(STEP_ROUTE_METADATA, handler)).toEqual(['PASSWORD_CHANGE_REQUIRED', 'DONE']);
    const keys = Reflect.getMetadataKeys(handler) as string[];
    // Autenticação sem exigir MFA verificado e autorização aberta a quem tem sessão.
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it('StepRoute sem etapas é erro de programação', () => {
    expect(() => StepRoute()).toThrow();
  });

  it('AllowDuringPasswordChange marca a rota', () => {
    const handler = Object.getOwnPropertyDescriptor(Steps.prototype, 'me')!.value as object;
    expect(Reflect.getMetadata(ALLOW_DURING_PASSWORD_CHANGE_METADATA, handler)).toBe(true);
  });
});
