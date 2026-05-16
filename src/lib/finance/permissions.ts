import { prisma } from "@/lib/prisma";
import { getOrderScopeWhere } from "@/lib/orders/permissions";

const FINANCE_READ_ROLES = new Set(["ADMIN", "USER", "REGIONAL_MANAGER"]);
const FINANCE_ADVANCE_READ_ROLES = new Set(["ADMIN", "USER", "REPRESENTATIVE", "REGIONAL_MANAGER"]);

export function canReadFinance(role: string): boolean {
  return FINANCE_READ_ROLES.has(role);
}

export function canReadFinanceAdvance(role: string): boolean {
  return FINANCE_ADVANCE_READ_ROLES.has(role);
}

export function isFinanceBlocked(role: string): boolean {
  // Default finance read is whitelist-based. Route-specific carve-outs
  // (for example advances or order receivables) should opt in explicitly.
  return !canReadFinance(role);
}

async function getSalesFinanceContext(
  userId: string,
  role: string,
): Promise<{ representativeIds: string[]; representativeUserIds: string[] }> {
  if (role !== "REPRESENTATIVE" && role !== "REGIONAL_MANAGER") {
    return { representativeIds: [], representativeUserIds: [] };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user?.email) {
    return { representativeIds: [], representativeUserIds: [userId] };
  }

  const representativeIds: string[] = [];
  const ownRepresentative = await prisma.representative.findUnique({
    where: { email: user.email },
    select: { id: true, archived: true },
  });
  if (ownRepresentative && !ownRepresentative.archived) {
    representativeIds.push(ownRepresentative.id);
  }

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
      for (const link of manager.reps) {
        if (!link.representative.archived && !representativeIds.includes(link.representative.id)) {
          representativeIds.push(link.representative.id);
        }
      }
    }
  }

  const representativeEmails = representativeIds.length > 0
    ? await prisma.representative.findMany({
        where: { id: { in: representativeIds } },
        select: { email: true },
      })
    : [];

  const representativeUsers = representativeEmails.length > 0
    ? await prisma.user.findMany({
        where: {
          email: { in: representativeEmails.map((rep) => rep.email) },
          role: { in: ["REPRESENTATIVE", "REGIONAL_MANAGER"] },
        },
        select: { id: true },
      })
    : [];

  const representativeUserIds = Array.from(new Set([userId, ...representativeUsers.map((userRecord) => userRecord.id)]));
  return { representativeIds, representativeUserIds };
}

export async function getFinanceCustomerScopeWhere(
  userId: string,
  role: string
): Promise<{ id: { in: string[] } } | null> {
  if (role === "ADMIN") return null;

  if (role === "USER") {
    const [crmProfiles, projectMemberships] = await Promise.all([
      prisma.crmCustomerProfile.findMany({
        where: { ownerUserId: userId, assignmentStatus: "ASSIGNED" },
        select: { sourceCustomerId: true },
      }),
      prisma.projectMember.findMany({
        where: { userId },
        select: { project: { select: { customerId: true } } },
      }),
    ]);

    const customerIds = new Set<string>();
    for (const p of crmProfiles) customerIds.add(p.sourceCustomerId);
    for (const m of projectMemberships) {
      if (m.project.customerId) customerIds.add(m.project.customerId);
    }

    if (customerIds.size === 0) return { id: { in: ["__NO_MATCH__"] } };
    return { id: { in: Array.from(customerIds) } };
  }

  if (role === "REPRESENTATIVE" || role === "REGIONAL_MANAGER") {
    const customerIds = new Set<string>();
    const { representativeUserIds } = await getSalesFinanceContext(userId, role);

    if (representativeUserIds.length > 0) {
      const crmProfiles = await prisma.crmCustomerProfile.findMany({
        where: {
          ownerUserId: { in: representativeUserIds },
          assignmentStatus: "ASSIGNED",
        },
        select: { sourceCustomerId: true },
      });
      for (const profile of crmProfiles) {
        customerIds.add(profile.sourceCustomerId);
      }
    }

    const projectScope = await getFinanceProjectScopeWhere(userId, role);
    if (projectScope) {
      const projects = await prisma.project.findMany({
        where: { id: projectScope.id, deleted: false },
        select: { customerId: true },
      });
      for (const project of projects) {
        if (project.customerId) customerIds.add(project.customerId);
      }
    }

    const orderScope = await getOrderScopeWhere(userId, role);
    if (orderScope) {
      const orders = await prisma.order.findMany({
        where: { AND: [orderScope, { deleted: false }] },
        select: { customerId: true },
      });
      for (const order of orders) {
        if (order.customerId) customerIds.add(order.customerId);
      }
    }

    if (customerIds.size === 0) return { id: { in: ["__NO_MATCH__"] } };
    return { id: { in: Array.from(customerIds) } };
  }

  return { id: { in: ["__NO_MATCH__"] } };
}

export async function getFinanceProjectScopeWhere(
  userId: string,
  role: string
): Promise<{ id: { in: string[] } } | null> {
  if (role === "ADMIN") return null;

  if (role === "USER") {
    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    const ids = memberships.map((membership) => membership.projectId);
    if (ids.length === 0) return { id: { in: ["__NO_MATCH__"] } };
    return { id: { in: ids } };
  }

  if (role === "REPRESENTATIVE" || role === "REGIONAL_MANAGER") {
    const projectIds = new Set<string>();
    const [memberships, salesContext] = await Promise.all([
      prisma.projectMember.findMany({
        where: { userId },
        select: { projectId: true },
      }),
      getSalesFinanceContext(userId, role),
    ]);

    for (const membership of memberships) {
      projectIds.add(membership.projectId);
    }

    if (salesContext.representativeIds.length > 0) {
      const byRepresentativeId = await prisma.project.findMany({
        where: {
          representativeId: { in: salesContext.representativeIds },
          deleted: false,
        },
        select: { id: true },
      });
      for (const project of byRepresentativeId) {
        projectIds.add(project.id);
      }

      const representatives = await prisma.representative.findMany({
        where: { id: { in: salesContext.representativeIds } },
        select: { name: true },
      });
      const seenNames = new Set<string>();
      for (const representative of representatives) {
        if (!representative.name || seenNames.has(representative.name)) continue;
        seenNames.add(representative.name);
        const nameCount = await prisma.representative.count({
          where: { name: representative.name, archived: false },
        });
        if (nameCount !== 1) continue;

        const byRepresentativeName = await prisma.project.findMany({
          where: {
            representativeId: null,
            representative: representative.name,
            deleted: false,
          },
          select: { id: true },
        });
        for (const project of byRepresentativeName) {
          projectIds.add(project.id);
        }
      }
    }

    if (projectIds.size === 0) return { id: { in: ["__NO_MATCH__"] } };
    return { id: { in: Array.from(projectIds) } };
  }

  return { id: { in: ["__NO_MATCH__"] } };
}
