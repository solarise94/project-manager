import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOrderAccessBlocked, getOrderScopeWhere } from "@/lib/orders/permissions";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isOrderAccessBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNo: true,
      totalAmount: true,
      financeAmountOverride: true,
      financeTreatment: true,
      category: true,
      status: true,
      deliveryStatus: true,
      customerId: true,
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Scope check simplified: if the user can't see the order, forbid
  if (session.user.role !== "ADMIN") {
    const scopeWhere = await getOrderScopeWhere(session.user.id, session.user.role);
    if (scopeWhere) {
      const inScope = await prisma.order.count({ where: { id, AND: [scopeWhere] } });
      if (inScope === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const effectiveAmount = order.financeAmountOverride ?? order.totalAmount;

  // Aggregate receipt amounts for this order
  const receiptAgg = await prisma.financeReceipt.aggregate({
    where: { orderId: id },
    _sum: { amount: true },
  });
  const receiptAmount = receiptAgg._sum.amount ?? 0;

  // Invoice amounts: sum both project and external-order invoices linked to this order's legacyExternalOrderId
  // For now, use a lightweight approach: count receipts directly on the order
  // TODO: full invoice integration when OrderInvoice coverage exists

  return NextResponse.json({
    orderId: order.id,
    orderNo: order.orderNo,
    orderAmount: order.totalAmount,
    effectiveAmount,
    financeTreatment: order.financeTreatment,
    category: order.category,
    status: order.status,
    deliveryStatus: order.deliveryStatus,
    receiptAmount,
    // Invoice amounts will be enriched by finance module later
  });
}
