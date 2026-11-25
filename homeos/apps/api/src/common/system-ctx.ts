import { DEFAULT_ROLE_PERMISSIONS } from '@homeos/shared';
import type { PrismaService } from '../prisma.service';
import type { Ctx } from './context';

/**
 * Context for work the system does on behalf of a household (scheduled scans, inbound mail).
 * Actions are attributed to the household's first owner. Returns null if there is none.
 */
export async function systemCtx(prisma: PrismaService, householdId: string, label: string): Promise<Ctx | null> {
  const owner = await prisma.householdMember.findFirst({
    where: { householdId, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' }, userId: { not: null }, household: { deletedAt: null } },
    include: { household: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner || !owner.userId) return null;
  return {
    userId: owner.userId,
    sessionId: `system:${label}`,
    householdId,
    memberId: owner.id,
    memberName: owner.name,
    roleKey: 'OWNER',
    perms: DEFAULT_ROLE_PERMISSIONS.OWNER,
    propertyScope: [],
    currency: owner.household.currency,
    approvalThreshold: null,
    userAgent: `system:${label}`,
  };
}
