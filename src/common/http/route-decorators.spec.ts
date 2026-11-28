import { INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DECORATORS } from '@nestjs/swagger';
import { NoStoreInterceptor } from './no-store.interceptor.js';
import { AdminApi, API_AREA_METADATA, PublicApi } from './route-decorators.js';

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
