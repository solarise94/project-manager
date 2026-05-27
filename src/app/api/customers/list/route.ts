import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";
import { isRegionalManagerRole, getEffectiveCrmVisibleCustomerIds } from "@/lib/crm/permissions";
import { getCustomerOrganizationName } from "@/lib/customer-organization";
import { resolveCustomerSelectOptions } from "@/lib/customers/customer-select-options";

const CUSTOMER_SELECT = {
  id: true,
  customerCode: true,
  name: true,
  organization: true,
  organizationId: true,
  principal: true,
  wechat: true,
  address: true,
  org: { select: { canonicalName: true } },
  crmProfile: { select: { assignmentStatus: true, ownerUser: { select: { email: true, role: true } } } },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function makeResult(customers: any[]) {
  const withOrg = customers.map((c) => ({
    id: c.id,
    customerCode: c.customerCode,
    name: c.name,
    organization: getCustomerOrganizationName({ organization: c.organization, org: c.org }),
    organizationId: c.organizationId,
    principal: c.principal,
    wechat: c.wechat,
    address: c.address,
    crmProfile: c.crmProfile,
  }));
  return resolveCustomerSelectOptions(withOrg);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const crmScope = req.nextUrl.searchParams.get("crmScope") === "true";
  let customerIds: string[] | undefined;

  if (isRepresentative(session.user.role)) {
    const visibleCustomerIds = await getEffectiveCrmVisibleCustomerIds(session.user.id, session.user.role);
    if (crmScope) {
      // CRM-scoped customers only
      customerIds = visibleCustomerIds ? [...visibleCustomerIds] : [];
    } else {
      // Union of project-linked and CRM-scoped customers
      const projectIds = await getRepresentativeProjectIds(session.user.id);
      const projects = await prisma.project.findMany({
        where: { id: { in: projectIds }, customerId: { not: null } },
        select: { customerId: true },
      });
      const idSet = new Set(projects.map((p) => p.customerId!));
      if (visibleCustomerIds) {
        for (const cid of visibleCustomerIds) idSet.add(cid);
      }
      customerIds = [...idSet];
    }
  } else if (crmScope && isRegionalManagerRole(session.user.role)) {
    const visibleCustomerIds = await getEffectiveCrmVisibleCustomerIds(session.user.id, session.user.role);
    customerIds = visibleCustomerIds ? [...visibleCustomerIds] : [];
  }

  if (customerIds !== undefined) {
    if (customerIds.length === 0) return NextResponse.json({ customers: [] });
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, deleted: false, archived: false },
      select: CUSTOMER_SELECT,
      orderBy: { name: "asc" },
    });
    const resolved = await makeResult(customers);
    return NextResponse.json({ customers: resolved });
  }

  // ADMIN / USER (and REGIONAL_MANAGER without crmScope): all non-deleted, non-archived customers
  const customers = await prisma.customer.findMany({
    where: { deleted: false, archived: false },
    select: CUSTOMER_SELECT,
    orderBy: { name: "asc" },
  });

  const resolved = await makeResult(customers);
  return NextResponse.json({ customers: resolved });
}
