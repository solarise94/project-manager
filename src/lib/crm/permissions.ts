import { prisma } from "@/lib/prisma";
import { resolveEffectiveCustomerRepresentatives } from "@/lib/crm/customer-effective-representative";

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
 *
 * @deprecated This only covers explicit assignment. For effective representative
 * fallback, use filterProfilesByEffectiveAccess or assertCrmProfileAccess instead.
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

/**
 * Resolve the set of profileIds visible to a user based on effective representatives.
 * Returns null for ADMIN/USER (meaning all profiles are visible).
 */
export async function getEffectiveCrmVisibleProfileIds(
  userId: string,
  role: string,
): Promise<Set<string> | null> {
  if (role === "ADMIN" || role === "USER") return null;

  const allProfiles = await prisma.crmCustomerProfile.findMany({
    where: { archived: false },
    select: {
      id: true,
      sourceCustomerId: true,
    },
  });

  const customerIds = [...new Set(allProfiles.map((p) => p.sourceCustomerId))];
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(customerIds);

  let allowedOwnerIds: string[];
  if (role === "REGIONAL_MANAGER") {
    const repUserIds = await getRegionalManagerUserIds(userId);
    allowedOwnerIds = repUserIds && repUserIds.length > 0 ? [userId, ...repUserIds] : [userId];
  } else if (role === "REPRESENTATIVE") {
    allowedOwnerIds = [userId];
  } else {
    return new Set<string>();
  }

  const visibleProfileIds = new Set<string>();
  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    if (effective?.ownerUserId && allowedOwnerIds.includes(effective.ownerUserId)) {
      visibleProfileIds.add(profile.id);
    }
  }

  return visibleProfileIds;
}

/**
 * Resolve the set of customerIds visible to a user based on effective representatives.
 * Returns null for ADMIN/USER (meaning all customers are visible).
 */
export async function getEffectiveCrmVisibleCustomerIds(
  userId: string,
  role: string,
): Promise<Set<string> | null> {
  if (role === "ADMIN" || role === "USER") return null;

  const allProfiles = await prisma.crmCustomerProfile.findMany({
    where: { archived: false },
    select: {
      id: true,
      sourceCustomerId: true,
    },
  });

  const customerIds = [...new Set(allProfiles.map((p) => p.sourceCustomerId))];
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(customerIds);

  let allowedOwnerIds: string[];
  if (role === "REGIONAL_MANAGER") {
    const repUserIds = await getRegionalManagerUserIds(userId);
    allowedOwnerIds = repUserIds && repUserIds.length > 0 ? [userId, ...repUserIds] : [userId];
  } else if (role === "REPRESENTATIVE") {
    allowedOwnerIds = [userId];
  } else {
    return new Set<string>();
  }

  const visibleCustomerIds = new Set<string>();
  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    if (effective?.ownerUserId && allowedOwnerIds.includes(effective.ownerUserId)) {
      visibleCustomerIds.add(profile.sourceCustomerId);
    }
  }

  return visibleCustomerIds;
}

/**
 * Check if a user can access a CRM profile based on effective representative.
 * Throws "NOT_FOUND" or "FORBIDDEN" on failure.
 */
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

  const effective = await resolveEffectiveCustomerRepresentatives([profile.sourceCustomerId]);
  const eff = effective.get(profile.sourceCustomerId);

  if (role === "REGIONAL_MANAGER") {
    const repUserIds = await getRegionalManagerUserIds(userId);
    const allowed = new Set(repUserIds || []);
    allowed.add(userId);
    if (!eff?.ownerUserId || !allowed.has(eff.ownerUserId)) throw new Error("FORBIDDEN");
    return profile;
  }

  if (role === "REPRESENTATIVE") {
    if (eff?.ownerUserId !== userId) throw new Error("FORBIDDEN");
    return profile;
  }

  throw new Error("FORBIDDEN");
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

  const effective = await resolveEffectiveCustomerRepresentatives([sourceCustomerId]);
  const eff = effective.get(sourceCustomerId);

  if (role === "REGIONAL_MANAGER") {
    const repUserIds = await getRegionalManagerUserIds(userId);
    const allowed = new Set(repUserIds || []);
    allowed.add(userId);
    if (!eff?.ownerUserId || !allowed.has(eff.ownerUserId)) throw new Error("FORBIDDEN");
    return profile;
  }

  if (role === "REPRESENTATIVE") {
    if (eff?.ownerUserId !== userId) throw new Error("FORBIDDEN");
    return profile;
  }

  throw new Error("FORBIDDEN");
}
