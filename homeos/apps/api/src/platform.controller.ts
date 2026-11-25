import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { getResource } from '@homeos/shared';
import { llmConfigured } from './assistant/llm';
import { AuditService } from './common/audit.service';
import { CurrentCtx, Tenant, need, type Ctx } from './common/context';
import { validationFailed } from './common/errors';
import { loadConfig } from './config';
import { StorageService } from './documents/storage.service';
import { JobsService } from './jobs/jobs.service';
import { NotificationsService } from './notifications/notifications.service';
import { PaymentsService } from './payments/payments.service';
import { PrismaService } from './prisma.service';
import { ResourceService } from './resources/resource.service';

const DEVICES = getResource('smart-devices');

@ApiTags('Platform')
@Controller()
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
    private readonly resources: ResourceService,
    private readonly audit: AuditService,
  ) {}

  /** Liveness and database connectivity. */
  @Get('health')
  @SkipThrottle()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Which external integrations are connected in this deployment. Reports configuration only, never secrets. */
  @Get('integrations/status')
  @Tenant()
  integrations(@CurrentCtx() ctx: Ctx) {
    need(ctx, 'settings', 'read');
    const cfg = loadConfig();
    const channels = this.notifications.channelStatus();
    return [
      { key: 'storage', name: 'Document storage', connected: true, detail: this.storage.driverName === 's3' ? 'S3-compatible object storage, encrypted with the application key' : 'Local disk, encrypted with the application key' },
      { key: 'queue', name: 'Background jobs', connected: true, detail: this.jobs.mode === 'redis' ? 'Redis queue (BullMQ)' : 'In-process (single instance)' },
      { key: 'ai', name: 'AI model (assistant and image text extraction)', connected: llmConfigured(), detail: llmConfigured() ? `Model: ${cfg.openai.model}` : 'Not configured. The assistant uses built-in question types; images are stored without text extraction.' },
      { key: 'email', name: 'E-mail reminders (SMTP)', connected: channels.EMAIL.available, detail: channels.EMAIL.note },
      { key: 'inbound-email', name: 'Forward invoices by e-mail', connected: Boolean(cfg.inboundEmailSecret), detail: cfg.inboundEmailSecret ? 'Inbound webhook is enabled.' : 'Not configured. Needs a mail provider that forwards messages to the inbound webhook.' },
      { key: 'sms', name: 'SMS reminders', connected: false, detail: channels.SMS.note },
      { key: 'whatsapp', name: 'WhatsApp reminders', connected: false, detail: channels.WHATSAPP.note },
      { key: 'push', name: 'Mobile push notifications', connected: false, detail: channels.PUSH.note },
      ...this.payments.providers().filter((p) => p.key !== 'manual').map((p) => ({ key: `payments-${p.key}`, name: p.displayName, connected: p.enabled, detail: p.note })),
      { key: 'bank-feeds', name: 'Automatic bank transaction feeds', connected: false, detail: 'Not connected. Import statements as CSV on the transactions page. Live feeds need a licensed account aggregator.' },
      { key: 'smart-home', name: 'Smart home platforms', connected: false, detail: 'No platform adapter is connected. Devices can be registered and adapters can report state through the API.' },
    ];
  }

  /**
   * Integration point for smart-home adapters: report a device's latest state.
   * Body: { status?: "ONLINE" | "OFFLINE", state: { ... } }.
   */
  @Post('smart-home/devices/:id/state')
  @HttpCode(200)
  @Tenant()
  async deviceState(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    need(ctx, 'smarthome', 'write');
    const device = await this.resources.findRow(DEVICES, ctx, id);
    const state = body?.state;
    if (state === null || typeof state !== 'object' || Array.isArray(state)) throw validationFailed([{ field: 'state', message: 'must be an object' }]);
    if (JSON.stringify(state).length > 20_000) throw validationFailed([{ field: 'state', message: 'is too large' }]);
    const status = body?.status;
    if (status !== undefined && !['ONLINE', 'OFFLINE', 'UNKNOWN'].includes(status)) throw validationFailed([{ field: 'status', message: 'must be ONLINE, OFFLINE or UNKNOWN' }]);
    const row = await this.prisma.smartDevice.update({ where: { id: device.id }, data: { state, lastSeenAt: new Date(), ...(status ? { status } : {}) } });
    return this.resources.present(DEVICES, row, true);
  }
}
