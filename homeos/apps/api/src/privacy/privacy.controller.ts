import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RESOURCES, can, isUuid } from '@homeos/shared';
import { AuditService } from '../common/audit.service';
import { Authenticated, CurrentAuth, CurrentCtx, Tenant, type AuthInfo, type Ctx } from '../common/context';
import { verifyPassword } from '../common/crypto';
import { conflict, forbidden, notFound, validationFailed } from '../common/errors';
import { StorageService } from '../documents/storage.service';
import { PrismaService } from '../prisma.service';
import { ResourceService } from '../resources/resource.service';

export const CONSENT_PURPOSES: Record<string, { label: string; required: boolean }> = {
  TERMS_AND_PRIVACY: { label: 'Storing and processing household data to provide the service', required: true },
  AI_PROCESSING: { label: 'Sending document text and questions to the configured AI provider', required: false },
  EMAIL_REMINDERS: { label: 'Reminder e-mails', required: false },
  PRODUCT_UPDATES: { label: 'Product update e-mails', required: false },
};

const DELETION_GRACE_DAYS = 30;

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ResourceService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /* ---------------- consent ---------------- */

  async consents(auth: AuthInfo) {
    const rows: any[] = await this.prisma.consent.findMany({ where: { userId: auth.userId } });
    const byPurpose = new Map(rows.map((r) => [r.purpose, r]));
    return Object.entries(CONSENT_PURPOSES).map(([purpose, meta]) => {
      const row = byPurpose.get(purpose);
      return { purpose, label: meta.label, required: meta.required, granted: row?.granted ?? false, grantedAt: row?.grantedAt ?? null, withdrawnAt: row?.withdrawnAt ?? null };
    });
  }

  async setConsent(auth: AuthInfo, purpose: string, body: any) {
    const meta = CONSENT_PURPOSES[purpose];
    if (!meta) throw notFound('Consent purpose');
    const granted = body?.granted;
    if (typeof granted !== 'boolean') throw validationFailed([{ field: 'granted', message: 'must be true or false' }]);
    if (meta.required && !granted) throw conflict('This consent is required to use HomeOS. To withdraw it, delete your account.', 'REQUIRED_CONSENT');
    const now = new Date();
    await this.prisma.consent.upsert({
      where: { userId_purpose: { userId: auth.userId, purpose } },
      update: granted ? { granted: true, grantedAt: now, withdrawnAt: null } : { granted: false, withdrawnAt: now },
      create: { userId: auth.userId, purpose, granted, grantedAt: granted ? now : null, withdrawnAt: granted ? null : now },
    });
    return this.consents(auth);
  }

  /* ---------------- data export ---------------- */

  /**
   * Export household records as JSON. Includes every resource the caller's role can read,
   * with the same visibility rules as the API. File contents are not included (download
   * them from the vault); storage keys and other hidden fields are never exported.
   */
  async exportHousehold(ctx: Ctx) {
    if (ctx.roleKey !== 'OWNER') throw forbidden('Only an owner can export the household data');
    const household = await this.prisma.household.findFirst({ where: { id: ctx.householdId } });
    const members: any[] = await this.prisma.householdMember.findMany({ where: { householdId: ctx.householdId }, include: { role: true } });
    const data: Record<string, any[]> = {};
    for (const def of RESOURCES) {
      if (!can(ctx.perms, def.module, 'read')) continue;
      const rows: any[] = await this.resources.delegate(def).findMany({ where: this.resources.scope(def, ctx), orderBy: { createdAt: 'asc' }, take: 50_000 });
      data[def.key] = rows.map((r) => this.resources.present(def, r, true));
    }
    await this.prisma.dataRequest.create({ data: { householdId: ctx.householdId, userId: ctx.userId, type: 'EXPORT', scope: 'HOUSEHOLD', status: 'COMPLETED', completedAt: new Date() } });
    await this.audit.log(ctx, { action: 'export', entityType: 'household', entityId: ctx.householdId, summary: 'Exported household data' });
    return {
      format: 'homeos-export-v1',
      exportedAt: new Date().toISOString(),
      household: household ? { id: household.id, name: household.name, currency: household.currency, country: household.country, createdAt: household.createdAt } : null,
      members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, relationship: m.relationship, role: m.role.key, status: m.status })),
      data,
    };
  }

  /** Personal data held about the signed-in user (account-level, across households). */
  async exportAccount(auth: AuthInfo) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw notFound('User');
    const [memberships, sessions, consents] = await Promise.all([
      this.prisma.householdMember.findMany({ where: { userId: user.id }, include: { household: true, role: true } }),
      this.prisma.session.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.consent.findMany({ where: { userId: user.id } }),
    ]);
    return {
      format: 'homeos-account-export-v1',
      exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email, name: user.name, phone: user.phone, mfaEnabled: user.mfaEnabled, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt },
      households: (memberships as any[]).map((m) => ({ householdId: m.householdId, household: m.household.name, role: m.role.key, status: m.status, joinedAt: m.joinedAt })),
      sessions: (sessions as any[]).map((s) => ({ createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, ip: s.ip, userAgent: s.userAgent, revokedAt: s.revokedAt })),
      consents: (consents as any[]).map((c) => ({ purpose: c.purpose, granted: c.granted, grantedAt: c.grantedAt, withdrawnAt: c.withdrawnAt })),
    };
  }

  /* ---------------- deletion workflow ---------------- */

  /**
   * Request deletion of a household (owner only) or of the caller's account.
   * The request is recorded with a grace period and can be cancelled until then.
   * Erasure itself is carried out by the operator's retention job (see docs/SECURITY.md).
   */
  async requestDeletion(auth: AuthInfo, ctx: Ctx | null, body: any) {
    const scope = body?.scope === 'HOUSEHOLD' ? 'HOUSEHOLD' : 'ACCOUNT';
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw notFound('User');
    if (!(await verifyPassword(String(body?.password ?? ''), user.passwordHash))) throw validationFailed([{ field: 'password', message: 'is not correct' }]);
    if (scope === 'HOUSEHOLD') {
      if (!ctx) throw validationFailed([{ field: 'scope', message: 'select the household to delete' }]);
      if (ctx.roleKey !== 'OWNER') throw forbidden('Only an owner can delete a household');
    }
    const existing = await this.prisma.dataRequest.findFirst({
      where: { userId: user.id, type: 'DELETION', scope, status: 'REQUESTED', ...(scope === 'HOUSEHOLD' ? { householdId: ctx!.householdId } : {}) },
    });
    if (existing) throw conflict('A deletion request is already pending');
    const request = await this.prisma.dataRequest.create({
      data: {
        userId: user.id,
        householdId: scope === 'HOUSEHOLD' ? ctx!.householdId : null,
        type: 'DELETION',
        scope,
        status: 'REQUESTED',
        scheduledFor: new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000),
        note: body?.reason ? String(body.reason).slice(0, 500) : null,
      },
    });
    if (scope === 'HOUSEHOLD' && ctx) {
      await this.audit.log(ctx, { action: 'deletion-requested', entityType: 'household', entityId: ctx.householdId, summary: `Requested deletion of the household (scheduled for ${request.scheduledFor!.toISOString().slice(0, 10)})` });
    }
    return { id: request.id, scope, status: request.status, scheduledFor: request.scheduledFor };
  }

  /**
   * Erase data for deletion requests whose grace period has passed. Runs from the daily
   * scheduler only when DELETION_JOB_ENABLED=true. Stored files are removed first, then the
   * database rows (household deletion cascades to every household-owned table).
   */
  async executeDueDeletions(): Promise<{ households: number; accounts: number; blocked: number }> {
    const due: any[] = await this.prisma.dataRequest.findMany({ where: { type: 'DELETION', status: 'REQUESTED', scheduledFor: { lte: new Date() } }, take: 50 });
    let households = 0;
    let accounts = 0;
    let blocked = 0;
    const purgeHousehold = async (householdId: string) => {
      const versions: any[] = await this.prisma.documentVersion.findMany({ where: { householdId }, select: { storageKey: true } });
      for (const v of versions) await this.storage.remove(v.storageKey).catch(() => undefined);
      await this.prisma.household.delete({ where: { id: householdId } });
    };
    for (const req of due) {
      try {
        if (req.scope === 'HOUSEHOLD' && req.householdId) {
          await purgeHousehold(req.householdId);
          households++;
        } else if (req.scope === 'ACCOUNT') {
          const memberships: any[] = await this.prisma.householdMember.findMany({ where: { userId: req.userId, deletedAt: null }, include: { role: true } });
          let isBlocked = false;
          for (const m of memberships) {
            if (m.role.key !== 'OWNER') continue;
            const otherOwners = await this.prisma.householdMember.count({ where: { householdId: m.householdId, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' }, userId: { not: req.userId } } });
            const otherMembers = await this.prisma.householdMember.count({ where: { householdId: m.householdId, deletedAt: null, userId: { notIn: [req.userId] }, NOT: { userId: null } } });
            if (otherOwners === 0 && otherMembers > 0) isBlocked = true; // someone else still depends on this household
          }
          if (isBlocked) {
            await this.prisma.dataRequest.update({ where: { id: req.id }, data: { status: 'BLOCKED', note: 'The account is the only owner of a household that has other members. Transfer ownership or delete the household first.' } });
            blocked++;
            continue;
          }
          for (const m of memberships) {
            const others = await this.prisma.householdMember.count({ where: { householdId: m.householdId, deletedAt: null, NOT: [{ userId: null }, { userId: req.userId }] } });
            if (m.role.key === 'OWNER' && others === 0) await purgeHousehold(m.householdId);
          }
          await this.prisma.householdMember.updateMany({ where: { userId: req.userId }, data: { userId: null, status: 'REMOVED', deletedAt: new Date(), email: null, phone: null } });
          await this.prisma.user.delete({ where: { id: req.userId } });
          accounts++;
        }
        await this.prisma.dataRequest.updateMany({ where: { id: req.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      } catch (err) {
        await this.prisma.dataRequest.updateMany({ where: { id: req.id }, data: { note: `Erasure failed: ${(err as Error).message}`.slice(0, 500) } });
      }
    }
    return { households, accounts, blocked };
  }

  async listRequests(auth: AuthInfo) {
    const rows: any[] = await this.prisma.dataRequest.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => ({ id: r.id, type: r.type, scope: r.scope, status: r.status, householdId: r.householdId, scheduledFor: r.scheduledFor, completedAt: r.completedAt, createdAt: r.createdAt }));
  }

  async cancelRequest(auth: AuthInfo, id: string) {
    if (!isUuid(id)) throw notFound('Request');
    const res = await this.prisma.dataRequest.updateMany({ where: { id, userId: auth.userId, type: 'DELETION', status: 'REQUESTED' }, data: { status: 'CANCELLED' } });
    if (res.count === 0) throw notFound('Request');
  }
}

@ApiTags('Privacy & data rights')
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('consents')
  @Authenticated()
  consents(@CurrentAuth() auth: AuthInfo) {
    return this.privacy.consents(auth);
  }

  /** Body: { granted: boolean }. */
  @Put('consents/:purpose')
  @Authenticated()
  setConsent(@CurrentAuth() auth: AuthInfo, @Param('purpose') purpose: string, @Body() body: any) {
    return this.privacy.setConsent(auth, purpose, body);
  }

  @Get('export/account')
  @Authenticated()
  exportAccount(@CurrentAuth() auth: AuthInfo) {
    return this.privacy.exportAccount(auth);
  }

  @Get('export/household')
  @Tenant()
  exportHousehold(@CurrentCtx() ctx: Ctx) {
    return this.privacy.exportHousehold(ctx);
  }

  @Get('requests')
  @Authenticated()
  requests(@CurrentAuth() auth: AuthInfo) {
    return this.privacy.listRequests(auth);
  }

  /** Body: { scope: "ACCOUNT", password, reason? }. */
  @Post('deletion-requests/account')
  @Authenticated()
  deleteAccount(@CurrentAuth() auth: AuthInfo, @Body() body: any) {
    return this.privacy.requestDeletion(auth, null, { ...body, scope: 'ACCOUNT' });
  }

  /** Body: { password, reason? }. Owner only. */
  @Post('deletion-requests/household')
  @Tenant()
  deleteHousehold(@CurrentAuth() auth: AuthInfo, @CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.privacy.requestDeletion(auth, ctx, { ...body, scope: 'HOUSEHOLD' });
  }

  @Delete('requests/:id')
  @HttpCode(204)
  @Authenticated()
  async cancel(@CurrentAuth() auth: AuthInfo, @Param('id') id: string) {
    await this.privacy.cancelRequest(auth, id);
  }
}
