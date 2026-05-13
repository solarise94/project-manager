import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "USER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const advance = await prisma.financeAdvance.findUnique({
    where: { id },
    select: { id: true, amount: true, orderId: true, projectId: true, customerId: true, status: true },
  });
  if (!advance) return NextResponse.json({ error: "垫付记录不存在" }, { status: 404 });
  if (advance.status === "REFUNDED" || advance.status === "WRITTEN_OFF") {
    return NextResponse.json({ eligible: [], message: "垫付已完结" });
  }

  // Scope check
  if (session.user.role !== "ADMIN") {
    const [custScope, projScope] = await Promise.all([
      getFinanceCustomerScopeWhere(session.user.id, session.user.role),
      getFinanceProjectScopeWhere(session.user.id, session.user.role),
    ]);
    const custOk = !custScope || (advance.customerId && custScope.id.in.includes(advance.customerId));
    const projOk = !projScope || (advance.projectId && projScope.id.in.includes(advance.projectId));
    if (!custOk && !projOk) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Find receipts linked to the same order, project, or customer
  const receiptOr: Record<string, unknown>[] = [];
  if (advance.orderId) receiptOr.push({ orderId: advance.orderId });
  if (advance.projectId) receiptOr.push({ projectId: advance.projectId });
  if (advance.customerId) receiptOr.push({ customerId: advance.customerId });
  if (receiptOr.length === 0) return NextResponse.json({ eligible: [] });

  const receipts = await prisma.financeReceipt.findMany({
    where: { OR: receiptOr },
    select: {
      id: true,
      amount: true,
      receivedAt: true,
      source: true,
      orderId: true,
      projectId: true,
      customerId: true,
      order: { select: { orderNo: true } },
      project: { select: { name: true } },
      customer: { select: { name: true } },
    },
    orderBy: { receivedAt: "desc" },
  });

  // Get ALL refunds globally per receipt to compute accurate receipt-level remaining
  const receiptIds = receipts.map((r) => r.id);
  const allReceiptRefunds = await prisma.financeAdvanceRefund.findMany({
    where: { settledByReceiptId: { in: receiptIds } },
    select: { settledByReceiptId: true, amount: true },
  });

  const receiptRefunded = new Map<string, number>();
  for (const r of allReceiptRefunds) {
    if (r.settledByReceiptId) {
      receiptRefunded.set(r.settledByReceiptId, (receiptRefunded.get(r.settledByReceiptId) || 0) + r.amount);
    }
  }

  const advanceRefunds = await prisma.financeAdvanceRefund.findMany({
    where: { advanceId: id },
    select: { amount: true },
  });
  const totalRefunded = advanceRefunds.reduce((s, r) => s + r.amount, 0);
  const advanceRemaining = advance.amount - totalRefunded;

  const eligible = receipts.map((r) => {
    const used = receiptRefunded.get(r.id) || 0;
    const receiptAvailable = r.amount - used;
    return {
      id: r.id,
      amount: r.amount,
      receivedAt: r.receivedAt,
      source: r.source,
      orderNo: r.order?.orderNo || null,
      projectName: r.project?.name || null,
      customerName: r.customer?.name || null,
      availableForRefund: Math.min(receiptAvailable, advanceRemaining),
      totalUsed: used,
    };
  }).filter((e) => e.availableForRefund > 0);

  return NextResponse.json({ eligible });
}
