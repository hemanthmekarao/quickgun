import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentCtx, Tenant, type Ctx } from '../common/context';
import { badRequest } from '../common/errors';
import { loadConfig } from '../config';
import { DocumentsService } from './documents.service';

/** Upload limit is enforced by multer before the handler runs. */
export const uploadInterceptor = () => FileInterceptor('file', { limits: { fileSize: loadConfig().maxUploadBytes, files: 1 } });

function sendFile(res: Response, file: { data: Buffer; mimeType: string; fileName: string }, inline: boolean): void {
  // Only formats that browsers render safely are shown inline; everything else downloads.
  const safeInline = inline && (file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/'));
  const encoded = encodeURIComponent(file.fileName);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.data.length));
  res.setHeader('Content-Disposition', `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(file.data);
}

@ApiTags('Document vault')
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** multipart/form-data: `file` plus optional metadata fields (title, categoryId, sensitivity, tags, expiryDate, …). */
  @Post('documents/upload')
  @Tenant()
  @UseInterceptors(uploadInterceptor())
  async upload(@CurrentCtx() ctx: Ctx, @UploadedFile() file: any, @Body() body: Record<string, any>) {
    const { document, extracted } = await this.documents.upload(ctx, file, body ?? {});
    return { ...document, _extracted: extracted };
  }

  @Post('documents/:id/versions')
  @Tenant()
  @UseInterceptors(uploadInterceptor())
  addVersion(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @UploadedFile() file: any, @Body() body: Record<string, any>) {
    return this.documents.addVersion(ctx, id, file, body?.note);
  }

  @Get('documents/:id/versions')
  @Tenant()
  versions(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.documents.versions(ctx, id);
  }

  /** Returns a link valid for five minutes. */
  @Get('documents/:id/download-url')
  @Tenant()
  downloadUrl(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('version') version?: string) {
    let v: number | undefined;
    if (version !== undefined) {
      v = Number(version);
      if (!Number.isInteger(v) || v < 1) throw badRequest('version must be a positive whole number');
    }
    return this.documents.downloadUrl(ctx, id, v);
  }

  @Get('documents/:id/shares')
  @Tenant()
  shares(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.documents.listShares(ctx, id);
  }

  @Post('documents/:id/shares')
  @Tenant()
  createShare(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.documents.createShare(ctx, id, body);
  }

  @Delete('document-shares/:id')
  @HttpCode(204)
  @Tenant()
  async revokeShare(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await this.documents.revokeShare(ctx, id);
  }

  @Get('document-search')
  @Tenant()
  search(@CurrentCtx() ctx: Ctx, @Query('q') q: string) {
    return this.documents.search(ctx, q);
  }

  /** Signed, expiring file link. No Authorization header: the signature is the credential. */
  @Get('files/:token')
  @SkipThrottle()
  async file(@Param('token') token: string, @Query('download') download: string | undefined, @Res() res: Response) {
    sendFile(res, await this.documents.serveSigned(token), download !== '1');
  }

  /** Public share link created by a household member. */
  @Get('shared/:token')
  async shared(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    sendFile(res, await this.documents.serveShared(token, (req.ip || '').replace(/^::ffff:/, '') || undefined), true);
  }
}
