import { Body, Get, HttpCode, Injectable, Post, Req, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { CurrentUser, PasswordHasher, SignInService } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { AdminApi, OpenAdminRoute } from '../../../../src/common/http/route-decorators.js';
import type { StaffUser } from '../../../../src/infra/auth/staff-user.js';

/**
 * Rotas de exemplo SÓ DE TESTE (teste de contrato, FR-023): provam o comportamento do `@nestjs/authentication` com os
 * stores definitivos. As rotas reais de login são da feature 04-auth.
 */
@Injectable()
export class ExampleCredentials {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly hasher: PasswordHasher,
  ) {}

  /** Mesmo caminho para e-mail inexistente e senha errada: o hash é sempre verificado (FR-006). */
  async verify(email: string, password: string, hasher: PasswordHasher = this.hasher): Promise<string | null> {
    const rows = (await this.ds.query(`SELECT id, password_hash FROM users WHERE email = $1`, [email])) as Array<{
      id: string;
      password_hash: string;
    }>;
    const found = rows[0];
    const valid = await hasher.verify(password, found?.password_hash);
    return valid && found ? found.id : null;
  }
}

const credentials = z.strictObject({ email: z.string().max(200), password: z.string().max(200) });
const code = z.strictObject({ code: z.string().max(20) });

@AdminApi('example-auth')
export class ExampleAuthController {
  constructor(
    private readonly creds: ExampleCredentials,
    private readonly signIn: SignInService,
  ) {}

  @OpenAdminRoute()
  @Post('sign-in')
  @HttpCode(200)
  async enter(@Body({ schema: credentials }) body: z.infer<typeof credentials>, @Req() req: Request) {
    const userId = await this.creds.verify(body.email, body.password);
    if (!userId) throw new UnauthorizedException();
    const { session } = await this.signIn.signIn(userId, {
      method: 'password',
      metadata: { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 255) ?? null },
    });
    return { mfaRequired: session.mfa === 'pending' };
  }

  @OpenAdminRoute()
  @Post('mfa')
  @HttpCode(200)
  async mfa(@Body({ schema: code }) body: z.infer<typeof code>) {
    const done = await this.signIn.completeMfa({ code: body.code });
    if (!done) throw new UnauthorizedException();
    return { ok: true };
  }

  @Can.Anyone()
  @Get('me')
  me(@CurrentUser() user: StaffUser) {
    return { id: user.id };
  }

  @Can.Anyone()
  @Post('sign-out')
  @HttpCode(204)
  async signOut() {
    await this.signIn.signOut();
  }

  @Can.Anyone()
  @Post('sign-out-everywhere')
  @HttpCode(204)
  async everywhere(@CurrentUser() user: StaffUser) {
    await this.signIn.signOutEverywhere(user.id);
  }
}
