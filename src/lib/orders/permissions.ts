import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";

export function isOrderAccessBlocked(role: string): boolean {
  // REPRESENTATIVE and REGIONAL_MANAGER are CRM roles, not order-management roles.
  return isRepresentative(role) || role === "REGIONAL_MANAGER";
}

/**
 * Build a Prisma where clause for Order scoping.
 * ADMIN → null (all orders)
 * USER  → scoped to project-linked orders, CRM customer orders, and own created orders
 * REP / REGIONAL_MANAGER → blocked (caller should return 403 before using this)
 */
export async function getOrderScopeWhere(
  userId: string,
  role: string,
): Promise<Record<string, unknown> | null> {
  if (role === "ADMIN") return null;

  if (role === "USER") {
    // Orders linked to projects the user is a member of
    const projectMemberships = await prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    const projectIds = projectMemberships.map((m) => m.projectId);

    const linkedOrderIds = projectIds.length > 0
      ? (await prisma.orderProjectLink.findMany({
          where: { projectId: { in: projectIds } },
          select: { orderId: true },
          distinct: ["orderId"],
        })).map((l) => l.orderId)
      : [];

    // Orders whose customer is owned by the user in CRM
    const crmProfiles = await prisma.crmCustomerProfile.findMany({
      where: { ownerUserId: userId, assignmentStatus: "ASSIGNED" },
      select: { sourceCustomerId: true },
    });
    const crmCustomerIds = crmProfiles.map((p) => p.sourceCustomerId);

    const orConditions: Record<string, unknown>[] = [];

    if (linkedOrderIds.length > 0) {
      orConditions.push({ id: { in: linkedOrderIds } });
    }

    if (crmCustomerIds.length > 0) {
      orConditions.push({ customerId: { in: crmCustomerIds } });
    }

    // Also include orders the user created
    orConditions.push({ createdById: userId });

    if (orConditions.length === 0) {
      return { id: { in: ["__NO_MATCH__"] } };
    }

    return { OR: orConditions };
  }

  // REPRESENTATIVE / REGIONAL_MANAGER — blocked explicitly above; this fallback
  // exists for any unknown future role.
  return { id: { in: ["__NO_MATCH__"] } };
}
