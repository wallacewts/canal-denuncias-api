import { Body, Controller, HttpCode, Module, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { strictObject, text } from '../../../src/common/validation/schemas.js';

export const fixtureBodySchema = strictObject({
  description: text({ max: 50 }),
  count: z.number().int(),
});

const fixtureQuerySchema = strictObject({ page: z.coerce.number().int().min(1).optional() });

/** Rota só de teste com corpo e query validados por schema zod. */
@Controller('fixtures/validation')
class ValidationFixtureController {
  @Post()
  @HttpCode(200)
  accept(
    @Body({ schema: fixtureBodySchema }) body: z.infer<typeof fixtureBodySchema>,
    @Query({ schema: fixtureQuerySchema }) query: z.infer<typeof fixtureQuerySchema>,
  ) {
    return { received: { length: body.description.length, count: body.count, page: query.page ?? null } };
  }
}

@Module({ controllers: [ValidationFixtureController] })
export class ValidationFixtureModule {}
