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

  const [orders, total, allOrdersForAggregate] = await Promise.all([
    prisma.order.findMany({
      where,
      select: ORDER_SELECT,
      orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: { id: true, totalAmount: true },
    }),
  ]);

  // Invoice and receipt totals for the current page
  const pageIds = orders.map((o) => o.id);
  const [pageInvoiceTotals, pageReceiptTotals] = await Promise.all([
    getOrderInvoiceTotals(pageIds),
    getOrderReceiptTotals(pageIds),
  ]);

  // Invoice and receipt totals for ALL matching orders (aggregate)
  const allIds = allOrdersForAggregate.map((o) => o.id);
  const [allInvoiceTotals, allReceiptTotals] = await Promise.all([
    getOrderInvoiceTotals(allIds),
    getOrderReceiptTotals(allIds),
  ]);

  // Aggregate: sum per-order totals which are now proportionally split for coverage invoices
  const aggregate = {
    totalAmount: allOrdersForAggregate.reduce((s, o) => s + o.totalAmount, 0),
    invoiceTotal: [...allInvoiceTotals.values()].reduce((s, v) => s + v, 0),
    receiptTotal: [...allReceiptTotals.values()].reduce((s, v) => s + v, 0),
  };
  (aggregate as Record<string, number>).unpaidTotal = Math.max(aggregate.invoiceTotal - aggregate.receiptTotal, 0);

  // Assemble result
  const result = orders.map((o) => ({
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
  }));

  return NextResponse.json({
    orders: result,
    aggregate,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
