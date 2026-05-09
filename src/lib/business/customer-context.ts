import { prisma } from "@/lib/prisma";
import { getCustomerOrganizationName } from "@/lib/customer-organization";
import { resolveCustomerRepresentative } from "@/lib/crm/customer-owner-representative";

export interface CustomerBusinessContext {
  customerId: string;
  clientName: string;
  organizationId: string | null;
  organizationName: string | null;
  buyerPhone: string | null;
  buyerWechat: string | null;
  buyerAddress: string | null;
  representativeId: string | null;
  representativeName: string | null;
}

/**
 * Resolve full business context for a customer.
 * Used by project and order creation/editing to populate
 * client, organization, representative, and buyer snapshots.
 */
export async function resolveCustomerBusinessContext(
  customerId: string,
): Promise<CustomerBusinessContext> {
  const cust = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      organization: true,
      organizationId: true,
      principal: true,
      wechat: true,
      address: true,
      org: { select: { canonicalName: true } },
    },
  });

  if (!cust) {
    return {
      customerId: "",
      clientName: "",
      organizationId: null,
      organizationName: null,
      buyerPhone: null,
      buyerWechat: null,
      buyerAddress: null,
      representativeId: null,
      representativeName: null,
    };
  }

  const orgName = getCustomerOrganizationName({ organization: cust.organization, org: cust.org });

  const { representativeId, representativeName } = await resolveCustomerRepresentative(cust.id);

  return {
    customerId: cust.id,
    clientName: cust.name,
    organizationId: cust.organizationId,
    organizationName: orgName,
    buyerPhone: cust.principal,
    buyerWechat: cust.wechat,
    buyerAddress: cust.address,
    representativeId,
    representativeName,
  };
}
