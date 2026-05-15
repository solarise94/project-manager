import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked } from "@/lib/finance/permissions";
import { getOrderScopeWhere } from "@/lib/orders/permissions";
import { prisma } from "@/lib/prisma";

async function resolveOrderAndCheckScope(
  userId: string,
  role: string,
  orderId: string,
): Promise<{ valid: boolean; customerId: string | null }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, customerId: true },
  });
  if (!order) return { valid: false, customerId: null };

  if (role === "ADMIN") return { valid: true, customerId: order.customerId };

  const orderScope = await getOrderScopeWhere(userId, role);
  if (!orderScope) return { valid: false, customerId: null };
  const inScope = await prisma.order.count({ where: { id: orderId, AND: [orderScope] } });
  if (inScope === 0) return { valid: false, customerId: null };

  return { valid: true, customerId: order.customerId };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const orderId = url.searchParams.get("orderId")?.trim();
  const customerId = url.searchParams.get("customerId")?.trim();
  const projectId = url.searchParams.get("projectId")?.trim();
  const source = url.searchParams.get("source")?.trim();
  const dateFrom = url.searchParams.get("dateFrom")?.trim();
  const dateTo = url.searchParams.get("dateTo")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const includeDeleted = url.searchParams.get("includeDeleted") === "1" && session.user.role === "ADMIN";
  const deletedOnly = url.searchParams.get("deletedOnly") === "1" && session.user.role === "ADMIN";

  // If projectId is passed, resolve to order IDs via OrderProjectLink
  let resolvedOrderIds: string[] | null = null;
  if (projectId) {
    const links = await prisma.orderProjectLink.findMany({
      where: { projectId },
      select: { orderId: true },
    });
    resolvedOrderIds = links.map((l) => l.orderId);
    if (resolvedOrderIds.length === 0) {
      resolvedOrderIds = ["__NO_MATCH__"];
    }
  }

  if (session.user.role !== "ADMIN") {
    // Validate specific ID filters against scope
    if (orderId) {
      const { valid } = await resolveOrderAndCheckScope(session.user.id, session.user.role, orderId);
      if (!valid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const andConditions: Record<string, unknown>[] = [];
  if (orderId) andConditions.push({ orderId });
  if (customerId) andConditions.push({ customerId });
  if (resolvedOrderIds) andConditions.push({ orderId: { in: resolvedOrderIds } });
  if (source) andConditions.push({ source });
  if (search) {
    andConditions.push({
      OR: [
        { customer: { name: { contains: search } } },
        { order: { orderNo: { contains: search } } },
        { order: { externalOrderNo: { contains: search } } },
      ],
    });
  }
  if (dateFrom || dateTo) {
    const receivedAtFilter: Record<string, Date> = {};
    if (dateFrom) receivedAtFilter.gte = new Date(dateFrom);
    if (dateTo) receivedAtFilter.lte = new Date(dateTo + "T23:59:59.999Z");
    andConditions.push({ receivedAt: receivedAtFilter });
  }

  // Non-ADMIN: scope by order visibility
  if (session.user.role !== "ADMIN") {
    // If a specific orderId is already specified and validated, skip broad scope fetch
    if (orderId) {
      // orderId was already validated by resolveOrderAndCheckScope above
      andConditions.push({ orderId });
    } else {
      const orderScope = await getOrderScopeWhere(session.user.id, session.user.role);
      if (!orderScope) return NextResponse.json({ receipts: [], total: 0, page, pageSize });

      const scopedOrders = await prisma.order.findMany({
        where: orderScope,
        select: { id: true },
      });
      const scopedOrderIds = scopedOrders.map((o) => o.id);
      if (scopedOrderIds.length === 0) return NextResponse.json({ receipts: [], total: 0, page, pageSize });

      andConditions.push({ orderId: { in: scopedOrderIds } });
    }
  }

  // Deletion filter: non-ADMIN always sees only non-deleted; ADMIN can toggle
  if (deletedOnly) {
    andConditions.push({ deleted: true });
  } else if (!includeDeleted) {
    andConditions.push({ deleted: false });
  }

  const where: Record<string, unknown> = andConditions.length === 1
    ? andConditions[0]
    : (andConditions.length > 0 ? { AND: andConditions } : {});

  const [receipts, total] = await Promise.all([
    prisma.financeReceipt.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        amount: true,
        receivedAt: true,
        source: true,
        remark: true,
        deleted: true,
        deletedAt: true,
        deletedById: true,
        deleteReason: true,
        customer: { select: { id: true, name: true } },
        order: { select: { id: true, orderNo: true, externalOrderNo: true } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
    prisma.financeReceipt.count({ where }),
  ]);

  // Resolve deletedBy user names
  const deletedByIds = [...new Set(receipts.map((r) => r.deletedById).filter(Boolean))] as string[];
  const deletedByUsers = deletedByIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: deletedByIds } }, select: { id: true, name: true } })
    : [];
  const deletedByNameMap = new Map(deletedByUsers.map((u) => [u.id, u.name]));

  const result = receipts.map((r) => ({
    ...r,
    deletedByName: r.deletedById ? (deletedByNameMap.get(r.deletedById) || null) : null,
  }));

  return NextResponse.json({ receipts: result, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "USER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { orderId, amount, receivedAt, source, remark } = body;

  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "回款必须关联订单" }, { status: 400 });
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });
  }

  const { valid, customerId } = await resolveOrderAndCheckScope(session.user.id, session.user.role, orderId);
  if (!valid) return NextResponse.json({ error: "Forbidden: 订单不可见或不存在" }, { status: 403 });

  const receipt = await prisma.financeReceipt.create({
    data: {
      orderId,
      customerId,
      amount,
      receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
      source: source || "MANUAL",
      remark: remark?.trim() || null,
      createdById: session.user.id,
    },
    include: {
      customer: { select: { id: true, name: true } },
      order: { select: { id: true, orderNo: true } },
    },
  });

  return NextResponse.json({ receipt }, { status: 201 });
}
