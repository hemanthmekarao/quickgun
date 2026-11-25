import { CanActivate, ExecutionContext, Injectable, UseGuards, applyDecorators, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { can, isUuid, type Action, type ModuleKey, type PermissionMap } from '@homeos/shared';
import { loadConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { verifyJwt } from './crypto';
import { forbidden, unauthorized } from './errors';

export interface AuthInfo {
  userId: string;
  sessionId: string;
  ip?: string;
  userAgent?: string;
}

/** Everything a request needs to act inside one household. Built by HouseholdGuard. */
export interface Ctx extends AuthInfo {
  householdId: string;
  memberId: string;
  memberName: string;
  roleKey: string;
  perms: PermissionMap;
  /** Non-empty when the member is restricted to specific properties. */
  propertyScope: string[];
  currency: string;
  approvalThreshold: number | null;
}

type Req = Request & { auth?: AuthInfo; ctx?: Ctx };

function clientIp(req: Request): string | undefined {
  return (req.ip || req.socket?.remoteAddress || undefined)?.replace(/^::ffff:/, '');
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Req>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw unauthorized();
    const payload = verifyJwt<{ sub: string; sid: string; typ?: string }>(token, loadConfig().jwtSecret);
    if (!payload || payload.typ !== 'access' || !payload.sub || !payload.sid) throw unauthorized('Session expired', 'TOKEN_EXPIRED');
    // Checked on every request so that revoking a session takes effect immediately.
    const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.userId !== payload.sub) {
      throw unauthorized('Session is no longer valid', 'SESSION_REVOKED');
    }
    req.auth = {
      userId: payload.sub,
      sessionId: payload.sid,
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || undefined,
    };
    return true;
  }
}

export function permissionMap(rows: { module: string; canRead: boolean; canWrite: boolean; canDelete: boolean; canApprove: boolean }[]): PermissionMap {
  const map: PermissionMap = {};
  for (const r of rows) {
    map[r.module as ModuleKey] = { read: r.canRead, write: r.canWrite, delete: r.canDelete, approve: r.canApprove };
  }
  return map;
}

@Injectable()
export class HouseholdGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Req>();
    if (!req.auth) throw unauthorized();
    const householdId = String(req.headers['x-household-id'] ?? '');
    if (!isUuid(householdId)) throw forbidden('Select a household (X-Household-Id header)', 'HOUSEHOLD_REQUIRED');
    const member = await this.prisma.householdMember.findFirst({
      where: { householdId, userId: req.auth.userId, status: 'ACTIVE', deletedAt: null, household: { deletedAt: null } },
      include: { role: { include: { permissions: true } }, household: true },
    });
    // Same response whether the household does not exist or the caller is not a member of it.
    if (!member) throw forbidden('You are not a member of this household', 'NOT_A_MEMBER');
    req.ctx = {
      ...req.auth,
      householdId,
      memberId: member.id,
      memberName: member.name,
      roleKey: member.role.key,
      perms: permissionMap(member.role.permissions),
      propertyScope: member.propertyScope ?? [],
      currency: member.household.currency,
      approvalThreshold: member.household.approvalThreshold === null ? null : Number(member.household.approvalThreshold),
    };
    return true;
  }
}

/** Requires a valid access token. */
export const Authenticated = () => applyDecorators(UseGuards(AuthGuard));
/** Requires a valid access token and active membership of the household in X-Household-Id. */
export const Tenant = () => applyDecorators(UseGuards(AuthGuard, HouseholdGuard));

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthInfo => {
  const req = context.switchToHttp().getRequest<Req>();
  if (!req.auth) throw unauthorized();
  return req.auth;
});

export const CurrentCtx = createParamDecorator((_data: unknown, context: ExecutionContext): Ctx => {
  const req = context.switchToHttp().getRequest<Req>();
  if (!req.ctx) throw unauthorized();
  return req.ctx;
});

export function need(ctx: Ctx, module: ModuleKey, action: Action): void {
  if (!can(ctx.perms, module, action)) {
    throw forbidden(`Your role does not allow ${action} access to ${module}`);
  }
}

export function allowed(ctx: Ctx, module: ModuleKey, action: Action): boolean {
  return can(ctx.perms, module, action);
}
