import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Authenticated, CurrentAuth, type AuthInfo } from '../common/context';
import { loadConfig } from '../config';
import { AuthService, type ClientInfo } from './auth.service';

const REFRESH_COOKIE = 'homeos_refresh';
/** Attempts per minute per client on credential endpoints. */
const AUTH_LIMIT = process.env.NODE_ENV === 'test' ? 100_000 : 10;
/** Every page load exchanges the refresh cookie once, so this is higher; it follows the global limit when that is raised. */
const REFRESH_LIMIT = process.env.NODE_ENV === 'test' ? 100_000 : Math.max(60, Number(process.env.RATE_LIMIT_PER_MINUTE ?? 0) || 0);

function client(req: Request): ClientInfo {
  return {
    ip: (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || undefined,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || undefined,
  };
}

function setRefreshCookie(res: Response, token: string): void {
  const cfg = loadConfig();
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: cfg.refreshTtlDays * 86_400_000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: loadConfig().cookieSecure, sameSite: 'lax', path: '/' });
}

/**
 * Tokens are returned in the body (for native apps) and the refresh token is also set as an
 * httpOnly cookie (for the web app, which never reads it from JavaScript).
 */
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: AUTH_LIMIT, ttl: 60_000 } })
  async register(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.auth.register(body, client(req));
    setRefreshCookie(res, out.refreshToken);
    return out;
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: AUTH_LIMIT, ttl: 60_000 } })
  async login(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.auth.login(body, client(req));
    setRefreshCookie(res, out.refreshToken);
    return out;
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: REFRESH_LIMIT, ttl: 60_000 } })
  async refresh(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = body?.refreshToken || (req as any).cookies?.[REFRESH_COOKIE];
    try {
      const out = await this.auth.refresh(token, client(req));
      setRefreshCookie(res, out.refreshToken);
      return out;
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(body?.refreshToken || (req as any).cookies?.[REFRESH_COOKIE]);
    clearRefreshCookie(res);
  }

  @Get('me')
  @Authenticated()
  me(@CurrentAuth() auth: AuthInfo) {
    return this.auth.me(auth);
  }

  @Patch('me')
  @Authenticated()
  updateMe(@CurrentAuth() auth: AuthInfo, @Body() body: any) {
    return this.auth.updateMe(auth, body);
  }

  @Post('change-password')
  @HttpCode(200)
  @Authenticated()
  changePassword(@CurrentAuth() auth: AuthInfo, @Body() body: any) {
    return this.auth.changePassword(auth, body);
  }

  @Post('accept-invite')
  @HttpCode(200)
  @Authenticated()
  acceptInvite(@CurrentAuth() auth: AuthInfo, @Body() body: any) {
    return this.auth.acceptInvite(auth, body);
  }

  @Get('sessions')
  @Authenticated()
  sessions(@CurrentAuth() auth: AuthInfo) {
    return this.auth.sessions(auth);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @Authenticated()
  async revoke(@CurrentAuth() auth: AuthInfo, @Param('id') id: string) {
    await this.auth.revokeSession(auth, id);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @Authenticated()
  mfaSetup(@CurrentAuth() auth: AuthInfo) {
    return this.auth.mfaSetup(auth);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @Authenticated()
  mfaEnable(@CurrentAuth() auth: AuthInfo, @Body() body: any) {
    return this.auth.mfaEnable(auth, body);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @Authenticated()
  mfaDisable(@CurrentAuth() auth: AuthInfo, @Body() body: any) {
    return this.auth.mfaDisable(auth, body);
  }
}
