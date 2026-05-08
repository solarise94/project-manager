import { prisma } from "@/lib/prisma";

/**
 * Resolve the representative for a customer via their CRM profile owner.
 *
 * Chain: customerId → CrmCustomerProfile.ownerUser (role=REPRESENTATIVE)
 *        → Representative (email match, non-archived)
 *
 * Returns null for both fields when: customerId is null/undefined,
 * no CRM profile exists, owner is not a REPRESENTATIVE user,
 * or no active Representative matches the owner's email.
 */
export async function resolveCustomerRepresentative(
  customerId: string | null | undefined,
): Promise<{ representativeId: string | null; representativeName: string | null }> {
  if (!customerId) return { representativeId: null, representativeName: null };

  const profile = await prisma.crmCustomerProfile.findUnique({
    where: { sourceCustomerId: customerId },
    select: { ownerUser: { select: { id: true, email: true, role: true } } },
  });

  if (!profile?.ownerUser) return { representativeId: null, representativeName: null };
  if (profile.ownerUser.role !== "REPRESENTATIVE") return { representativeId: null, representativeName: null };

  const rep = await prisma.representative.findFirst({
    where: { email: profile.ownerUser.email, archived: false },
    select: { id: true, name: true },
  });

  if (!rep) return { representativeId: null, representativeName: null };

  return { representativeId: rep.id, representativeName: rep.name };
}
