import { Injectable } from '@nestjs/common';
import { AUTO_REVIEW_THRESHOLD, DEFAULT_ROLE_PERMISSIONS, getResource, isUuid, validateRecord, type ExtractedInvoice } from '@homeos/shared';
import { AuditService } from '../common/audit.service';
import { need, type Ctx } from '../common/context';
import { safeEqual } from '../common/crypto';
import { badRequest, conflict, forbidden, notFound, validationFailed } from '../common/errors';
import { loadConfig } from '../config';
import { DocumentsService, type UploadedFile } from '../documents/documents.service';
import { PrismaService, type Db } from '../prisma.service';
import { ResourceService } from '../resources/resource.service';

const INBOX = getResource('inbox-items');
const BILLS = getResource('bills');
const PROVIDERS = getResource('bill-providers');
const EXPENSES = getResource('expenses');

/**
 * Unified inbox. Every incoming file becomes a document in the vault plus an inbox item
 * carrying the extracted fields. Nothing is filed as a bill or expense until a person
 * approves it; low-confidence extractions are flagged so they get a closer look.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: ResourceService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  private async createItem(ctx: Ctx, source: string, subject: string, senderEmail: string | null, documentId: string | null, extracted: ExtractedInvoice | null) {
    const row = await this.prisma.inboxItem.create({
      data: {
        householdId: ctx.householdId,
        createdById: ctx.userId,
        source,
        subject: subject.slice(0, 300),
        senderEmail,
        documentId,
        extracted: (extracted ?? { suggestedType: 'DOCUMENT', confidence: 0, found: [] }) as any,
        confidence: extracted?.confidence ?? 0,
        suggestedType: extracted?.suggestedType ?? 'DOCUMENT',
        status: 'PENDING_REVIEW',
      },
    });
    return { ...this.resources.present(INBOX, row, true), needsAttention: (extracted?.confidence ?? 0) < AUTO_REVIEW_THRESHOLD };
  }

  async upload(ctx: Ctx, file: UploadedFile | undefined, fields: Record<string, any>) {
    const { document, extracted } = await this.documents.upload(ctx, file, fields);
    return this.createItem(ctx, 'UPLOAD', document.title, null, document.id, extracted);
  }

  /**
   * Inbound e-mail webhook (for a mail provider's "forward to HTTP" feature).
   * Authenticated by a shared secret; the household is identified by its id in the payload.
   * Items are attributed to the household owner.
   */
  async inboundEmail(secret: string | undefined, body: any) {
    const expected = loadConfig().inboundEmailSecret;
    if (!expected) throw forbidden('Inbound e-mail is not configured', 'NOT_CONFIGURED');
    if (!secret || !safeEqual(secret, expected)) throw forbidden('Invalid inbound secret');
    const householdId = String(body?.householdId ?? '');
    if (!isUuid(householdId)) throw validationFailed([{ field: 'householdId', message: 'is required' }]);
    const owner = await this.prisma.householdMember.findFirst({
      where: { householdId, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' }, userId: { not: null } },
      include: { household: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) throw notFound('Household');
    const ctx: Ctx = {
      userId: owner.userId!,
      sessionId: 'inbound-email',
      householdId,
      memberId: owner.id,
      memberName: owner.name,
      roleKey: 'OWNER',
      perms: DEFAULT_ROLE_PERMISSIONS.OWNER,
      propertyScope: [],
      currency: owner.household.currency,
      approvalThreshold: null,
    };
    const subject = String(body?.subject ?? '(no subject)');
    const from = body?.from ? String(body.from).slice(0, 254) : null;
    const attachments: any[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 10) : [];
    const created: any[] = [];
    for (const a of attachments) {
      if (!a?.filename || !a?.contentBase64) continue;
      const buffer = Buffer.from(String(a.contentBase64), 'base64');
      const file: UploadedFile = { originalname: String(a.filename), mimetype: String(a.contentType ?? ''), size: buffer.length, buffer };
      const { document, extracted } = await this.documents.upload(ctx, file, { title: subject });
      created.push(await this.createItem(ctx, 'EMAIL', subject, from, document.id, extracted));
    }
    if (created.length === 0 && body?.text) {
      const buffer = Buffer.from(String(body.text), 'utf8');
      const file: UploadedFile = { originalname: 'email.txt', mimetype: 'text/plain', size: buffer.length, buffer };
      const { document, extracted } = await this.documents.upload(ctx, file, { title: subject });
      created.push(await this.createItem(ctx, 'EMAIL', subject, from, document.id, extracted));
    }
    if (created.length === 0) throw badRequest('The message has no attachment or text to file');
    return { created: created.length, items: created };
  }

  /**
   * File an inbox item. `type` is BILL, EXPENSE or DOCUMENT; `fields` are the values the
   * reviewer confirmed (the extracted values are only suggestions).
   */
  async approve(ctx: Ctx, id: string, body: any) {
    need(ctx, 'documents', 'write');
    if (!isUuid(id)) throw notFound('Inbox item');
    const item = await this.prisma.inboxItem.findFirst({ where: { id, householdId: ctx.householdId, deletedAt: null } });
    if (!item) throw notFound('Inbox item');
    if (item.status !== 'PENDING_REVIEW') throw conflict('This item has already been reviewed');
    const type = String(body?.type ?? item.suggestedType);
    const fields: Record<string, any> = body?.fields && typeof body.fields === 'object' ? body.fields : {};
    if (!['BILL', 'EXPENSE', 'DOCUMENT'].includes(type)) throw validationFailed([{ field: 'type', message: 'must be BILL, EXPENSE or DOCUMENT' }]);

    const result = await this.prisma.$transaction(async (tx: Db) => {
      let resultType = 'documents';
      let resultId: string | null = item.documentId;
      if (type === 'BILL') {
        need(ctx, 'bills', 'write');
        let providerId = fields.providerId as string | undefined;
        if (!providerId) {
          const providerName = String(fields.providerName ?? '').trim();
          if (!providerName) throw validationFailed([{ field: 'providerId', message: 'choose a utility account or enter a provider name' }]);
          const p = validateRecord(PROVIDERS, {
            name: providerName,
            providerName,
            utilityType: fields.utilityType || 'OTHER',
            ...(fields.consumerNumber ? { consumerNumber: fields.consumerNumber } : {}),
          });
          if (!p.ok) throw validationFailed(p.issues);
          providerId = (await this.resources.createInTx(PROVIDERS, ctx, p.data, tx)).id;
        }
        const v = validateRecord(BILLS, {
          providerId,
          amount: fields.amount,
          dueDate: fields.dueDate,
          ...(fields.billNumber ? { billNumber: fields.billNumber } : {}),
          ...(fields.billDate ? { billDate: fields.billDate } : {}),
          ...(item.documentId ? { documentId: item.documentId } : {}),
        });
        if (!v.ok) throw validationFailed(v.issues);
        resultType = 'bills';
        resultId = (await this.resources.createInTx(BILLS, ctx, v.data, tx)).id;
      } else if (type === 'EXPENSE') {
        need(ctx, 'finance', 'write');
        const v = validateRecord(EXPENSES, {
          date: fields.date,
          description: fields.description,
          amount: fields.amount,
          ...(fields.merchant ? { merchant: fields.merchant } : {}),
          ...(fields.category ? { category: fields.category } : {}),
          ...(fields.gstAmount ? { gstAmount: fields.gstAmount } : {}),
          ...(fields.invoiceNumber ? { invoiceNumber: fields.invoiceNumber } : {}),
          ...(fields.paymentMethod ? { paymentMethod: fields.paymentMethod } : {}),
          ...(item.documentId ? { documentId: item.documentId } : {}),
        });
        if (!v.ok) throw validationFailed(v.issues);
        resultType = 'expenses';
        resultId = (await this.resources.createInTx(EXPENSES, ctx, v.data, tx)).id;
      }
      const updated = await tx.inboxItem.update({
        where: { id: item.id },
        data: { status: 'APPROVED', resultType, resultId, reviewedById: ctx.memberId, reviewedAt: new Date() },
      });
      await this.audit.log(ctx, { action: 'approve', entityType: 'inbox-items', entityId: item.id, summary: `Filed inbox item "${item.subject}" as ${type.toLowerCase()}` }, tx);
      return updated;
    });
    return this.resources.present(INBOX, result, true);
  }

  async reject(ctx: Ctx, id: string) {
    need(ctx, 'documents', 'write');
    if (!isUuid(id)) throw notFound('Inbox item');
    const item = await this.prisma.inboxItem.findFirst({ where: { id, householdId: ctx.householdId, deletedAt: null } });
    if (!item) throw notFound('Inbox item');
    if (item.status !== 'PENDING_REVIEW') throw conflict('This item has already been reviewed');
    const updated = await this.prisma.inboxItem.update({ where: { id: item.id }, data: { status: 'REJECTED', reviewedById: ctx.memberId, reviewedAt: new Date() } });
    await this.audit.log(ctx, { action: 'reject', entityType: 'inbox-items', entityId: item.id, summary: `Dismissed inbox item "${item.subject}"` });
    return this.resources.present(INBOX, updated, true);
  }
}
