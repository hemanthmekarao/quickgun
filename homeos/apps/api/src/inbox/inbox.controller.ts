import { Body, Controller, Headers, HttpCode, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentCtx, Tenant, type Ctx } from '../common/context';
import { uploadInterceptor } from '../documents/documents.controller';
import { InboxService } from './inbox.service';

@ApiTags('Unified inbox')
@Controller()
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  /** Upload a bill, receipt or other paper. Returns the inbox item with extracted fields for review. */
  @Post('inbox/upload')
  @Tenant()
  @UseInterceptors(uploadInterceptor())
  upload(@CurrentCtx() ctx: Ctx, @UploadedFile() file: any, @Body() body: Record<string, any>) {
    return this.inbox.upload(ctx, file, body ?? {});
  }

  /** Webhook for forwarded e-mail. Requires the X-Inbound-Secret header. */
  @Post('inbox/email')
  @HttpCode(200)
  email(@Headers('x-inbound-secret') secret: string | undefined, @Body() body: any) {
    return this.inbox.inboundEmail(secret, body);
  }

  @Post('inbox-items/:id/approve')
  @HttpCode(200)
  @Tenant()
  approve(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.inbox.approve(ctx, id, body);
  }

  @Post('inbox-items/:id/reject')
  @HttpCode(200)
  @Tenant()
  reject(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.inbox.reject(ctx, id);
  }
}
