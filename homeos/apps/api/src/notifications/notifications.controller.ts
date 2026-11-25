import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuth, CurrentCtx, Tenant, type AuthInfo, type Ctx } from '../common/context';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications & reminders')
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Unread and critical counts for the signed-in member. */
  @Get('notification-summary')
  @Tenant()
  summary(@CurrentCtx() ctx: Ctx) {
    return this.notifications.summary(ctx);
  }

  @Get('notification-channels')
  @Tenant()
  channels() {
    return this.notifications.channelStatus();
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  @Tenant()
  readAll(@CurrentCtx() ctx: Ctx) {
    return this.notifications.markAllRead(ctx);
  }

  /** Evaluate reminder rules for this household now (the scheduler does this daily). */
  @Post('notifications/scan')
  @HttpCode(200)
  @Tenant()
  scan(@CurrentCtx() ctx: Ctx) {
    return this.notifications.scanNow(ctx);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  @Tenant()
  read(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.notifications.markRead(ctx, id);
  }

  /** Register a device token for push notifications (used by the mobile apps). */
  @Post('devices')
  @Authenticated()
  registerDevice(@CurrentAuth() auth: AuthInfo, @Body() body: any) {
    return this.notifications.registerDevice(auth, body);
  }

  @Delete('devices/:token')
  @HttpCode(204)
  @Authenticated()
  async unregisterDevice(@CurrentAuth() auth: AuthInfo, @Param('token') token: string) {
    await this.notifications.unregisterDevice(auth, token);
  }
}
