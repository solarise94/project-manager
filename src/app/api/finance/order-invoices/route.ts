import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFinanceBlocked } from "@/lib/finance/permissions";
import { getOrderScopeWhere } from "@/lib/orders/permissions";
import { syncOrderInvoiceStatus } from "@/lib/external-order";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "";
  const orderId = url.searchParams.get("orderId")?.trim() || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  // Build scope: USER can only see invoices for orders they can access
  const orderScope = await getOrderScopeWhere(session.user.id, session.user.role);

  const andConditions: Record<string, unknown>[] = [];

  // Scope filter: invoice must reference an order the user can see
  if (orderScope) {
    const scopedIds = await getScopedOrderIds(orderScope);
    // Also resolve legacy externalOrderIds for scoped orders (not yet backfilled to orderId)
    const legacyIds = await prisma.order.findMany({
      where: { id: { in: scopedIds }, legacyExternalOrderId: { not: null } },
      select: { legacyExternalOrderId: true },
    }).then((rows) => rows.map((r) => r.legacyExternalOrderId!).filter(Boolean));
    andConditions.push({
      OR: [
        { orderId: { in: scopedIds } },
        { orderCoverage: { some: { orderId: { in: scopedIds } } } },
        ...(legacyIds.length > 0 ? [{ externalOrderId: { in: legacyIds } }] : []),
      ],
    });
  }

  if (orderId) {
    andConditions.push({
      OR: [
        { orderId },
        { orderCoverage: { some: { orderId } } },
      ],
    });
  }

  if (status) andConditions.push({ status });

  if (search) {
    andConditions.push({
      OR: [
        { buyerOrganizationName: { contains: search } },
        { contentSummary: { contains: search } },
        { contactName: { contains: search } },
      ],
    });
  }

  const where: Record<string, unknown> = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

  const [invoices, total] = await Promise.all([
    prisma.externalOrderInvoiceRequest.findMany({
      where,
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        createdBy: { select: { id: true, name: true } },
        order: { select: { id: true, orderNo: true } },
        orderCoverage: { include: { order: { select: { id: true, orderNo: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.externalOrderInvoiceRequest.count({ where }),
  ]);

  return NextResponse.json({ invoices, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

async function getScopedOrderIds(scope: Record<string, unknown>): Promise<string[]> {
  // If scope is a no-match sentinel, return empty
  if (scope.id && typeof scope.id === "object" && "in" in scope.id && Array.isArray((scope.id as { in: string[] }).in)) {
    const ids = (scope.id as { in: string[] }).in;
    if (ids.length === 1 && ids[0] === "__NO_MATCH__") return ["__NO_MATCH__"];
  }
  // Otherwise query orders matching the scope
  const orders = await prisma.order.findMany({
    where: scope,
    select: { id: true },
  });
  const ids = orders.map((o) => o.id);
  return ids.length > 0 ? ids : ["__NO_MATCH__"];
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    orderId, coveredOrderIds,
    contactName, sellerProfileId,
    sellerName,
    buyerOrganizationId, buyerOrganizationName, buyerTaxId,
    invoiceType, contentSummary, remark, items, taxIdFromLookup,
  } = body as Record<string, unknown>;

  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // Verify primary order exists
  const order = await prisma.order.findUnique({
    where: { id: orderId, deleted: false },
    select: { id: true, legacyExternalOrderId: true, customerId: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Deduplicate and validate ALL covered orders (including the primary)
  const covIds: string[] = Array.isArray(coveredOrderIds)
    ? (coveredOrderIds as string[])
    : [];
  const allCovered = [orderId, ...covIds].filter((v, i, a) => a.indexOf(v) === i);

  // Validate every covered order: exists, no active invoice (including primary)
  for (const cid of allCovered) {
    const co = await prisma.order.findUnique({
      where: { id: cid, deleted: false },
      select: { id: true },
    });
    if (!co) return NextResponse.json({ error: `订单 ${cid.slice(-6)} 不存在` }, { status: 400 });

    // Check for existing active invoice via OrderInvoiceCoverage
    const existingCov = await prisma.orderInvoiceCoverage.findFirst({
      where: { orderId: cid, invoiceRequest: { status: { not: "CANCELLED" } } },
    });
    if (existingCov) {
      return NextResponse.json({ error: `订单 ${cid.slice(-6)} 已有有效开票，不能重复开票` }, { status: 400 });
    }

    // Check direct orderId on ExternalOrderInvoiceRequest (without OrderInvoiceCoverage)
    const directOrderInvoice = await prisma.externalOrderInvoiceRequest.findFirst({
      where: { orderId: cid, status: { not: "CANCELLED" } },
    });
    if (directOrderInvoice) {
      return NextResponse.json({ error: `订单 ${cid.slice(-6)} 已有有效开票(direct)，不能重复开票` }, { status: 400 });
    }

    // Also check legacy: via Order.legacyExternalOrderId → ExternalOrder
    const orderWithLegacy = await prisma.order.findUnique({
      where: { id: cid },
      select: { legacyExternalOrderId: true },
    });
    const legacyExtId = orderWithLegacy?.legacyExternalOrderId ?? null;
    if (legacyExtId) {
      // Direct legacy invoice
      const legacyDirect = await prisma.externalOrderInvoiceRequest.findFirst({
        where: { externalOrderId: legacyExtId, status: { not: "CANCELLED" } },
      });
      if (legacyDirect) {
        return NextResponse.json({ error: `订单 ${cid.slice(-6)} 已有有效开票(legacy direct)，不能重复开票` }, { status: 400 });
      }
      // Legacy merge coverage
      const legacyCov = await prisma.externalOrderInvoiceCoverage.findFirst({
        where: { externalOrderId: legacyExtId, invoiceRequest: { status: { not: "CANCELLED" } } },
      });
      if (legacyCov) {
        return NextResponse.json({ error: `订单 ${cid.slice(-6)} 已有有效开票(legacy coverage)，不能重复开票` }, { status: 400 });
      }
    }
  }

  if (!buyerOrganizationName || !(buyerOrganizationName as string).trim()) {
    return NextResponse.json({ error: "对方公司名称不能为空" }, { status: 400 });
  }

  // Resolve seller profile
  let sellerSnapshot: Record<string, unknown> = {};
  if (sellerProfileId) {
    const profile = await prisma.billingProfile.findUnique({ where: { id: sellerProfileId as string } });
    if (profile) {
      sellerSnapshot = {
        sellerProfileId: profile.id, sellerName: profile.name,
        sellerTaxId: profile.taxId || null, sellerBankName: profile.bankName || null,
        sellerBankAccount: profile.bankAccount || null, sellerAddress: profile.address || null,
        sellerPhone: profile.phone || null,
      };
    }
  }
  if (!sellerSnapshot.sellerName && (sellerName as string)?.trim()) {
    sellerSnapshot.sellerName = (sellerName as string).trim();
  }

  const itemRows = (Array.isArray(items) ? items : []).filter((it: Record<string, unknown>) => (it.itemName as string)?.trim());
  const totalAmount = itemRows.reduce((sum: number, it: Record<string, unknown>) => sum + (Number(it.amount) || 0), 0);

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.externalOrderInvoiceRequest.create({
      data: {
        orderId,
        externalOrderId: order.legacyExternalOrderId,
        contactName: (contactName as string)?.trim() || null,
        ...sellerSnapshot,
        buyerOrganizationId: (buyerOrganizationId as string) || null,
        buyerOrganizationName: (buyerOrganizationName as string).trim(),
        buyerTaxId: (buyerTaxId as string)?.trim() || null,
        buyerTaxIdFromLookup: !!taxIdFromLookup,
        invoiceType: invoiceType === "SPECIAL" ? "SPECIAL" : "NORMAL",
        contentSummary: (contentSummary as string)?.trim() || null,
        totalAmount,
        remark: (remark as string)?.trim() || null,
        status: "DRAFT",
        createdById: session.user.id,
        items: itemRows.length > 0 ? {
          create: itemRows.map((it: Record<string, unknown>, i: number) => ({
            itemName: (it.itemName as string).trim(),
            spec: (it.spec as string)?.trim() || null,
            unit: (it.unit as string)?.trim() || null,
            quantity: it.quantity != null ? Number(it.quantity) : null,
            amount: Number(it.amount) || 0,
            sortOrder: i,
          })),
        } : undefined,
      },
    });

    for (const oid of allCovered) {
      await tx.orderInvoiceCoverage.create({
        data: { invoiceRequestId: inv.id, orderId: oid },
      });
    }

    return inv;
  });

  // Sync legacy ExternalOrder.invoiceStatus via legacyExternalOrderId
  for (const oid of allCovered) {
    const ord = await prisma.order.findUnique({
      where: { id: oid },
      select: { legacyExternalOrderId: true },
    });
    const legacyId = ord?.legacyExternalOrderId ?? null;

    // Sync legacy path
    if (legacyId) {
      await syncOrderInvoiceStatus(prisma, legacyId, oid);
    }
    // Sync new path (always do this for OrderInvoiceCoverage)
    await syncOrderInvoiceStatus(prisma, oid, oid);
  }

  const full = await prisma.externalOrderInvoiceRequest.findUnique({
    where: { id: invoice.id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { id: true, name: true } },
      orderCoverage: { include: { order: { select: { id: true, orderNo: true } } } },
    },
  });

  return NextResponse.json({ invoice: full }, { status: 201 });
}
