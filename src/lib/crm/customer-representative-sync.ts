import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  resolveCustomerRepresentative,
  resolveRepresentativeForOwnerUserId,
} from "@/lib/crm/customer-owner-representative";

type DbLike = typeof prisma | Prisma.TransactionClient;

export async function syncCustomerRepresentativeLinks(
  customerId: string,
  db: DbLike = prisma,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  const resolved = await resolveCustomerRepresentative(customerId, db);

  await Promise.all([
    db.project.updateMany({
      where: { customerId },
      data: {
        representativeId: resolved.representativeId,
        representative: resolved.representativeName,
      },
    }),
    db.order.updateMany({
      where: { customerId },
      data: {
        representativeId: resolved.representativeId,
      },
    }),
  ]);

  return resolved;
}

export async function syncCustomerRepresentativeLinksByOwnerUser(
  customerId: string,
  ownerUserId: string | null | undefined,
  assigned: boolean,
  db: DbLike = prisma,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  const resolved = assigned
    ? await resolveRepresentativeForOwnerUserId(ownerUserId, db)
    : { representativeId: null, representativeName: null };

  await Promise.all([
    db.project.updateMany({
      where: { customerId },
      data: {
        representativeId: resolved.representativeId,
        representative: resolved.representativeName,
      },
    }),
    db.order.updateMany({
      where: { customerId },
      data: {
        representativeId: resolved.representativeId,
      },
    }),
  ]);

  return resolved;
}
