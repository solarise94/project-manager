import { prisma } from "@/lib/prisma";
import { getEffectiveCrmVisibleCustomerIds } from "@/lib/crm/permissions";

export function canAccessOrders(role: string): boolean {
  return role === "ADMIN" || role === "USER" || role === "REPRESENTATIVE" || role === "REGIONAL_MANAGER";
}

export function isOrderAccessBlocked(role: string): boolean {
  return !canAccessOrders(role);
}

/**
 * Build a Prisma where clause for Order scoping.
 * ADMIN → null (all orders)
 * USER  → scoped to project-linked orders, CRM customer orders, and own created orders
 * REP / REGIONAL_MANAGER → project-linked orders + CRM customer orders via effective representative
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

  // REPRESENTATIVE / REGIONAL_MANAGER: project-linked orders + CRM customer orders
  if (role === "REPRESENTATIVE" || role === "REGIONAL_MANAGER") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) return { id: { in: ["__NO_MATCH__"] } };

    // Collect representative IDs to query
    const repIds: string[] = [];

    // 1. Check if the user has their own Representative record
    const ownRep = await prisma.representative.findUnique({
      where: { email: user.email, archived: false },
      select: { id: true },
    });
    if (ownRep) repIds.push(ownRep.id);

    // 2. For REGIONAL_MANAGER: also get subordinate representatives
    if (role === "REGIONAL_MANAGER") {
      const manager = await prisma.crmRegionManager.findUnique({
        where: { userId, archived: false },
        include: {
          reps: {
            include: {
              representative: { select: { id: true, archived: true } },
            },
          },
        },
      });
      if (manager) {
        for (const r of manager.reps) {
          if (!r.representative.archived && !repIds.includes(r.representative.id)) {
            repIds.push(r.representative.id);
          }
        }
      }
    }

    // ── CRM Customer scope: orders of customers visible via effective representative ──
    const visibleCustomerIds = await getEffectiveCrmVisibleCustomerIds(userId, role);
    const crmCustomerIds = visibleCustomerIds ? [...visibleCustomerIds] : [];

    if (repIds.length === 0 && crmCustomerIds.length === 0) {
      return { id: { in: ["__NO_MATCH__"] } };
    }

    // ── Project-linked scope ──
    // Find projects linked to all collected representatives (by representativeId)
    const byId = await prisma.project.findMany({
      where: { representativeId: { in: repIds }, deleted: false },
      select: { id: true },
    });
    const projectIds = new Set(byId.map((p) => p.id));

    // Merge name fallback (uniqueness-gated) for all collected representatives
    const repsWithNames = await prisma.representative.findMany({
      where: { id: { in: repIds } },
      select: { name: true },
    });
    const seenNames = new Set<string>();
    for (const r of repsWithNames) {
      if (!r.name || seenNames.has(r.name)) continue;
      seenNames.add(r.name);
      const nameCount = await prisma.representative.count({
        where: { name: r.name, archived: false },
      });
      if (nameCount === 1) {
        const byName = await prisma.project.findMany({
          where: { representativeId: null, representative: r.name, deleted: false },
          select: { id: true },
        });
        for (const p of byName) projectIds.add(p.id);
      }
    }

    let linkedOrderIds: string[] = [];
    if (projectIds.size > 0) {
      linkedOrderIds = (await prisma.orderProjectLink.findMany({
        where: { projectId: { in: [...projectIds] } },
        select: { orderId: true },
        distinct: ["orderId"],
      })).map((l) => l.orderId);
    }

    // ── Combine project-linked + CRM customer scope ──
    const orConditions: Record<string, unknown>[] = [];

    if (linkedOrderIds.length > 0) {
      orConditions.push({ id: { in: linkedOrderIds } });
    }

    if (crmCustomerIds.length > 0) {
      orConditions.push({ customerId: { in: crmCustomerIds } });
    }

    if (orConditions.length === 0) return { id: { in: ["__NO_MATCH__"] } };

    return { OR: orConditions };
  }

  // Unknown future role — blocked
  return { id: { in: ["__NO_MATCH__"] } };
}
