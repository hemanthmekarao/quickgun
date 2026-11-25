import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentAuth, CurrentCtx, Tenant, type AuthInfo, type Ctx } from '../common/context';
import { HouseholdsService } from './households.service';

@ApiTags('Households & members')
@Controller()
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  /** Create an additional household for the signed-in user. */
  @Post('households')
  @Authenticated()
  create(@CurrentAuth() auth: AuthInfo, @Body() body: any) {
    return this.households.createForUser(auth, body);
  }

  @Get('households')
  @Authenticated()
  list(@CurrentAuth() auth: AuthInfo) {
    return this.households.membershipsFor(auth.userId);
  }

  @Get('household')
  @Tenant()
  current(@CurrentCtx() ctx: Ctx) {
    return this.households.current(ctx);
  }

  @Patch('household')
  @Tenant()
  update(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.households.updateCurrent(ctx, body);
  }

  @Get('members')
  @Tenant()
  members(@CurrentCtx() ctx: Ctx) {
    return this.households.listMembers(ctx);
  }

  @Post('members')
  @Tenant()
  addMember(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.households.addMember(ctx, body);
  }

  @Patch('members/:id')
  @Tenant()
  updateMember(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.households.updateMember(ctx, id, body);
  }

  @Delete('members/:id')
  @HttpCode(204)
  @Tenant()
  async removeMember(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await this.households.removeMember(ctx, id);
  }

  @Get('roles')
  @Tenant()
  roles(@CurrentCtx() ctx: Ctx) {
    return this.households.listRoles(ctx);
  }

  @Put('roles/:id/permissions')
  @Tenant()
  updateRole(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.households.updateRolePermissions(ctx, id, body);
  }
}
