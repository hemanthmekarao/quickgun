import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Type } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { RESOURCES, type ResourceDef } from '@homeos/shared';
import { CurrentCtx, Tenant, type Ctx } from '../common/context';
import { ResourceService } from './resource.service';

/**
 * Builds one REST controller per registry resource:
 *   GET /<key>, GET /<key>/:id, and (unless read-only) POST, PATCH /:id, DELETE /:id.
 * The routes are documented from the same registry (see openapi.ts), so they are excluded
 * from decorator scanning here.
 */
export function createResourceController(def: ResourceDef): Type<any> {
  @ApiExcludeController()
  @Controller(def.key)
  @Tenant()
  class ResourceController {
    constructor(readonly resources: ResourceService) {}

    @Get()
    list(@CurrentCtx() ctx: Ctx, @Query() query: Record<string, any>) {
      return this.resources.list(def, ctx, query);
    }

    @Post()
    create(@CurrentCtx() ctx: Ctx, @Body() body: unknown) {
      return this.resources.create(def, ctx, body);
    }

    @Get(':id')
    get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
      return this.resources.get(def, ctx, id);
    }

    @Patch(':id')
    update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: unknown) {
      return this.resources.update(def, ctx, id, body);
    }

    @Delete(':id')
    @HttpCode(204)
    async remove(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
      await this.resources.remove(def, ctx, id);
    }
  }
  Object.defineProperty(ResourceController, 'name', { value: `${def.model}ResourceController` });
  return ResourceController;
}

export const RESOURCE_CONTROLLERS: Type<any>[] = RESOURCES.map(createResourceController);
