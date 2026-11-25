import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  classifyDocument,
  extractInvoiceFields,
  getResource,
  isUuid,
  validateRecord,
  visibleSensitivities,
  type ExtractedInvoice,
} from '@homeos/shared';
import { AuditService } from '../common/audit.service';
import { need, type Ctx } from '../common/context';
import { hmac, randomToken, safeEqual, sha256 } from '../common/crypto';
import { ApiException, badRequest, forbidden, notFound, validationFailed } from '../common/errors';
import { loadConfig } from '../config';
import { PrismaService, type Db } from '../prisma.service';
import { ResourceService } from '../resources/resource.service';
import { StorageService } from './storage.service';
import { contentMatches, extractText, resolveMime } from './text-extract';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const DOCS = getResource('documents');
const SIGNED_URL_TTL_SECONDS = 300;

function cleanFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'file').replace(/[\u0000-\u001f"<>|:*?]/g, '_').trim();
  return (base || 'file').slice(0, 200);
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ResourceService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Validate the upload and return its trusted content type. */
  private inspect(file: UploadedFile | undefined): { fileName: string; mime: string } {
    if (!file || !file.buffer || file.size === 0) throw validationFailed([{ field: 'file', message: 'is required' }]);
    if (file.size > loadConfig().maxUploadBytes) throw new ApiException(413, 'TOO_LARGE', 'The file is too large');
    const fileName = cleanFileName(file.originalname);
    const mime = resolveMime(fileName, file.mimetype);
    if (!mime) throw new ApiException(415, 'UNSUPPORTED_TYPE', 'This file type is not supported. Upload a PDF, image, text or office document.');
    if (!contentMatches(mime, file.buffer)) throw new ApiException(415, 'UNSUPPORTED_TYPE', 'The file contents do not match its extension');
    return { fileName, mime };
  }

  /**
   * Store a new document. Metadata comes from multipart form fields (strings); `tags` and
   * `restrictedToMemberIds` may be JSON arrays or comma-separated.
   */
  async upload(ctx: Ctx, file: UploadedFile | undefined, fields: Record<string, any>): Promise<{ document: Record<string, any>; extracted: ExtractedInvoice | null }> {
    need(ctx, 'documents', 'write');
    const { fileName, mime } = this.inspect(file);
    const data = file!.buffer;

    const body: Record<string, any> = {};
    for (const f of DOCS.fields) {
      if (f.system || fields[f.key] === undefined || fields[f.key] === '') continue;
      if (f.type === 'tags') {
        const raw = fields[f.key];
        if (Array.isArray(raw)) body[f.key] = raw;
        else {
          const s = String(raw).trim();
          try {
            body[f.key] = s.startsWith('[') ? JSON.parse(s) : s.split(',').map((x) => x.trim()).filter(Boolean);
          } catch {
            throw validationFailed([{ field: f.key, message: 'must be a list' }]);
          }
        }
      } else body[f.key] = fields[f.key];
    }
    if (!body.title) body.title = fileName.replace(/\.[^.]+$/, '') || fileName;
    const explicitSensitivity = body.sensitivity !== undefined;
    const result = validateRecord(DOCS, body);
    if (!result.ok) throw validationFailed(result.issues);
    const meta = result.data;

    const { text, status } = await extractText(data, mime);
    const extracted = text ? extractInvoiceFields(text) : null;

    // Category: explicit choice, else a suggestion from the content; sensitivity defaults from the category.
    let category: any = null;
    if (meta.categoryId) {
      category = await this.prisma.documentCategory.findFirst({ where: { id: meta.categoryId as string, householdId: ctx.householdId, deletedAt: null } });
    } else {
      const suggested = classifyDocument(fileName, text);
      if (suggested) {
        category = await this.prisma.documentCategory.findFirst({ where: { householdId: ctx.householdId, deletedAt: null, name: suggested } });
        if (category) meta.categoryId = category.id;
      }
    }
    if (!explicitSensitivity && category?.defaultSensitivity) {
      // Never classify above what the uploader may see, otherwise they would lose their own upload.
      meta.sensitivity = visibleSensitivities(ctx.perms).includes(category.defaultSensitivity) ? category.defaultSensitivity : 'NORMAL';
    }

    const storageKey = `${ctx.householdId}/${randomToken(16)}/v1`;
    const checksum = sha256(data);
    await this.storage.put(storageKey, data);
    try {
      const row = await this.prisma.$transaction(async (tx: Db) => {
        const created = await this.resources.createInTx(
          DOCS,
          ctx,
          {
            ...meta,
            fileName,
            mimeType: mime,
            sizeBytes: data.length,
            storageKey,
            checksum,
            currentVersion: 1,
            extractedText: text || null,
            extractedData: extracted ? (extracted as any) : undefined,
            ocrStatus: status,
          },
          tx,
        );
        await tx.documentVersion.create({
          data: { householdId: ctx.householdId, documentId: created.id, version: 1, fileName, mimeType: mime, sizeBytes: data.length, storageKey, checksum, createdById: ctx.userId },
        });
        return created;
      });
      const document = this.resources.present(DOCS, row, true);
      await this.resources.attachRefs(DOCS, ctx, [document]);
      return { document, extracted };
    } catch (err) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw err;
    }
  }

  /** Add a new version. Earlier versions are kept unchanged and remain downloadable. */
  async addVersion(ctx: Ctx, id: string, file: UploadedFile | undefined, note?: string) {
    need(ctx, 'documents', 'write');
    const doc = await this.resources.findRow(DOCS, ctx, id);
    const { fileName, mime } = this.inspect(file);
    const data = file!.buffer;
    const version = doc.currentVersion + 1;
    const storageKey = `${doc.storageKey.replace(/\/v\d+$/, '')}/v${version}`;
    const checksum = sha256(data);
    const { text, status } = await extractText(data, mime);
    await this.storage.put(storageKey, data);
    const row = await this.prisma.$transaction(async (tx: Db) => {
      await tx.documentVersion.create({
        data: { householdId: ctx.householdId, documentId: doc.id, version, fileName, mimeType: mime, sizeBytes: data.length, storageKey, checksum, note: note?.slice(0, 300) ?? null, createdById: ctx.userId },
      });
      const updated = await tx.document.update({
        where: { id: doc.id },
        data: {
          fileName,
          mimeType: mime,
          sizeBytes: data.length,
          storageKey,
          checksum,
          currentVersion: version,
          extractedText: text || null,
          extractedData: text ? (extractInvoiceFields(text) as any) : Prisma.DbNull,
          ocrStatus: status,
        },
      });
      await this.audit.log(ctx, { action: 'version', entityType: 'documents', entityId: doc.id, summary: `Uploaded version ${version} of "${doc.title}"` }, tx);
      return updated;
    });
    return this.resources.present(DOCS, row, true);
  }

  async versions(ctx: Ctx, id: string) {
    need(ctx, 'documents', 'read');
    const doc = await this.resources.findRow(DOCS, ctx, id);
    const rows = await this.prisma.documentVersion.findMany({ where: { documentId: doc.id, householdId: ctx.householdId }, orderBy: { version: 'desc' } });
    return rows.map((v: any) => ({
      id: v.id,
      version: v.version,
      fileName: v.fileName,
      mimeType: v.mimeType,
      sizeBytes: v.sizeBytes,
      checksum: v.checksum,
      note: v.note,
      createdAt: v.createdAt,
      current: v.version === doc.currentVersion,
    }));
  }

  /* ---------------- signed downloads ---------------- */

  private sign(payload: string): string {
    return hmac(`files:${loadConfig().jwtSecret}`, payload);
  }

  /** Short-lived link that can be opened without an Authorization header (browser tab, <img>, native viewer). */
  async downloadUrl(ctx: Ctx, id: string, version?: number) {
    need(ctx, 'documents', 'read');
    const doc = await this.resources.findRow(DOCS, ctx, id);
    const v = version ?? doc.currentVersion;
    const exists = await this.prisma.documentVersion.count({ where: { documentId: doc.id, householdId: ctx.householdId, version: v } });
    if (!exists) throw notFound('Document version');
    const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const payload = Buffer.from(JSON.stringify({ d: doc.id, v, e: expires })).toString('base64url');
    const token = `${payload}.${this.sign(payload)}`;
    await this.audit.log(ctx, { action: 'download', entityType: 'documents', entityId: doc.id, summary: `Opened "${doc.title}" (v${v})` });
    return { url: `${loadConfig().publicApiUrl}/v1/files/${token}`, path: `/files/${token}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  async serveSigned(token: string): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
    const [payload, sig] = String(token).split('.');
    if (!payload || !sig || !safeEqual(sig, this.sign(payload))) throw forbidden('This link is not valid', 'LINK_INVALID');
    let parsed: { d: string; v: number; e: number };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw forbidden('This link is not valid', 'LINK_INVALID');
    }
    if (!parsed.e || parsed.e * 1000 < Date.now()) throw forbidden('This link has expired', 'LINK_EXPIRED');
    const version = await this.prisma.documentVersion.findFirst({ where: { documentId: parsed.d, version: parsed.v, document: { deletedAt: null } } });
    if (!version) throw notFound('Document');
    return { data: await this.storage.get(version.storageKey), mimeType: version.mimeType, fileName: version.fileName };
  }

  /* ---------------- sharing ---------------- */

  /**
   * Create an external share link. Only a person can do this (the assistant has no such tool),
   * the link always expires, and every use is recorded.
   */
  async createShare(ctx: Ctx, id: string, body: any) {
    need(ctx, 'documents', 'write');
    const doc = await this.resources.findRow(DOCS, ctx, id);
    const days = Number(body?.expiresInDays ?? 7);
    if (!Number.isFinite(days) || days < 1 || days > 30) throw validationFailed([{ field: 'expiresInDays', message: 'must be between 1 and 30' }]);
    let maxDownloads: number | null = null;
    if (body?.maxDownloads !== undefined && body.maxDownloads !== null && body.maxDownloads !== '') {
      maxDownloads = Number(body.maxDownloads);
      if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 1000) throw validationFailed([{ field: 'maxDownloads', message: 'must be between 1 and 1000' }]);
    }
    if (doc.sensitivity !== 'NORMAL' && body?.confirmSensitive !== true) {
      throw badRequest(`This is a ${String(doc.sensitivity).toLowerCase()} document. Confirm that you want to share it outside the household.`, undefined, 'CONFIRM_SENSITIVE_SHARE');
    }
    const token = randomToken(32);
    const share = await this.prisma.documentShare.create({
      data: {
        householdId: ctx.householdId,
        documentId: doc.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + days * 86_400_000),
        maxDownloads,
        note: body?.note ? String(body.note).slice(0, 300) : null,
        createdById: ctx.userId,
      },
    });
    await this.audit.log(ctx, { action: 'share', entityType: 'documents', entityId: doc.id, summary: `Created a share link for "${doc.title}" valid for ${days} day(s)` });
    return {
      id: share.id,
      // Shown once; only a hash is stored.
      url: `${loadConfig().publicApiUrl}/v1/shared/${token}`,
      expiresAt: share.expiresAt,
      maxDownloads,
    };
  }

  async listShares(ctx: Ctx, id: string) {
    need(ctx, 'documents', 'read');
    const doc = await this.resources.findRow(DOCS, ctx, id);
    const rows = await this.prisma.documentShare.findMany({ where: { documentId: doc.id, householdId: ctx.householdId }, orderBy: { createdAt: 'desc' } });
    return rows.map((s: any) => ({
      id: s.id,
      expiresAt: s.expiresAt,
      maxDownloads: s.maxDownloads,
      downloadCount: s.downloadCount,
      revokedAt: s.revokedAt,
      note: s.note,
      createdAt: s.createdAt,
      active: !s.revokedAt && s.expiresAt > new Date() && (s.maxDownloads === null || s.downloadCount < s.maxDownloads),
    }));
  }

  async revokeShare(ctx: Ctx, shareId: string) {
    need(ctx, 'documents', 'write');
    if (!isUuid(shareId)) throw notFound('Share link');
    const share = await this.prisma.documentShare.findFirst({ where: { id: shareId, householdId: ctx.householdId } });
    if (!share) throw notFound('Share link');
    await this.resources.findRow(DOCS, ctx, share.documentId); // caller must be able to see the document
    await this.prisma.documentShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
    await this.audit.log(ctx, { action: 'unshare', entityType: 'documents', entityId: share.documentId, summary: 'Revoked a share link' });
  }

  async serveShared(token: string, ip?: string): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
    const share = await this.prisma.documentShare.findUnique({ where: { tokenHash: sha256(String(token)) }, include: { document: true } });
    const invalid = () => notFound('Shared document');
    if (!share || share.revokedAt || share.expiresAt <= new Date() || share.document.deletedAt) throw invalid();
    // Atomic increment guarded by the limit so concurrent requests cannot exceed it.
    const bumped = await this.prisma.documentShare.updateMany({
      where: { id: share.id, revokedAt: null, ...(share.maxDownloads !== null ? { downloadCount: { lt: share.maxDownloads } } : {}) },
      data: { downloadCount: { increment: 1 } },
    });
    if (bumped.count === 0) throw invalid();
    await this.prisma.auditLog.create({
      data: {
        householdId: share.householdId,
        action: 'shared-download',
        entityType: 'documents',
        entityId: share.documentId,
        summary: `"${share.document.title}" was downloaded through a share link`,
        ip: ip ?? null,
      },
    });
    return { data: await this.storage.get(share.document.storageKey), mimeType: share.document.mimeType, fileName: share.document.fileName };
  }

  /* ---------------- search ---------------- */

  /**
   * Full-text search over title, description, file name, tags and extracted text.
   * The ranked ids from PostgreSQL are re-read through the caller's access scope, so results
   * never include documents the caller may not open.
   */
  async search(ctx: Ctx, query: string, limit = 25) {
    need(ctx, 'documents', 'read');
    const q = String(query ?? '').trim().slice(0, 200);
    if (!q) return { items: [], total: 0 };
    const ranked: { id: string; rank: number; snippet: string | null }[] = await this.prisma.$queryRaw`
      SELECT d."id"::text AS id,
             ts_rank(
               to_tsvector('english', coalesce(d."title", '') || ' ' || coalesce(d."description", '') || ' ' || coalesce(d."fileName", '') || ' ' || array_to_string(d."tags", ' ') || ' ' || coalesce(d."extractedText", '')),
               websearch_to_tsquery('english', ${q})
             )::float8 AS rank,
             CASE WHEN d."extractedText" IS NULL THEN NULL
                  ELSE ts_headline('english', d."extractedText", websearch_to_tsquery('english', ${q}), 'MaxWords=24, MinWords=8, StartSel=«, StopSel=»')
             END AS snippet
      FROM "Document" d
      WHERE d."householdId" = ${ctx.householdId}::uuid
        AND d."deletedAt" IS NULL
        AND to_tsvector('english', coalesce(d."title", '') || ' ' || coalesce(d."description", '') || ' ' || coalesce(d."fileName", '') || ' ' || array_to_string(d."tags", ' ') || ' ' || coalesce(d."extractedText", ''))
            @@ websearch_to_tsquery('english', ${q})
      ORDER BY rank DESC
      LIMIT 100`;
    const scope = this.resources.scope(DOCS, ctx);
    // Partial-word matches on the title/file name, which full-text search does not cover.
    const partial: any[] = await this.prisma.document.findMany({
      where: {
        ...scope,
        OR: [{ title: { contains: q, mode: 'insensitive' } }, { fileName: { contains: q, mode: 'insensitive' } }, { tags: { has: q } }],
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    const rankedIds = ranked.map((r) => r.id);
    const visible: any[] = rankedIds.length
      ? await this.prisma.document.findMany({ where: { ...scope, id: { in: rankedIds } } })
      : [];
    const byId = new Map<string, any>(visible.map((d) => [d.id, d]));
    const ordered: any[] = [];
    const seen = new Set<string>();
    for (const r of ranked) {
      const d = byId.get(r.id);
      if (d && !seen.has(d.id)) {
        seen.add(d.id);
        ordered.push({ ...this.resources.present(DOCS, d, false), _snippet: r.snippet && r.snippet.includes('«') ? r.snippet : null });
      }
    }
    for (const d of partial) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        ordered.push({ ...this.resources.present(DOCS, d, false), _snippet: null });
      }
    }
    const items = ordered.slice(0, limit);
    await this.resources.attachRefs(DOCS, ctx, items);
    return { items, total: ordered.length };
  }
}
