import { prisma } from "@/lib/prisma";

export function isRepresentativeRole(role: string) {
  return role === "REPRESENTATIVE";
}

export function isRegionalManagerRole(role: string) {
  return role === "REGIONAL_MANAGER";
}

/** Extract the set of allowed userIds from a scope where clause returned by getCrmProfileScopeWhere. */
export function extractScopedUserIds(scope: Record<string, unknown>): string[] | null {
  const ownerFilter = scope.ownerUserId;
  if (!ownerFilter) return null;
  if (typeof ownerFilter === "string") return [ownerFilter];
  if (typeof ownerFilter === "object" && "in" in ownerFilter) {
    const arr = (ownerFilter as { in: string[] }).in;
    return Array.isArray(arr) ? arr : null;
  }
  return null;
}

/**
 * Resolve the set of userIds a regional manager can see in CRM.
 * Returns null if the manager has no assigned representatives.
 */
export async function getRegionalManagerUserIds(managerUserId: string): Promise<string[] | null> {
  const manager = await prisma.crmRegionManager.findUnique({
    where: { userId: managerUserId, archived: false },
    include: {
      reps: {
        include: {
          representative: { select: { email: true } },
        },
      },
    },
  });
  if (!manager || manager.reps.length === 0) return null;

  const emails = manager.reps.map((r) => r.representative.email);
  // Only sales roles — exclude ADMIN/USER from the managed set
  const repUsers = await prisma.user.findMany({
    where: { email: { in: emails }, role: { in: ["REPRESENTATIVE", "REGIONAL_MANAGER"] } },
    select: { id: true },
  });
  return repUsers.map((u) => u.id);
}

export async function getManagedRepresentativeIds(managerUserId: string): Promise<string[]> {
  const manager = await prisma.crmRegionManager.findUnique({
    where: { userId: managerUserId, archived: false },
    select: {
      reps: {
        select: { representativeId: true },
      },
    },
  });
  if (!manager) return [];
  return manager.reps.map((link) => link.representativeId);
}

export async function getRepresentativeIdByUserEmail(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const rep = await prisma.representative.findUnique({
    where: { email },
    select: { id: true },
  });
  return rep?.id ?? null;
}

export async function canManageRepresentativeBindings(
  userId: string,
  role: string,
  representativeId: string,
  userEmail?: string | null,
): Promise<boolean> {
  if (role === "ADMIN") return true;

  if (role === "REGIONAL_MANAGER") {
    const managedIds = await getManagedRepresentativeIds(userId);
    return managedIds.includes(representativeId);
  }

  if (role === "REPRESENTATIVE") {
    const ownRepresentativeId = await getRepresentativeIdByUserEmail(userEmail);
    return ownRepresentativeId === representativeId;
  }

  return false;
}

/**
 * Build a Prisma where clause for CrmCustomerProfile scoping.
 *
 * ADMIN / USER       -> {} (all profiles)
 * REGIONAL_MANAGER   -> { ownerUserId: { in: [...] } } (profiles of managed reps)
 * REPRESENTATIVE     -> { ownerUserId: ownUserId } (own profiles only)
 */
export async function getCrmProfileScopeWhere(
  userId: string,
  role: string,
  opts?: { includeUnassigned?: boolean },
): Promise<Record<string, unknown>> {
  if (role === "ADMIN" || role === "USER") {
    return {};
  }

  if (role === "REGIONAL_MANAGER") {
    const repUserIds = await getRegionalManagerUserIds(userId);
    const ids = repUserIds && repUserIds.length > 0 ? [userId, ...repUserIds] : [userId];
    const base: Record<string, unknown> = { ownerUserId: { in: ids } };
    if (!opts?.includeUnassigned) base.assignmentStatus = "ASSIGNED";
    return base;
  }

  if (role === "REPRESENTATIVE") {
    const base: Record<string, unknown> = { ownerUserId: userId };
    if (!opts?.includeUnassigned) base.assignmentStatus = "ASSIGNED";
    return base;
  }

  return { ownerUserId: "__NO_MATCH__" };
}

/** @deprecated Use getCrmProfileScopeWhere instead. */
export async function buildCrmWhereForRole(userId: string, role: string, opts?: { includeUnassigned?: boolean }) {
  return getCrmProfileScopeWhere(userId, role, opts);
}

export async function assertCrmProfileAccess(
  profileId: string,
  userId: string,
  role: string
) {
  const profile = await prisma.crmCustomerProfile.findUnique({
    where: { id: profileId },
  });
  if (!profile) {
    throw new Error("NOT_FOUND");
  }
  if (role === "ADMIN" || role === "USER") {
    return profile;
  }

  if (role === "REGIONAL_MANAGER") {
    const repUserIds = await getRegionalManagerUserIds(userId);
    const allowed = new Set(repUserIds || []);
    allowed.add(userId);
    if (!allowed.has(profile.ownerUserId)) throw new Error("FORBIDDEN");
    if (profile.assignmentStatus !== "ASSIGNED") throw new Error("FORBIDDEN");
    return profile;
  }

  if (profile.ownerUserId !== userId) {
    throw new Error("FORBIDDEN");
  }
  if (profile.assignmentStatus !== "ASSIGNED") {
    throw new Error("FORBIDDEN");
  }
  return profile;
}

export async function assertCrmProfileAccessByCustomerId(
  sourceCustomerId: string,
  userId: string,
  role: string
) {
  const profile = await prisma.crmCustomerProfile.findUnique({
    where: { sourceCustomerId },
  });
  if (!profile) {
    throw new Error("NOT_FOUND");
  }
  if (role === "ADMIN" || role === "USER") {
    return profile;
  }

  if (role === "REGIONAL_MANAGER") {
    const repUserIds = await getRegionalManagerUserIds(userId);
    const allowed = new Set(repUserIds || []);
    allowed.add(userId);
    if (!allowed.has(profile.ownerUserId)) throw new Error("FORBIDDEN");
    if (profile.assignmentStatus !== "ASSIGNED") throw new Error("FORBIDDEN");
    return profile;
  }

  if (profile.ownerUserId !== userId) {
    throw new Error("FORBIDDEN");
  }
  if (profile.assignmentStatus !== "ASSIGNED") {
    throw new Error("FORBIDDEN");
  }
  return profile;
}
