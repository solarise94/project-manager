import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";
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
  crmProfile: { select: { ownerUser: { select: { email: true, role: true } } } },
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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    const projectIds = await getRepresentativeProjectIds(session.user.id);
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds }, customerId: { not: null } },
      select: { customerId: true },
    });
    const customerIds = [...new Set(projects.map((p) => p.customerId!))];

    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, deleted: false, archived: false },
      select: CUSTOMER_SELECT,
      orderBy: { name: "asc" },
    });
    const resolved = await makeResult(customers);
    return NextResponse.json({ customers: resolved });
  }

  const customers = await prisma.customer.findMany({
    where: { deleted: false, archived: false },
    select: CUSTOMER_SELECT,
    orderBy: { name: "asc" },
  });

  const resolved = await makeResult(customers);
  return NextResponse.json({ customers: resolved });
}
