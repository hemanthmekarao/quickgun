import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentCtx, Tenant, type Ctx } from '../common/context';
import { AssistantService } from './assistant.service';

@ApiTags('AI assistant')
@Controller('assistant')
@Tenant()
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** What the assistant can and cannot do for the signed-in member. */
  @Get('capabilities')
  capabilities(@CurrentCtx() ctx: Ctx) {
    return this.assistant.capabilities(ctx);
  }

  /** Body: { question, conversationId? }. */
  @Post('ask')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  ask(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.assistant.ask(ctx, body);
  }

  @Get('conversations')
  conversations(@CurrentCtx() ctx: Ctx) {
    return this.assistant.conversations(ctx);
  }

  @Get('conversations/:id')
  conversation(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.assistant.conversation(ctx, id);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async remove(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await this.assistant.removeConversation(ctx, id);
  }
}
