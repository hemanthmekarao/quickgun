import { Injectable } from '@nestjs/common';
import {
  DEFAULT_DOCUMENT_CATEGORIES,
  DEFAULT_REMINDER_RULES,
  DEFAULT_ROLE_PERMISSIONS,
  MODULE_KEYS,
  ROLE_KEYS,
  ROLE_LABELS,
  isUuid,
  parseDate,
  type RoleKey,
} from '@homeos/shared';
import { AuditService } from '../common/audit.service';
import { need, permissionMap, type AuthInfo, type Ctx } from '../common/context';
import { randomToken, sha256 } from '../common/crypto';
import { badRequest, conflict, forbidden, notFound, validationFailed } from '../common/errors';
import { loadConfig } from '../config';
import { PrismaService, type Db } from '../prisma.service';

const CURRENCY_RE = /^[A-Z]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function presentMember(m: any) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    relationship: m.relationship,
    dateOfBirth: m.dateOfBirth ? m.dateOfBirth.toISOString().slice(0, 10) : null,
    bloodGroup: m.bloodGroup,
    status: m.status,
    hasAccount: Boolean(m.userId),
    roleId: m.roleId,
    roleKey: m.role?.key,
    roleName: m.role?.name,
    propertyScope: m.propertyScope ?? [],
    joinedAt: m.joinedAt,
    createdAt: m.createdAt,
  };
}

@Injectable()
export class HouseholdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Create a household with its roles, permission matrix, document categories and reminder rules. */
  async createHousehold(db: Db, user: { id: string; name: string; email: string }, name: string, currency = 'INR') {
    const household = await db.household.create({ data: { name, currency, createdById: user.id } });
    let ownerRoleId = '';
    for (const key of ROLE_KEYS) {
      const role = await db.role.create({ data: { householdId: household.id, key, name: ROLE_LABELS[key], isSystem: true } });
      if (key === 'OWNER') ownerRoleId = role.id;
      const perms = DEFAULT_ROLE_PERMISSIONS[key];
      await db.permission.createMany({
        data: MODULE_KEYS.map((module) => ({
          householdId: household.id,
          roleId: role.id,
          module,
          canRead: perms[module]?.read ?? false,
          canWrite: perms[module]?.write ?? false,
          canDelete: perms[module]?.delete ?? false,
          canApprove: perms[module]?.approve ?? false,
        })),
      });
    }
    const member = await db.householdMember.create({
      data: {
        householdId: household.id,
        userId: user.id,
        roleId: ownerRoleId,
        name: user.name,
        email: user.email,
        relationship: 'Self',
        status: 'ACTIVE',
        joinedAt: new Date(),
        createdById: user.id,
      },
    });
    await db.documentCategory.createMany({
      data: DEFAULT_DOCUMENT_CATEGORIES.map((c) => ({ householdId: household.id, name: c.name, defaultSensitivity: c.defaultSensitivity, createdById: user.id })),
    });
    await db.reminderRule.createMany({
      data: DEFAULT_REMINDER_RULES.map((r) => ({
        householdId: household.id,
        name: r.name,
        eventType: r.eventType,
        offsetsDays: r.offsetsDays,
        channels: ['IN_APP'],
        enabled: true,
        createdById: user.id,
      })),
    });
    await db.auditLog.create({
      data: {
        householdId: household.id,
        actorUserId: user.id,
        actorMemberId: member.id,
        action: 'create',
        entityType: 'household',
        entityId: household.id,
        summary: `Created household "${name}"`,
        createdById: user.id,
      },
    });
    return { household, member };
  }

  async createForUser(auth: AuthInfo, body: any) {
    const name = String(body?.name ?? '').trim();
    const currency = String(body?.currency ?? 'INR').trim().toUpperCase();
    const issues = [];
    if (name.length < 2 || name.length > 100) issues.push({ field: 'name', message: 'must be between 2 and 100 characters' });
    if (!CURRENCY_RE.test(currency)) issues.push({ field: 'currency', message: 'must be a 3-letter currency code' });
    if (issues.length) throw validationFailed(issues);
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw notFound('User');
    const { household } = await this.prisma.$transaction((tx: Db) => this.createHousehold(tx, user, name, currency));
    return { id: household.id, name: household.name, currency: household.currency };
  }

  /** Households the user belongs to, with role and permissions for each. */
  async membershipsFor(userId: string) {
    const rows = await this.prisma.householdMember.findMany({
      where: { userId, status: 'ACTIVE', deletedAt: null, household: { deletedAt: null } },
      include: { household: true, role: { include: { permissions: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m: any) => ({
      id: m.household.id,
      name: m.household.name,
      currency: m.household.currency,
      memberId: m.id,
      roleKey: m.role.key,
      roleName: m.role.name,
      permissions: permissionMap(m.role.permissions),
      propertyScope: m.propertyScope ?? [],
    }));
  }

  async current(ctx: Ctx) {
    const h = await this.prisma.household.findFirst({ where: { id: ctx.householdId, deletedAt: null } });
    if (!h) throw notFound('Household');
    return {
      id: h.id,
      name: h.name,
      currency: h.currency,
      country: h.country,
      timezone: h.timezone,
      approvalThreshold: h.approvalThreshold === null ? null : Number(h.approvalThreshold),
      createdAt: h.createdAt,
    };
  }

  async updateCurrent(ctx: Ctx, body: any) {
    need(ctx, 'settings', 'write');
    const data: Record<string, any> = {};
    const issues = [];
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 100) issues.push({ field: 'name', message: 'must be between 2 and 100 characters' });
      data.name = name;
    }
    if (body?.currency !== undefined) {
      const currency = String(body.currency).trim().toUpperCase();
      if (!CURRENCY_RE.test(currency)) issues.push({ field: 'currency', message: 'must be a 3-letter currency code' });
      data.currency = currency;
    }
    if (body?.timezone !== undefined) data.timezone = String(body.timezone).trim().slice(0, 64);
    if (body?.approvalThreshold !== undefined) {
      if (body.approvalThreshold === null || body.approvalThreshold === '') data.approvalThreshold = null;
      else {
        const n = Number(body.approvalThreshold);
        if (!Number.isFinite(n) || n < 0) issues.push({ field: 'approvalThreshold', message: 'must be a positive amount or empty' });
        data.approvalThreshold = n;
      }
    }
    if (issues.length) throw validationFailed(issues);
    if (!Object.keys(data).length) throw badRequest('No fields to update');
    await this.prisma.household.update({ where: { id: ctx.householdId }, data });
    await this.audit.log(ctx, { action: 'update', entityType: 'household', entityId: ctx.householdId, summary: 'Updated household settings', changes: data });
    return this.current(ctx);
  }

  /* ---------------- members ---------------- */

  async listMembers(ctx: Ctx) {
    const rows = await this.prisma.householdMember.findMany({
      where: { householdId: ctx.householdId, deletedAt: null },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    });
    // Everyone in a household can see who is in it; contact details need household:read.
    const full = Boolean(ctx.perms.household?.read);
    return rows.map((m: any) => {
      const p = presentMember(m);
      return full ? p : { id: p.id, name: p.name, roleName: p.roleName, roleKey: p.roleKey, status: p.status, hasAccount: p.hasAccount };
    });
  }

  private async resolveRole(ctx: Ctx, roleKeyOrId: string | undefined, fallback: RoleKey = 'FAMILY_MEMBER') {
    const where = roleKeyOrId && isUuid(roleKeyOrId) ? { id: roleKeyOrId } : { key: String(roleKeyOrId ?? fallback) };
    const role = await this.prisma.role.findFirst({ where: { ...where, householdId: ctx.householdId } });
    if (!role) throw validationFailed([{ field: 'role', message: 'is not a role in this household' }]);
    return role;
  }

  private async validateScope(ctx: Ctx, scope: unknown): Promise<string[]> {
    if (scope === undefined || scope === null) return [];
    if (!Array.isArray(scope) || !scope.every(isUuid)) throw validationFailed([{ field: 'propertyScope', message: 'must be a list of property ids' }]);
    if (scope.length === 0) return [];
    const count = await this.prisma.property.count({ where: { id: { in: scope as string[] }, householdId: ctx.householdId, deletedAt: null } });
    if (count !== new Set(scope as string[]).size) throw validationFailed([{ field: 'propertyScope', message: 'contains properties outside this household' }]);
    return [...new Set(scope as string[])];
  }

  /**
   * Add a member. With `invite: true` and an e-mail address an invitation token is created;
   * without it the member is a profile only (e.g. a child or an elderly parent).
   */
  async addMember(ctx: Ctx, body: any) {
    need(ctx, 'household', 'write');
    const name = String(body?.name ?? '').trim();
    const email = body?.email ? String(body.email).trim().toLowerCase() : null;
    const invite = Boolean(body?.invite);
    const issues = [];
    if (name.length < 1 || name.length > 120) issues.push({ field: 'name', message: 'is required' });
    if (email && !EMAIL_RE.test(email)) issues.push({ field: 'email', message: 'must be a valid e-mail address' });
    if (invite && !email) issues.push({ field: 'email', message: 'is required to send an invitation' });
    let dob: Date | null = null;
    if (body?.dateOfBirth) {
      dob = parseDate(body.dateOfBirth);
      if (!dob) issues.push({ field: 'dateOfBirth', message: 'must be a valid date' });
    }
    if (issues.length) throw validationFailed(issues);
    const role = await this.resolveRole(ctx, body?.roleKey ?? body?.roleId);
    if (role.key === 'OWNER' && ctx.roleKey !== 'OWNER') throw forbidden('Only an owner can add another owner');
    const propertyScope = await this.validateScope(ctx, body?.propertyScope);
    if (email) {
      const dup = await this.prisma.householdMember.count({ where: { householdId: ctx.householdId, email, deletedAt: null } });
      if (dup > 0) throw conflict('A member with this e-mail address already exists in this household');
    }
    let inviteToken: string | null = null;
    if (invite) inviteToken = randomToken(32);
    const member = await this.prisma.householdMember.create({
      data: {
        householdId: ctx.householdId,
        roleId: role.id,
        name,
        email,
        phone: body?.phone ? String(body.phone).trim().slice(0, 30) : null,
        relationship: body?.relationship ? String(body.relationship).trim().slice(0, 60) : null,
        dateOfBirth: dob,
        bloodGroup: body?.bloodGroup ? String(body.bloodGroup).trim().slice(0, 10) : null,
        propertyScope,
        status: invite ? 'INVITED' : 'PROFILE_ONLY',
        inviteTokenHash: inviteToken ? sha256(inviteToken) : null,
        inviteExpiresAt: inviteToken ? new Date(Date.now() + 7 * 86_400_000) : null,
        createdById: ctx.userId,
      },
      include: { role: true },
    });
    await this.audit.log(ctx, {
      action: 'create',
      entityType: 'member',
      entityId: member.id,
      summary: `${invite ? 'Invited' : 'Added'} ${name} as ${role.name}`,
    });
    return {
      ...presentMember(member),
      // Returned once so the inviter can pass it on; only its hash is stored.
      ...(inviteToken ? { inviteToken, inviteUrl: `${loadConfig().publicWebUrl}/register?invite=${inviteToken}` } : {}),
    };
  }

  async updateMember(ctx: Ctx, id: string, body: any) {
    need(ctx, 'household', 'write');
    if (!isUuid(id)) throw notFound('Member');
    const member = await this.prisma.householdMember.findFirst({ where: { id, householdId: ctx.householdId, deletedAt: null }, include: { role: true } });
    if (!member) throw notFound('Member');
    const data: Record<string, any> = {};
    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw validationFailed([{ field: 'name', message: 'is required' }]);
      data.name = name.slice(0, 120);
    }
    for (const key of ['phone', 'relationship', 'bloodGroup'] as const) {
      if (body?.[key] !== undefined) data[key] = body[key] ? String(body[key]).trim().slice(0, 60) : null;
    }
    if (body?.dateOfBirth !== undefined) {
      if (!body.dateOfBirth) data.dateOfBirth = null;
      else {
        const d = parseDate(body.dateOfBirth);
        if (!d) throw validationFailed([{ field: 'dateOfBirth', message: 'must be a valid date' }]);
        data.dateOfBirth = d;
      }
    }
    if (body?.propertyScope !== undefined) data.propertyScope = await this.validateScope(ctx, body.propertyScope);
    if (body?.roleKey !== undefined || body?.roleId !== undefined) {
      const role = await this.resolveRole(ctx, body.roleKey ?? body.roleId);
      if (role.id !== member.roleId) {
        if ((role.key === 'OWNER' || member.role.key === 'OWNER') && ctx.roleKey !== 'OWNER') {
          throw forbidden('Only an owner can change owner roles');
        }
        if (member.role.key === 'OWNER') await this.assertNotLastOwner(ctx, member.id);
        data.roleId = role.id;
      }
    }
    if (!Object.keys(data).length) throw badRequest('No fields to update');
    const updated = await this.prisma.householdMember.update({ where: { id: member.id }, data, include: { role: true } });
    await this.audit.log(ctx, { action: 'update', entityType: 'member', entityId: member.id, summary: `Updated member ${updated.name}`, changes: data });
    return presentMember(updated);
  }

  private async assertNotLastOwner(ctx: Ctx, memberId: string) {
    const owners = await this.prisma.householdMember.count({
      where: { householdId: ctx.householdId, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' }, id: { not: memberId } },
    });
    if (owners === 0) throw conflict('A household must keep at least one owner', 'LAST_OWNER');
  }

  async removeMember(ctx: Ctx, id: string) {
    need(ctx, 'household', 'delete');
    if (!isUuid(id)) throw notFound('Member');
    const member = await this.prisma.householdMember.findFirst({ where: { id, householdId: ctx.householdId, deletedAt: null }, include: { role: true } });
    if (!member) throw notFound('Member');
    if (member.role.key === 'OWNER') {
      if (ctx.roleKey !== 'OWNER') throw forbidden('Only an owner can remove an owner');
      await this.assertNotLastOwner(ctx, member.id);
    }
    // userId is cleared so the person can be re-invited later; the profile stays for history.
    await this.prisma.householdMember.update({
      where: { id: member.id },
      data: { deletedAt: new Date(), status: 'REMOVED', userId: null, inviteTokenHash: null },
    });
    await this.audit.log(ctx, { action: 'delete', entityType: 'member', entityId: member.id, summary: `Removed member ${member.name}` });
  }

  /* ---------------- roles ---------------- */

  async listRoles(ctx: Ctx) {
    const roles = await this.prisma.role.findMany({ where: { householdId: ctx.householdId }, include: { permissions: true }, orderBy: { createdAt: 'asc' } });
    return roles.map((r: any) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.isSystem, permissions: permissionMap(r.permissions) }));
  }

  async updateRolePermissions(ctx: Ctx, roleId: string, body: any) {
    need(ctx, 'settings', 'write');
    if (ctx.roleKey !== 'OWNER') throw forbidden('Only an owner can change role permissions');
    if (!isUuid(roleId)) throw notFound('Role');
    const role = await this.prisma.role.findFirst({ where: { id: roleId, householdId: ctx.householdId } });
    if (!role) throw notFound('Role');
    if (role.key === 'OWNER') throw conflict('Owner permissions cannot be reduced', 'OWNER_ROLE_LOCKED');
    const perms = body?.permissions;
    if (!perms || typeof perms !== 'object') throw validationFailed([{ field: 'permissions', message: 'is required' }]);
    const updates: { module: string; canRead: boolean; canWrite: boolean; canDelete: boolean; canApprove: boolean }[] = [];
    for (const [module, value] of Object.entries(perms as Record<string, any>)) {
      if (!(MODULE_KEYS as readonly string[]).includes(module)) throw validationFailed([{ field: `permissions.${module}`, message: 'is not a known module' }]);
      const read = Boolean(value?.read);
      // Write, delete and approve are meaningless without read.
      updates.push({ module, canRead: read, canWrite: read && Boolean(value?.write), canDelete: read && Boolean(value?.delete), canApprove: read && Boolean(value?.approve) });
    }
    await this.prisma.$transaction(async (tx: Db) => {
      for (const u of updates) {
        await tx.permission.upsert({
          where: { roleId_module: { roleId: role.id, module: u.module } },
          update: { canRead: u.canRead, canWrite: u.canWrite, canDelete: u.canDelete, canApprove: u.canApprove },
          create: { householdId: ctx.householdId, roleId: role.id, ...u },
        });
      }
      await this.audit.log(ctx, { action: 'update', entityType: 'role', entityId: role.id, summary: `Changed permissions of role ${role.name}`, changes: perms }, tx);
    });
    return (await this.listRoles(ctx)).find((r: any) => r.id === role.id);
  }
}
