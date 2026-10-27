import { Body, Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SESSION_COOKIE } from '../common/auth.guard';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { ChangePasswordDto, LoginDto, MfaCodeDto, MfaDisableDto, MfaVerifyDto, PreferencesDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.register(dto);
    this.setCookie(res, token);
    return user;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    if ('mfaRequired' in result) return result;
    this.setCookie(res, result.token);
    return result.user;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/verify')
  async verifyMfa(@Body() dto: MfaVerifyDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.verifyMfaLogin(dto.ticket, dto.code);
    this.setCookie(res, token);
    return user;
  }

  @Post('mfa/setup')
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.mfaSetup(user.id);
  }

  @HttpCode(200)
  @Post('mfa/enable')
  mfaEnable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.auth.mfaEnable(user.id, dto.code);
  }

  @HttpCode(200)
  @Post('mfa/disable')
  mfaDisable(@CurrentUser() user: AuthUser, @Body() dto: MfaDisableDto) {
    return this.auth.mfaDisable(user.id, dto.password, dto.code);
  }

  @Patch('preferences')
  preferences(@CurrentUser() user: AuthUser, @Body() dto: PreferencesDto) {
    return this.auth.updatePreferences(user.id, dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  private setCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });
  }
}
