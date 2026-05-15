import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrderScopeWhere } from "@/lib/orders/permissions";
import { getOrderInvoiceTotals, getOrderReceiptTotals } from "@/lib/finance/order-receivables";

const ORDER_SELECT = {
  id: true, orderNo: true, title: true, totalAmount: true,
  orderedAt: true, status: true,
  customer: { select: { id: true, name: true } },
} as const;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "USER" && session.user.role !== "REPRESENTATIVE" && session.user.role !== "REGIONAL_MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const search = url.searchParams.get("search")?.trim() || "";
  const customerId = url.searchParams.get("customerId")?.trim() || "";
  const representativeId = url.searchParams.get("representativeId")?.trim() || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10)));
  const rawView = url.searchParams.get("view") || "all";
  const validViews = ["all", "uninvoiced", "invoiced_unpaid", "paid"] as const;
  const view = validViews.includes(rawView as typeof validViews[number]) ? rawView as typeof validViews[number] : "all";

  const scopeWhere = await getOrderScopeWhere(session.user.id, session.user.role);

  const andConditions: Record<string, unknown>[] = [];
  if (scopeWhere) andConditions.push(scopeWhere);

  if (search) {
    andConditions.push({
      OR: [
        { orderNo: { contains: search } },
        { title: { contains: search } },
        { buyerNameSnapshot: { contains: search } },
        { buyerOrgNameSnapshot: { contains: search } },
      ],
    });
  }
  if (customerId) andConditions.push({ customerId });
  if (representativeId) andConditions.push({ representativeId });

  andConditions.push({ deleted: false });

  const where: Record<string, unknown> = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

  // Fetch all matching orders (lightweight, for view filtering and aggregate)
  const allOrdersForAggregate = await prisma.order.findMany({
    where,
    select: { id: true, totalAmount: true, orderedAt: true, createdAt: true, customerId: true },
    orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
  });

  const allIds = allOrdersForAggregate.map((o) => o.id);
  const [allInvoiceTotals, allReceiptTotals] = await Promise.all([
    getOrderInvoiceTotals(allIds),
    getOrderReceiptTotals(allIds),
  ]);

  const orderCustomerMap = new Map(allOrdersForAggregate.map((o) => [o.id, o.customerId]));

  // Apply view filter
  let eligibleIds = allIds;
  if (view !== "all") {
    eligibleIds = allIds.filter((id) => {
      const invoiced = allInvoiceTotals.get(id) || 0;
      const received = allReceiptTotals.get(id) || 0;
      const unpaid = Math.max(invoiced - received, 0);
      const customerId = orderCustomerMap.get(id);
      switch (view) {
        case "uninvoiced": return customerId != null && invoiced <= 0;
        case "invoiced_unpaid": return customerId != null && invoiced > 0 && unpaid > 0;
        case "paid": return customerId != null && invoiced > 0 && unpaid <= 0;
        default: return true;
      }
    });
  }

  const total = eligibleIds.length;
  const totalPages = Math.ceil(total / pageSize);
  const pageIds = eligibleIds.slice((page - 1) * pageSize, page * pageSize);

  // Fetch full data for the current page
  const orders = pageIds.length > 0
    ? await prisma.order.findMany({
        where: { id: { in: pageIds } },
        select: ORDER_SELECT,
        orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
      })
    : [];

  // Build invoice/receipt maps for the page (reuse all totals)
  const pageInvoiceTotals = new Map<string, number>();
  const pageReceiptTotals = new Map<string, number>();
  for (const id of pageIds) {
    pageInvoiceTotals.set(id, allInvoiceTotals.get(id) || 0);
    pageReceiptTotals.set(id, allReceiptTotals.get(id) || 0);
  }

  // Aggregate based on filtered orders
  const eligibleOrderMap = new Map(allOrdersForAggregate.map((o) => [o.id, o]));
  const aggregate = {
    totalAmount: eligibleIds.reduce((s, id) => s + (eligibleOrderMap.get(id)?.totalAmount || 0), 0),
    invoiceTotal: eligibleIds.reduce((s, id) => s + (allInvoiceTotals.get(id) || 0), 0),
    receiptTotal: eligibleIds.reduce((s, id) => s + (allReceiptTotals.get(id) || 0), 0),
  };
  (aggregate as Record<string, number>).unpaidTotal = Math.max(aggregate.invoiceTotal - aggregate.receiptTotal, 0);

  // Assemble result (preserve original order from pageIds)
  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const result = pageIds.map((id) => {
    const o = orderMap.get(id)!;
    return {
      id: o.id,
      orderNo: o.orderNo,
      title: o.title,
      customer: o.customer,
      totalAmount: o.totalAmount,
      invoicedAmount: pageInvoiceTotals.get(o.id) || 0,
      receivedAmount: pageReceiptTotals.get(o.id) || 0,
      unpaidAmount: Math.max((pageInvoiceTotals.get(o.id) || 0) - (pageReceiptTotals.get(o.id) || 0), 0),
      orderedAt: o.orderedAt?.toISOString() ?? null,
      status: o.status,
    };
  });

  return NextResponse.json({
    orders: result,
    aggregate,
    total,
    page,
    pageSize,
    totalPages,
  });
}
