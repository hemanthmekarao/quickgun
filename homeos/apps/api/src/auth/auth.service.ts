import { Injectable, Logger } from '@nestjs/common';
import type { AuthInfo } from '../common/context';
import {
  decryptString,
  encryptString,
  generateTotpSecret,
  hashPassword,
  otpauthUrl,
  randomToken,
  sha256,
  signJwt,
  verifyPassword,
  verifyTotp,
} from '../common/crypto';
import { ApiException, badRequest, conflict, notFound, unauthorized, validationFailed } from '../common/errors';
import { loadConfig } from '../config';
import { HouseholdsService } from '../households/households.service';
import { PrismaService, type Db } from '../prisma.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export function passwordIssues(password: unknown): string | null {
  if (typeof password !== 'string') return 'is required';
  if (password.length < 10) return 'must be at least 10 characters';
  if (password.length > 200) return 'must be at most 200 characters';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'must contain letters and numbers';
  return null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
  ) {}

  private presentUser(u: any) {
    return { id: u.id, email: u.email, name: u.name, phone: u.phone, mfaEnabled: u.mfaEnabled, createdAt: u.createdAt };
  }

  private async issueSession(db: Db, userId: string, client: ClientInfo) {
    const cfg = loadConfig();
    const refreshToken = randomToken(48);
    const session = await db.session.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        userAgent: client.userAgent ?? null,
        ip: client.ip ?? null,
        expiresAt: new Date(Date.now() + cfg.refreshTtlDays * 86_400_000),
      },
    });
    const accessToken = signJwt({ sub: userId, sid: session.id, typ: 'access' }, cfg.jwtSecret, cfg.accessTtlSeconds);
    return { accessToken, refreshToken, expiresIn: cfg.accessTtlSeconds, sessionId: session.id };
  }

  async register(body: any, client: ClientInfo) {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const name = String(body?.name ?? '').trim();
    const inviteToken = body?.inviteToken ? String(body.inviteToken) : null;
    const householdName = String(body?.householdName ?? '').trim() || (name ? `${name.split(' ')[0]}'s Home` : '');
    const issues = [];
    if (!EMAIL_RE.test(email) || email.length > 254) issues.push({ field: 'email', message: 'must be a valid e-mail address' });
    if (name.length < 1 || name.length > 120) issues.push({ field: 'name', message: 'is required' });
    const pw = passwordIssues(body?.password);
    if (pw) issues.push({ field: 'password', message: pw });
    if (issues.length) throw validationFailed(issues);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict('An account with this e-mail address already exists', 'EMAIL_TAKEN');

    const passwordHash = await hashPassword(body.password);
    const result = await this.prisma.$transaction(async (tx: Db) => {
      const user = await tx.user.create({ data: { email, name, passwordHash, lastLoginAt: new Date() } });
      if (inviteToken) {
        await this.acceptInviteInTx(tx, user, inviteToken);
      } else {
        await this.households.createHousehold(tx, user, householdName);
      }
      await tx.consent.create({ data: { userId: user.id, purpose: 'TERMS_AND_PRIVACY', granted: true, grantedAt: new Date() } });
      const tokens = await this.issueSession(tx, user.id, client);
      return { user, tokens };
    });
    return { ...result.tokens, user: this.presentUser(result.user), households: await this.households.membershipsFor(result.user.id) };
  }

  private async acceptInviteInTx(tx: Db, user: { id: string; email: string }, token: string) {
    const member = await tx.householdMember.findFirst({ where: { inviteTokenHash: sha256(token), deletedAt: null, status: 'INVITED' } });
    if (!member || !member.inviteExpiresAt || member.inviteExpiresAt <= new Date()) {
      throw badRequest('This invitation is invalid or has expired', undefined, 'INVITE_INVALID');
    }
    // The invitation is bound to the e-mail address it was sent to.
    if (member.email && member.email.toLowerCase() !== user.email.toLowerCase()) {
      throw badRequest('This invitation was sent to a different e-mail address', undefined, 'INVITE_EMAIL_MISMATCH');
    }
    const already = await tx.householdMember.count({ where: { householdId: member.householdId, userId: user.id, deletedAt: null } });
    if (already > 0) throw conflict('You are already a member of this household');
    await tx.householdMember.update({
      where: { id: member.id },
      data: { userId: user.id, status: 'ACTIVE', joinedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
    });
    await tx.auditLog.create({
      data: {
        householdId: member.householdId,
        actorUserId: user.id,
        actorMemberId: member.id,
        action: 'update',
        entityType: 'member',
        entityId: member.id,
        summary: `${member.name} accepted the invitation`,
        createdById: user.id,
      },
    });
  }

  /** Existing users accept an invitation to an additional household. */
  async acceptInvite(auth: AuthInfo, body: any) {
    const token = String(body?.token ?? '');
    if (!token) throw validationFailed([{ field: 'token', message: 'is required' }]);
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw notFound('User');
    await this.prisma.$transaction((tx: Db) => this.acceptInviteInTx(tx, user, token));
    return { households: await this.households.membershipsFor(user.id) };
  }

  async login(body: any, client: ClientInfo) {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');
    const invalid = () => unauthorized('Incorrect e-mail address or password', 'INVALID_CREDENTIALS');
    if (!email || !password) throw invalid();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      // Spend comparable time so that unknown addresses cannot be told apart by timing.
      await hashPassword(password);
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ApiException(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.');
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw invalid();
    }
    if (user.mfaEnabled) {
      const code = body?.totp ? String(body.totp) : '';
      if (!code) throw unauthorized('Enter the code from your authenticator app', 'MFA_REQUIRED');
      const secret = decryptString(user.mfaSecret!, loadConfig().dataKey);
      if (!verifyTotp(secret, code)) throw unauthorized('The authenticator code is not correct', 'MFA_INVALID');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const tokens = await this.issueSession(this.prisma, user.id, client);
    return { ...tokens, user: this.presentUser(user), households: await this.households.membershipsFor(user.id) };
  }

  /**
   * Rotate the refresh token. A refresh token can be used once; presenting an already-used
   * token revokes the session, since that indicates the token was copied.
   */
  async refresh(refreshToken: string | undefined, client: ClientInfo) {
    if (!refreshToken) throw unauthorized('No refresh token', 'NO_REFRESH_TOKEN');
    const cfg = loadConfig();
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw unauthorized('Session expired', 'SESSION_EXPIRED');
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') throw unauthorized('Session expired', 'SESSION_EXPIRED');
    const next = randomToken(48);
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: sha256(next),
        lastUsedAt: new Date(),
        ip: client.ip ?? session.ip,
        userAgent: client.userAgent ?? session.userAgent,
        expiresAt: new Date(Date.now() + cfg.refreshTtlDays * 86_400_000),
      },
    });
    const accessToken = signJwt({ sub: user.id, sid: session.id, typ: 'access' }, cfg.jwtSecret, cfg.accessTtlSeconds);
    return { accessToken, refreshToken: next, expiresIn: cfg.accessTtlSeconds, sessionId: session.id };
  }

  async logout(refreshToken: string | undefined, sessionId?: string) {
    if (refreshToken) {
      await this.prisma.session.updateMany({ where: { refreshTokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    if (sessionId) {
      await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }

  async me(auth: AuthInfo) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw unauthorized();
    return { user: this.presentUser(user), households: await this.households.membershipsFor(user.id) };
  }

  async updateMe(auth: AuthInfo, body: any) {
    const data: Record<string, any> = {};
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 120) throw validationFailed([{ field: 'name', message: 'is required' }]);
      data.name = name;
    }
    if (body?.phone !== undefined) data.phone = body.phone ? String(body.phone).trim().slice(0, 30) : null;
    if (!Object.keys(data).length) throw badRequest('No fields to update');
    const user = await this.prisma.user.update({ where: { id: auth.userId }, data });
    return this.presentUser(user);
  }

  async changePassword(auth: AuthInfo, body: any) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw unauthorized();
    if (!(await verifyPassword(String(body?.currentPassword ?? ''), user.passwordHash))) {
      throw validationFailed([{ field: 'currentPassword', message: 'is not correct' }]);
    }
    const pw = passwordIssues(body?.newPassword);
    if (pw) throw validationFailed([{ field: 'newPassword', message: pw }]);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
    // Sign out every other device.
    await this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: auth.sessionId } }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  /* ---------------- sessions ---------------- */

  async sessions(auth: AuthInfo) {
    const rows = await this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((s: any) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === auth.sessionId,
    }));
  }

  async revokeSession(auth: AuthInfo, id: string) {
    const res = await this.prisma.session.updateMany({ where: { id, userId: auth.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count === 0) throw notFound('Session');
  }

  /* ---------------- MFA ---------------- */

  async mfaSetup(auth: AuthInfo) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw unauthorized();
    if (user.mfaEnabled) throw conflict('Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaPendingSecret: encryptString(secret, loadConfig().dataKey) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  async mfaEnable(auth: AuthInfo, body: any) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw unauthorized();
    if (!user.mfaPendingSecret) throw badRequest('Start two-factor setup first');
    const secret = decryptString(user.mfaPendingSecret, loadConfig().dataKey);
    if (!verifyTotp(secret, String(body?.code ?? ''))) throw validationFailed([{ field: 'code', message: 'is not correct' }]);
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null } });
    return { mfaEnabled: true };
  }

  async mfaDisable(auth: AuthInfo, body: any) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw unauthorized();
    if (!user.mfaEnabled) return { mfaEnabled: false };
    if (!(await verifyPassword(String(body?.password ?? ''), user.passwordHash))) {
      throw validationFailed([{ field: 'password', message: 'is not correct' }]);
    }
    const secret = decryptString(user.mfaSecret!, loadConfig().dataKey);
    if (!verifyTotp(secret, String(body?.code ?? ''))) throw validationFailed([{ field: 'code', message: 'is not correct' }]);
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null } });
    return { mfaEnabled: false };
  }
}
