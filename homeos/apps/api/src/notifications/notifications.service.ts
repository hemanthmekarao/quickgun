import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { addDays, dueReminders, getResource, isUuid, monthKey, startOfDay, type DueReminder } from '@homeos/shared';
import { AuditService } from '../common/audit.service';
import { need, permissionMap, type AuthInfo, type Ctx } from '../common/context';
import { notFound, validationFailed } from '../common/errors';
import { systemCtx } from '../common/system-ctx';
import { loadConfig } from '../config';
import { InsightsService } from '../insights/insights.service';
import { JobsService } from '../jobs/jobs.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma.service';
import { ResourceService } from '../resources/resource.service';
import { StaffService } from '../staff/staff.controller';

const NOTIFICATIONS = getResource('notifications');

type ChannelResult = 'DELIVERED' | 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'NO_ADDRESS';

/**
 * Reminder engine and delivery.
 *
 * In-app delivery is always available. E-mail is sent when SMTP is configured. SMS,
 * WhatsApp and push are declared channels whose adapters are not connected; a reminder
 * that asks for them records NOT_CONFIGURED instead of pretending it was delivered.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('Notifications');
  private mailer: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ResourceService,
    private readonly insights: InsightsService,
    private readonly staff: StaffService,
    private readonly payments: PaymentsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('reminders.scan-household', async (p: { householdId: string }) => {
      await this.scanHousehold(p.householdId);
    });
    this.jobs.register('email.send', async (p: { to: string; subject: string; text: string }) => {
      await this.sendEmail(p.to, p.subject, p.text);
    });
  }

  channelStatus() {
    const cfg = loadConfig();
    return {
      IN_APP: { available: true, note: 'Always on.' },
      EMAIL: { available: Boolean(cfg.smtpUrl), note: cfg.smtpUrl ? 'SMTP is configured.' : 'Set SMTP_URL to enable e-mail reminders.' },
      SMS: { available: false, note: 'No SMS provider is connected.' },
      WHATSAPP: { available: false, note: 'No WhatsApp Business provider is connected.' },
      PUSH: { available: false, note: 'Device tokens can be registered, but no push service (FCM/APNs) is connected yet.' },
    };
  }

  private async sendEmail(to: string, subject: string, text: string): Promise<void> {
    const cfg = loadConfig();
    if (!cfg.smtpUrl) return;
    if (!this.mailer) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.mailer = require('nodemailer').createTransport(cfg.smtpUrl);
    }
    await this.mailer.sendMail({ from: cfg.mailFrom, to, subject, text });
  }

  /* ---------------- scheduled work ---------------- */

  /** 02:30 UTC = 08:00 IST. */
  @Cron('30 2 * * *')
  async dailyScan(): Promise<void> {
    if (!loadConfig().schedulerEnabled) return;
    const households: any[] = await this.prisma.household.findMany({ where: { deletedAt: null }, select: { id: true } });
    for (const h of households) await this.jobs.enqueue('reminders.scan-household', { householdId: h.id });
    this.logger.log(`Queued reminder scans for ${households.length} household(s)`);
  }

  @Cron('5 * * * *')
  async hourly(): Promise<void> {
    if (!loadConfig().schedulerEnabled) return;
    const started = await this.payments.startDueScheduled();
    if (started) this.logger.log(`Started ${started} scheduled payment(s)`);
  }

  /**
   * Evaluate reminder rules for one household and create notifications.
   * Events are computed separately for each member using that member's own permissions,
   * so nobody is notified about a record they could not open.
   */
  async scanHousehold(householdId: string): Promise<{ created: number; members: number }> {
    const sys = await systemCtx(this.prisma, householdId, 'reminders');
    if (!sys) return { created: 0, members: 0 };
    const today = startOfDay(new Date());

    // Make sure this month's salary records exist so salary reminders have something to point at.
    try {
      await this.staff.generateSalaries(sys, monthKey(today));
    } catch (err) {
      this.logger.warn(`Salary generation skipped for ${householdId}: ${(err as Error).message}`);
    }

    const rules: any[] = await this.prisma.reminderRule.findMany({ where: { householdId, deletedAt: null, enabled: true } });
    if (rules.length === 0) return { created: 0, members: 0 };
    const maxOffset = Math.max(0, ...rules.flatMap((r) => (r.offsetsDays as string[]).map(Number).filter(Number.isFinite)));

    const members: any[] = await this.prisma.householdMember.findMany({
      where: { householdId, deletedAt: null, status: 'ACTIVE', userId: { not: null } },
      include: { role: { include: { permissions: true } }, user: true },
    });
    let created = 0;
    for (const m of members) {
      const ctx: Ctx = { ...sys, userId: m.userId, memberId: m.id, memberName: m.name, roleKey: m.role.key, perms: permissionMap(m.role.permissions), propertyScope: m.propertyScope ?? [] };
      if (!ctx.perms.notifications?.read) continue;
      const events = await this.insights.events(ctx, addDays(today, -45), addDays(today, maxOffset + 1));
      const due = dueReminders(events, rules, today);
      const budgetAlerts = await this.budgetAlerts(ctx, today);
      created += await this.deliver(ctx, m, [...due.map((d) => this.fromReminder(d)), ...budgetAlerts]);
    }
    return { created, members: members.length };
  }

  private fromReminder(d: DueReminder) {
    return {
      title: d.title,
      body: d.event.amount !== undefined ? `${d.body} Amount: ${d.event.amount.toLocaleString('en-IN')}.` : d.body,
      eventType: d.event.eventType,
      entityType: d.event.resource,
      entityId: d.event.entityId,
      dueDate: d.event.date,
      severity: d.severity,
      dedupeKey: d.dedupeKey,
      channels: d.channels as string[],
    };
  }

  private async budgetAlerts(ctx: Ctx, today: Date) {
    if (!ctx.perms.finance?.read) return [];
    const statuses = await this.insights.budgetStatus(ctx);
    return statuses
      .filter((b) => b.state !== 'OK')
      .map((b) => ({
        title: b.state === 'OVER' ? `Budget exceeded: ${b.name}` : `Budget alert: ${b.name}`,
        body: `${b.percentUsed}% of the ${String(b.period).toLowerCase()} budget has been used (${b.used.toLocaleString('en-IN')} of ${b.amount.toLocaleString('en-IN')}).`,
        eventType: 'BUDGET_ALERT',
        entityType: 'budgets',
        entityId: b.id,
        dueDate: today.toISOString().slice(0, 10),
        severity: b.state === 'OVER' ? 'CRITICAL' : 'WARNING',
        dedupeKey: `budget:${b.id}:${b.periodStart}:${b.state}`,
        channels: ['IN_APP'],
      }));
  }

  private async deliver(ctx: Ctx, member: any, items: { title: string; body: string; eventType: string; entityType: string; entityId: string; dueDate: string; severity: string; dedupeKey: string; channels: string[] }[]): Promise<number> {
    if (items.length === 0) return 0;
    const existing: any[] = await this.prisma.notification.findMany({
      where: { householdId: ctx.householdId, recipientMemberId: member.id, dedupeKey: { in: items.map((i) => i.dedupeKey) } },
      select: { dedupeKey: true },
    });
    const have = new Set(existing.map((e) => e.dedupeKey));
    const available = this.channelStatus();
    let created = 0;
    for (const item of items) {
      if (have.has(item.dedupeKey)) continue;
      have.add(item.dedupeKey);
      const status: Record<string, ChannelResult> = { IN_APP: 'DELIVERED' };
      for (const channel of item.channels) {
        if (channel === 'IN_APP') continue;
        if (channel === 'EMAIL') {
          const to = member.user?.email ?? member.email;
          if (!available.EMAIL.available) status.EMAIL = 'NOT_CONFIGURED';
          else if (!to) status.EMAIL = 'NO_ADDRESS';
          else {
            await this.jobs.enqueue('email.send', { to, subject: `HomeOS: ${item.title}`, text: `${item.body}\n\nOpen HomeOS: ${loadConfig().publicWebUrl}/notifications` });
            status.EMAIL = 'SENT';
          }
        } else status[channel] = 'NOT_CONFIGURED';
      }
      try {
        await this.prisma.notification.create({
          data: {
            householdId: ctx.householdId,
            recipientMemberId: member.id,
            title: item.title.slice(0, 300),
            body: item.body.slice(0, 1000),
            eventType: item.eventType,
            entityType: item.entityType,
            entityId: item.entityId,
            dueDate: new Date(`${item.dueDate}T00:00:00Z`),
            severity: item.severity,
            dedupeKey: item.dedupeKey,
            channelStatus: status as any,
            status: 'ACTIVE',
          },
        });
        created++;
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err; // created concurrently by another scan
      }
    }
    return created;
  }

  /* ---------------- member-facing ---------------- */

  async scanNow(ctx: Ctx) {
    need(ctx, 'notifications', 'write');
    return this.scanHousehold(ctx.householdId);
  }

  async summary(ctx: Ctx) {
    need(ctx, 'notifications', 'read');
    const where = { ...this.resources.scope(NOTIFICATIONS, ctx), readAt: null };
    const [unread, critical] = await Promise.all([this.prisma.notification.count({ where }), this.prisma.notification.count({ where: { ...where, severity: 'CRITICAL' } })]);
    return { unread, critical };
  }

  async markRead(ctx: Ctx, id: string) {
    need(ctx, 'notifications', 'read');
    if (!isUuid(id)) throw notFound('Notification');
    const res = await this.prisma.notification.updateMany({ where: { ...this.resources.scope(NOTIFICATIONS, ctx), id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  async markAllRead(ctx: Ctx) {
    need(ctx, 'notifications', 'read');
    const res = await this.prisma.notification.updateMany({ where: { ...this.resources.scope(NOTIFICATIONS, ctx), readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  /* ---------------- push device registry ---------------- */

  async registerDevice(auth: AuthInfo, body: any) {
    const token = String(body?.token ?? '').trim();
    const platform = String(body?.platform ?? '').toLowerCase();
    const issues = [];
    if (token.length < 10 || token.length > 500) issues.push({ field: 'token', message: 'is required' });
    if (!['ios', 'android', 'web'].includes(platform)) issues.push({ field: 'platform', message: 'must be ios, android or web' });
    if (issues.length) throw validationFailed(issues);
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId: auth.userId, platform, lastSeenAt: new Date() },
      create: { userId: auth.userId, token, platform },
    });
    return { registered: true, pushDeliveryAvailable: false };
  }

  async unregisterDevice(auth: AuthInfo, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId: auth.userId } });
  }
}
