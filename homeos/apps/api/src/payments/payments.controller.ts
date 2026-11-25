import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentCtx, Tenant, type Ctx } from '../common/context';
import { badRequest } from '../common/errors';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Which payment providers are available, and how each one verifies payments. */
  @Get('providers')
  @Tenant()
  providers() {
    return this.payments.providers();
  }

  /** Record a payment made outside HomeOS (cash, UPI app, bank transfer…). Self-reported, not verified. */
  @Post('record-offline')
  @Tenant()
  recordOffline(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.payments.recordOffline(ctx, body);
  }

  /** Start or schedule a payment through a connected provider. */
  @Post('orders')
  @Tenant()
  create(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.payments.createOrder(ctx, body);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @Tenant()
  cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.payments.cancel(ctx, id);
  }

  @Post('orders/:id/refunds')
  @Tenant()
  refund(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.payments.recordRefund(ctx, id, body);
  }

  @Get('orders/:id/receipt')
  @Tenant()
  receipt(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.payments.receipt(ctx, id);
  }

  /** Demo environments only: resolve a simulated payment. Body: { outcome: "succeeded" | "failed" }. */
  @Post('orders/:id/sandbox-resolve')
  @HttpCode(200)
  @Tenant()
  sandboxResolve(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    const outcome = body?.outcome;
    if (outcome !== 'succeeded' && outcome !== 'failed') throw badRequest('outcome must be "succeeded" or "failed"');
    return this.payments.sandboxResolve(ctx, id, outcome);
  }

  /** Provider → HomeOS webhook. Authenticated by the provider's signature over the raw body. */
  @Post('webhooks/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Headers() headers: Record<string, any>, @Req() req: Request) {
    return this.payments.handleWebhook(provider, headers, (req as any).rawBody);
  }
}
