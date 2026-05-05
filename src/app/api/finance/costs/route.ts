import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { isValidCostType, resolveAndValidateCostRefs } from "@/lib/finance/costs";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const costType = url.searchParams.get("costType")?.trim() || "";
  const projectId = url.searchParams.get("projectId")?.trim() || "";
  const orderId = url.searchParams.get("orderId")?.trim() || "";
  const customerId = url.searchParams.get("customerId")?.trim() || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const andConditions: Record<string, unknown>[] = [];
  if (costType) andConditions.push({ costType });
  if (projectId) andConditions.push({ projectId });
  if (orderId) andConditions.push({ orderId });
  if (customerId) andConditions.push({ customerId });

  // USER scope: costs where the user can see the related entity
  if (session.user.role !== "ADMIN") {
    const projScope = await getFinanceProjectScopeWhere(session.user.id, session.user.role);
    const custScope = await getFinanceCustomerScopeWhere(session.user.id, session.user.role);

    // Also build order scope: orders the user can access
    const { getOrderScopeWhere } = await import("@/lib/orders/permissions");
    const orderScope = await getOrderScopeWhere(session.user.id, session.user.role);

    const scopeOr: Record<string, unknown>[] = [];

    if (projScope) {
      scopeOr.push({ projectId: projScope.id });
    }
    if (custScope) {
      scopeOr.push({ customerId: custScope.id });
    }
    if (orderScope) {
      const scopedOrders = await prisma.order.findMany({
        where: orderScope,
        select: { id: true },
      });
      const scopedOrderIds = scopedOrders.map((o) => o.id);
      if (scopedOrderIds.length > 0) {
        scopeOr.push({ orderId: { in: scopedOrderIds } });
      }
    }

    if (scopeOr.length === 0) {
      andConditions.push({ createdById: session.user.id });
    } else {
      andConditions.push({ OR: scopeOr });
    }
  }

  const where: Record<string, unknown> = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

  const [costs, total] = await Promise.all([
    prisma.financeCost.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        order: { select: { id: true, orderNo: true } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.financeCost.count({ where }),
  ]);

  return NextResponse.json({ costs, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { amount, costType, customerId, orderId, projectId, occurredAt, remark } = body as Record<string, unknown>;

  if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json({ error: "金额必须为正数" }, { status: 400 });
  }
  if (!costType || !isValidCostType(costType as string)) {
    return NextResponse.json({ error: `无效的成本类型: ${costType}` }, { status: 400 });
  }

  // Validate entity refs
  const validation = await resolveAndValidateCostRefs({
    customerId: (customerId as string) || null,
    orderId: (orderId as string) || null,
    projectId: (projectId as string) || null,
  });
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const cost = await prisma.financeCost.create({
    data: {
      amount: Number(amount),
      costType: costType as string,
      customerId: validation.resolvedCustomerId,
      orderId: (orderId as string) || null,
      projectId: (validation.resolvedProjectId ?? (projectId as string)) || null,
      occurredAt: occurredAt ? new Date(occurredAt as string) : new Date(),
      remark: (remark as string)?.trim() || null,
      createdById: session.user.id,
    },
    include: {
      customer: { select: { id: true, name: true } },
      order: { select: { id: true, orderNo: true } },
      project: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ cost }, { status: 201 });
}
