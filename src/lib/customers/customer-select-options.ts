import { prisma } from "@/lib/prisma";

export interface CustomerSelectOption {
  id: string;
  customerCode: string;
  name: string;
  organization: string | null;
  organizationId: string | null;
  principal: string | null;
  wechat: string | null;
  address: string | null;
  representativeId: string | null;
  representativeName: string | null;
}

type CustomerWithOwner = {
  id: string;
  crmProfile?: { ownerUser?: { email?: string | null; role?: string } | null } | null;
};

/**
 * Generic helper: batch-resolve representatives and merge into original objects.
 * Preserves ALL original fields — does not strip anything.
 */
export async function appendCustomerRepresentativeInfo<T extends CustomerWithOwner>(
  customers: T[],
): Promise<Array<T & { representativeId: string | null; representativeName: string | null }>> {
  const ownerEmails = [...new Set(
    customers
      .map((c) => c.crmProfile?.ownerUser)
      .filter((u): u is { email: string; role: string } => !!u && !!u.email && u.role === "REPRESENTATIVE")
      .map((u) => u.email),
  )];

  const reps = ownerEmails.length > 0
    ? await prisma.representative.findMany({
        where: { email: { in: ownerEmails }, archived: false },
        select: { id: true, name: true, email: true },
      })
    : [];

  const emailToRep = new Map(reps.map((r) => [r.email, r]));

  return customers.map((c) => {
    const ownerUser = c.crmProfile?.ownerUser;
    const rep = ownerUser && ownerUser.email && ownerUser.role === "REPRESENTATIVE"
      ? emailToRep.get(ownerUser.email)
      : undefined;

    return {
      ...c,
      representativeId: rep?.id || null,
      representativeName: rep?.name || null,
    };
  });
}

/**
 * Narrow helper for CustomerSelect: returns only the fields needed by the picker.
 * Used by /api/customers/list and POST (quick-create response).
 */
export async function resolveCustomerSelectOptions(
  customers: Array<{
    id: string; customerCode: string; name: string;
    organization: string | null; organizationId: string | null;
    principal: string | null; wechat: string | null; address: string | null;
    crmProfile?: { ownerUser?: { email?: string | null; role?: string } | null } | null;
  }>,
): Promise<CustomerSelectOption[]> {
  const resolved = await appendCustomerRepresentativeInfo(customers);
  return resolved.map((c) => ({
    id: c.id,
    customerCode: c.customerCode,
    name: c.name,
    organization: c.organization,
    organizationId: c.organizationId,
    principal: c.principal,
    wechat: c.wechat,
    address: c.address,
    representativeId: c.representativeId,
    representativeName: c.representativeName,
  }));
}

/** Resolve a single customer to a CustomerSelectOption (with rep info). */
export async function resolveSingleCustomerOption(
  customer: Parameters<typeof resolveCustomerSelectOptions>[0][number],
): Promise<CustomerSelectOption> {
  const [result] = await resolveCustomerSelectOptions([customer]);
  return result;
}
