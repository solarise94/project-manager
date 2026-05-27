import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveEffectiveCustomerRepresentative } from "@/lib/crm/customer-effective-representative";

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
 * Resolve the effective representative for a customer.
 *
 * This function now uses the unified effective representative resolver,
 * which supports fallback via organization/site bindings.
 *
 * Resolution priority:
 * 1. EXPLICIT_ASSIGNMENT: profile is ASSIGNED and owner maps to a valid rep.
 * 2. SITE_BINDING: customer has organizationSiteId with an ACTIVE binding.
 * 3. ORG_BINDING: customer has organizationId with an ACTIVE org-level binding.
 * 4. NONE: no match.
 */
export async function resolveCustomerRepresentative(
  customerId: string | null | undefined,
  db: DbLike = prisma,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  if (!customerId) return { representativeId: null, representativeName: null };

  const effective = await resolveEffectiveCustomerRepresentative(customerId, db);
  return {
    representativeId: effective.representativeId,
    representativeName: effective.representativeName,
  };
}
