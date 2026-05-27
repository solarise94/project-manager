import { prisma } from "@/lib/prisma";
import { resolveEffectiveCustomerRepresentatives } from "@/lib/crm/customer-effective-representative";

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
  crmProfile?: {
    assignmentStatus?: string | null;
    ownerUser?: { email?: string | null; role?: string } | null;
  } | null;
};

/**
 * Generic helper: batch-resolve effective representatives and merge into original objects.
 * Uses the unified effective resolver (explicit assignment > site binding > org binding).
 * Preserves ALL original fields — does not strip anything.
 */
export async function appendCustomerRepresentativeInfo<T extends CustomerWithOwner>(
  customers: T[],
): Promise<Array<T & { representativeId: string | null; representativeName: string | null }>> {
  if (customers.length === 0) return [];

  const customerIds = customers.map((c) => c.id);
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(customerIds);

  const repIds = [...new Set(
    Array.from(effectiveMap.values())
      .map((e) => e.representativeId)
      .filter((id): id is string => !!id),
  )];

  const reps = repIds.length > 0
    ? await prisma.representative.findMany({
        where: { id: { in: repIds }, archived: false },
        select: { id: true, name: true },
      })
    : [];

  const repMap = new Map(reps.map((r) => [r.id, r]));

  return customers.map((c) => {
    const effective = effectiveMap.get(c.id);
    const rep = effective?.representativeId ? repMap.get(effective.representativeId) : undefined;

    return {
      ...c,
      representativeId: rep?.id || effective?.representativeId || null,
      representativeName: rep?.name || effective?.representativeName || null,
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
    crmProfile?: {
      assignmentStatus?: string | null;
      ownerUser?: { email?: string | null; role?: string } | null;
    } | null;
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
