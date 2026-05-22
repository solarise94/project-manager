import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbLike = typeof prisma | Prisma.TransactionClient;

const SALES_USER_ROLES = new Set(["REPRESENTATIVE", "REGIONAL_MANAGER"]);

export async function resolveRepresentativeForOwnerUser(
  ownerUser: { email: string | null; role: string } | null | undefined,
  db: DbLike = prisma,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  if (!ownerUser?.email) return { representativeId: null, representativeName: null };
  if (!SALES_USER_ROLES.has(ownerUser.role)) {
    return { representativeId: null, representativeName: null };
  }

  const rep = await db.representative.findFirst({
    where: { email: ownerUser.email, archived: false },
    select: { id: true, name: true },
  });

  if (!rep) return { representativeId: null, representativeName: null };

  return { representativeId: rep.id, representativeName: rep.name };
}

export async function resolveRepresentativeForOwnerUserId(
  ownerUserId: string | null | undefined,
  db: DbLike = prisma,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  if (!ownerUserId) return { representativeId: null, representativeName: null };

  const ownerUser = await db.user.findUnique({
    where: { id: ownerUserId },
    select: { email: true, role: true },
  });

  if (!ownerUser) return { representativeId: null, representativeName: null };

  return resolveRepresentativeForOwnerUser(ownerUser, db);
}

/**
 * Resolve the representative for a customer via their CRM profile owner.
 *
 * Chain: customerId → CrmCustomerProfile(owner ASSIGNED, sales role)
 *        → Representative (email match, non-archived)
 *
 * Returns null for both fields when: customerId is null/undefined,
 * no CRM profile exists, profile is not ASSIGNED, owner is not a sales user,
 * or no active Representative matches the owner's email.
 */
export async function resolveCustomerRepresentative(
  customerId: string | null | undefined,
  db: DbLike = prisma,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  if (!customerId) return { representativeId: null, representativeName: null };

  const profile = await db.crmCustomerProfile.findUnique({
    where: { sourceCustomerId: customerId },
    select: {
      assignmentStatus: true,
      ownerUser: { select: { email: true, role: true } },
    },
  });

  if (!profile?.ownerUser) return { representativeId: null, representativeName: null };
  if (profile.assignmentStatus !== "ASSIGNED") return { representativeId: null, representativeName: null };

  return resolveRepresentativeForOwnerUser(profile.ownerUser, db);
}
