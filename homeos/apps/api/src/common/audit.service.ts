import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, type Db } from '../prisma.service';
import type { Ctx } from './context';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  changes?: unknown;
}

const REDACTED = new Set(['passwordHash', 'mfaSecret', 'storageKey', 'rawPayload', 'extractedText', 'refreshTokenHash']);

function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && typeof (value as any).toNumber === 'function') return (value as any).toNumber();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') return JSON.parse(JSON.stringify(value));
  return value;
}

/** Field-level before/after for the fields that actually changed. */
export function diff(before: Record<string, any> | null, after: Record<string, any>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (['updatedAt', 'createdAt', 'id', 'householdId'].includes(key)) continue;
    const from = before ? plain(before[key]) : null;
    const to = plain(after[key]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    out[key] = REDACTED.has(key) ? { from: '[redacted]', to: '[redacted]' } : { from, to };
  }
  return out;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  /** Append an audit entry. Pass the transaction client as `db` to make it atomic with the change. */
  async log(ctx: Pick<Ctx, 'householdId' | 'userId' | 'memberId' | 'ip' | 'userAgent'>, entry: AuditEntry, db?: Db): Promise<void> {
    const client: Db = db ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          householdId: ctx.householdId,
          actorUserId: ctx.userId,
          actorMemberId: ctx.memberId || null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          summary: entry.summary.slice(0, 500),
          changes: entry.changes === undefined ? undefined : (plain(entry.changes) as any),
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          createdById: ctx.userId,
        },
      });
    } catch (err) {
      // Inside a transaction the failure must abort the change; outside one we only report it.
      if (db) throw err;
      this.logger.error(`Failed to write audit entry: ${(err as Error).message}`);
    }
  }
}
