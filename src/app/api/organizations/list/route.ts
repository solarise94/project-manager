import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { getRepresentativeIdByUserEmail } from "@/lib/crm/permissions";
import { Prisma } from "@prisma/client";

type Availability = "AVAILABLE" | "OWN_ACTIVE" | "OWN_PENDING" | "OTHER_ACTIVE" | "OTHER_PENDING";

const AVAILABILITY_LABEL: Record<Availability, string> = {
  AVAILABLE: "可申请",
  OWN_ACTIVE: "已绑定到你",
  OWN_PENDING: "你已提交申请",
  OTHER_ACTIVE: "已被其他代表绑定",
  OTHER_PENDING: "已有其他代表申请中",
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() || "";
  const userIsRep = isRepresentative(session.user.role);

  if (userIsRep && search.length < 2) {
    return NextResponse.json({ organizations: [] });
  }

  const where: Prisma.OrganizationWhereInput = {
    deleted: false,
    archived: false,
  };

  if (search) {
    where.OR = [
      { canonicalName: { contains: search } },
      { orgCode: { contains: search } },
      { aliases: { some: { alias: { contains: search } } } },
    ];
  }

  const organizations = await prisma.organization.findMany({
    where,
    select: {
      id: true,
      orgCode: true,
      canonicalName: true,
      address: true,
      taxId: true,
    },
    orderBy: { canonicalName: "asc" },
    take: userIsRep ? 20 : 50,
  });

  if (!userIsRep) {
    return NextResponse.json({ organizations });
  }

  // Representative: augment with availability info
  const ownRepId = await getRepresentativeIdByUserEmail(session.user.email);
  const orgIds = organizations.map((o) => o.id);

  const bindings = orgIds.length
    ? await prisma.representativeOrganization.findMany({
        where: {
          organizationId: { in: orgIds },
          status: { in: ["ACTIVE", "PENDING"] },
        },
        select: { representativeId: true, organizationId: true, status: true },
      })
    : [];

  const bindingMap = new Map<string, { repId: string; status: string }[]>();
  for (const b of bindings) {
    if (!b.organizationId) continue;
    const list = bindingMap.get(b.organizationId) || [];
    list.push({ repId: b.representativeId, status: b.status });
    bindingMap.set(b.organizationId, list);
  }

  const augmented = organizations.map((org) => {
    const orgBindings = bindingMap.get(org.id) || [];
    let availability: Availability = "AVAILABLE";

    const ownActive = orgBindings.some((b) => b.repId === ownRepId && b.status === "ACTIVE");
    const ownPending = orgBindings.some((b) => b.repId === ownRepId && b.status === "PENDING");
    const otherActive = orgBindings.some((b) => b.repId !== ownRepId && b.status === "ACTIVE");
    const otherPending = orgBindings.some((b) => b.repId !== ownRepId && b.status === "PENDING");

    if (ownActive) availability = "OWN_ACTIVE";
    else if (ownPending) availability = "OWN_PENDING";
    else if (otherActive) availability = "OTHER_ACTIVE";
    else if (otherPending) availability = "OTHER_PENDING";

    return {
      ...org,
      availability,
      availabilityLabel: AVAILABILITY_LABEL[availability],
    };
  });

  return NextResponse.json({ organizations: augmented });
}
