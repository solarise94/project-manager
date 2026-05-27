import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  resolveEffectiveCustomerRepresentative,
  resolveEffectiveCustomerRepresentatives,
} from "@/lib/crm/customer-effective-representative";

type DbLike = typeof prisma | Prisma.TransactionClient;

/**
 * Sync Order.representativeId and Project.representativeId/representative
 * for a customer based on the effective representative resolution.
 *
 * This uses the unified resolver which supports fallback via
 * organization/site bindings.
 */
export async function syncCustomerRepresentativeLinks(
  customerId: string,
  db: DbLike = prisma,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  const effective = await resolveEffectiveCustomerRepresentative(customerId, db);

  await Promise.all([
    db.project.updateMany({
      where: { customerId },
      data: {
        representativeId: effective.representativeId,
        representative: effective.representativeName,
      },
    }),
    db.order.updateMany({
      where: { customerId },
      data: {
        representativeId: effective.representativeId,
      },
    }),
  ]);

  return {
    representativeId: effective.representativeId,
    representativeName: effective.representativeName,
  };
}

/**
 * @deprecated Use syncCustomerRepresentativeLinks instead.
 * This function is kept for backward compatibility with existing call sites.
 * It now delegates to the effective representative resolver regardless of
 * the provided ownerUserId and assigned flag.
 */
export async function syncCustomerRepresentativeLinksByOwnerUser(
  customerId: string,
  _ownerUserId: string | null | undefined,
  _assigned: boolean,
  db: DbLike = prisma,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  return syncCustomerRepresentativeLinks(customerId, db);
}

/**
 * Sync Order/Project representatives for all non-explicitly-assigned customers
 * under an organization (and optionally a specific site).
 * Called when a binding status changes to ACTIVE or is removed.
 */
export async function syncEffectiveRepresentativeLinksForOrganization(
  params: {
    organizationId: string;
    organizationSiteId?: string | null;
    db?: DbLike;
  },
): Promise<number> {
  const { organizationId, organizationSiteId, db: dbArg } = params;
  const db = dbArg ?? prisma;

  const sourceCustomerWhere: Record<string, unknown> = { organizationId, deleted: false };
  if (organizationSiteId) {
    sourceCustomerWhere.organizationSiteId = organizationSiteId;
  }
  // When organizationSiteId is null/undefined (org-level binding), include all
  // customers under the org. The effective resolver handles fallback correctly.

  // Find non-explicitly-assigned customers under this org/site
  const affectedProfiles = await db.crmCustomerProfile.findMany({
    where: {
      sourceCustomer: sourceCustomerWhere,
      OR: [
        { assignmentStatus: { not: "ASSIGNED" } },
      ],
    },
    select: { sourceCustomerId: true },
  });

  if (affectedProfiles.length === 0) return 0;

  const customerIds = affectedProfiles.map((p) => p.sourceCustomerId);
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(customerIds, db);

  // Batch update by grouping customers with the same effective rep
  const repGroups = new Map<string | null, string[]>();
  for (const customerId of customerIds) {
    const effective = effectiveMap.get(customerId);
    const repId = effective?.representativeId ?? null;
    const group = repGroups.get(repId) ?? [];
    group.push(customerId);
    repGroups.set(repId, group);
  }

  for (const [repId, customers] of repGroups) {
    const repName = repId
      ? (await db.representative.findUnique({ where: { id: repId }, select: { name: true } }))?.name ?? null
      : null;

    await Promise.all([
      db.project.updateMany({
        where: { customerId: { in: customers } },
        data: { representativeId: repId, representative: repName },
      }),
      db.order.updateMany({
        where: { customerId: { in: customers } },
        data: { representativeId: repId },
      }),
    ]);
  }

  return affectedProfiles.length;
}

/**
 * Sync Order/Project representative for a single customer.
 * Called when a customer's organizationId or organizationSiteId changes.
 */
export async function syncEffectiveRepresentativeLinksForCustomer(
  customerId: string,
  db?: DbLike,
): Promise<void> {
  await syncCustomerRepresentativeLinks(customerId, db);
}
