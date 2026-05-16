import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SYMMETRIC_RELATION_TYPES } from "@/lib/crm/constants";
import { isRepresentativeRole, isRegionalManagerRole, getCrmProfileScopeWhere } from "@/lib/crm/permissions";

const customerSelect = { id: true, name: true, customerCode: true, organization: true };

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const customerId = searchParams.get("customerId");
  const type = searchParams.get("type");
  const search = searchParams.get("search");

  const where: Record<string, unknown> = {};
  let ownedCustomerIds: string[] = [];

  if (isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role)) {
    const scope = await getCrmProfileScopeWhere(session.user.id, session.user.role);
    const ownedProfiles = await prisma.crmCustomerProfile.findMany({
      where: scope as Record<string, unknown>,
      select: { sourceCustomerId: true },
    });
    ownedCustomerIds = ownedProfiles.map((p) => p.sourceCustomerId);
    if (ownedCustomerIds.length === 0) {
      return NextResponse.json({ relations: [] });
    }
    where.OR = [
      { fromCustomerId: { in: ownedCustomerIds } },
      { toCustomerId: { in: ownedCustomerIds } },
    ];
  }

  if (customerId) {
    const customerFilter = [{ fromCustomerId: customerId }, { toCustomerId: customerId }];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: customerFilter }];
      delete where.OR;
    } else {
      where.OR = customerFilter;
    }
  }
  if (type) where.type = type;
  if (search) {
    const searchFilter = {
      OR: [
        { name: { contains: search } },
        { customerCode: { contains: search } },
        { organization: { contains: search } },
      ],
    };
    const sf = { OR: [{ fromCustomer: searchFilter }, { toCustomer: searchFilter }] };
    if (where.AND) {
      (where.AND as unknown[]).push(sf);
    } else if (where.OR) {
      where.AND = [{ OR: where.OR }, sf];
      delete where.OR;
    } else {
      where.AND = [sf];
    }
  }

  const relations = await prisma.customerRelation.findMany({
    where,
    include: {
      fromCustomer: { select: customerSelect },
      toCustomer: { select: customerSelect },
      createdByUser: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  let visibleProfileIdSet: Set<string>;
  if (isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role)) {
    visibleProfileIdSet = new Set(ownedCustomerIds);
  } else {
    const customerIds = new Set<string>();
    for (const r of relations) {
      customerIds.add(r.fromCustomerId);
      customerIds.add(r.toCustomerId);
    }
    const profiles = await prisma.crmCustomerProfile.findMany({
      where: { sourceCustomerId: { in: Array.from(customerIds) } },
      select: { sourceCustomerId: true },
    });
    visibleProfileIdSet = new Set(profiles.map((p) => p.sourceCustomerId));
  }

  const enrichedRelations = relations.map((r) => ({
    ...r,
    fromHasCrm: visibleProfileIdSet.has(r.fromCustomerId),
    toHasCrm: visibleProfileIdSet.has(r.toCustomerId),
  }));

  return NextResponse.json({ relations: enrichedRelations });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  let { fromCustomerId, toCustomerId } = body;
  const { type, strength, notes, introducedAt } = body;

  if (!fromCustomerId || !toCustomerId || !type) {
    return NextResponse.json({ error: "fromCustomerId, toCustomerId, and type are required" }, { status: 400 });
  }

  if (fromCustomerId === toCustomerId) {
    return NextResponse.json({ error: "Cannot create a relation to the same customer" }, { status: 400 });
  }

  // REPRESENTATIVE and REGIONAL_MANAGER may create relations, but only between customers in their CRM scope
  if (isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role)) {
    const scope = await getCrmProfileScopeWhere(session.user.id, session.user.role);
    const ownedProfiles = await prisma.crmCustomerProfile.findMany({
      where: scope as Record<string, unknown>,
      select: { sourceCustomerId: true },
    });
    const ownedCustomerIds = new Set(ownedProfiles.map((p) => p.sourceCustomerId));
    if (!ownedCustomerIds.has(fromCustomerId) || !ownedCustomerIds.has(toCustomerId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (SYMMETRIC_RELATION_TYPES.has(type) && fromCustomerId > toCustomerId) {
    [fromCustomerId, toCustomerId] = [toCustomerId, fromCustomerId];
  }

  const [fromCustomer, toCustomer] = await Promise.all([
    prisma.customer.findUnique({ where: { id: fromCustomerId } }),
    prisma.customer.findUnique({ where: { id: toCustomerId } }),
  ]);

  if (!fromCustomer || !toCustomer) {
    return NextResponse.json({ error: "One or both customers not found" }, { status: 404 });
  }

  const existing = await prisma.customerRelation.findUnique({
    where: { fromCustomerId_toCustomerId_type: { fromCustomerId, toCustomerId, type } },
  });
  if (existing) {
    return NextResponse.json({ error: "This relation already exists" }, { status: 409 });
  }

  const relation = await prisma.customerRelation.create({
    data: {
      fromCustomerId,
      toCustomerId,
      type,
      strength: strength || null,
      notes: notes || null,
      introducedAt: introducedAt ? new Date(introducedAt) : null,
      createdByUserId: session.user.id,
    },
    include: {
      fromCustomer: { select: customerSelect },
      toCustomer: { select: customerSelect },
      createdByUser: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ relation }, { status: 201 });
}
