import { prisma } from "@/lib/prisma";

export function isFinanceBlocked(role: string): boolean {
  return role === "REPRESENTATIVE";
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

  return { id: { in: ["__NO_MATCH__"] } };
}

export async function getFinanceProjectScopeWhere(
  userId: string,
  role: string
): Promise<{ id: { in: string[] } } | null> {
  if (role === "ADMIN") return null;

  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });
  const ids = memberships.map((m) => m.projectId);
  if (ids.length === 0) return { id: { in: ["__NO_MATCH__"] } };
  return { id: { in: ids } };
}
