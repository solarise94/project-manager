import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { getOrderScopeWhere } from "@/lib/orders/permissions";
import { parseReceivedAtInput } from "@/lib/finance/receipt-date";
import { prisma } from "@/lib/prisma";

async function resolveReceiptCustomerId(receipt: {
  customerId: string | null;
  projectId: string | null;
  externalOrderId: string | null;
  orderId: string | null;
  projectInvoiceId: string | null;
  externalOrderInvoiceRequestId: string | null;
  allocations?: Array<{ orderId: string | null }>;
}): Promise<string | null> {
  if (receipt.customerId) return receipt.customerId;
  if (receipt.externalOrderId) {
    const eo = await prisma.externalOrder.findUnique({ where: { id: receipt.externalOrderId }, select: { customerId: true } });
    if (eo?.customerId) return eo.customerId;
  }
  if (receipt.orderId) {
    const order = await prisma.order.findUnique({ where: { id: receipt.orderId }, select: { customerId: true } });
    if (order?.customerId) return order.customerId;
  }
  // Allocations path: resolve from allocation orderIds
  if (receipt.allocations && receipt.allocations.length > 0) {
    const orderIds = [...new Set(receipt.allocations.map((a) => a.orderId).filter(Boolean))] as string[];
    if (orderIds.length > 0) {
      const orders = await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { customerId: true },
      });
      const customerId = orders.find((o) => o.customerId)?.customerId;
      if (customerId) return customerId;
    }
  }
  if (receipt.projectId) {
    const proj = await prisma.project.findUnique({ where: { id: receipt.projectId }, select: { customerId: true } });
    if (proj?.customerId) return proj.customerId;
  }
  if (receipt.projectInvoiceId) {
    const inv = await prisma.projectInvoice.findUnique({ where: { id: receipt.projectInvoiceId }, select: { project: { select: { customerId: true } } } });
    if (inv?.project?.customerId) return inv.project.customerId;
  }
  if (receipt.externalOrderInvoiceRequestId) {
    const eoi = await prisma.externalOrderInvoiceRequest.findUnique({
      where: { id: receipt.externalOrderInvoiceRequestId },
      select: {
        externalOrder: { select: { customerId: true } },
        order: { select: { customerId: true } },
      },
    });
    if (eoi?.externalOrder?.customerId) return eoi.externalOrder.customerId;
    if (eoi?.order?.customerId) return eoi.order.customerId;
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const receipt = await prisma.financeReceipt.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      externalOrder: { select: { id: true, externalOrderNo: true } },
      order: { select: { id: true, orderNo: true } },
      projectInvoice: { select: { id: true, totalAmount: true } },
      externalOrderInvoiceRequest: { select: { id: true, totalAmount: true } },
      createdBy: { select: { id: true, name: true } },
      organization: { select: { id: true, canonicalName: true } },
      allocations: {
        include: {
          invoice: {
            select: { id: true, actualInvoiceNo: true, totalAmount: true, buyerOrganizationName: true },
          },
          order: { select: { id: true, orderNo: true } },
        },
      },
    },
  });
  if (!receipt) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  // Deleted receipts: only ADMIN can view
  if (receipt.deleted && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  if (session.user.role !== "ADMIN") {
    // Collect all order IDs this receipt touches (direct or via allocations)
    const linkedOrderIds = new Set<string>();
    if (receipt.orderId) linkedOrderIds.add(receipt.orderId);
    if (receipt.allocations) {
      for (const a of receipt.allocations) {
        if (a.orderId) linkedOrderIds.add(a.orderId);
      }
    }

    if (linkedOrderIds.size > 0) {
      // Use order-scope (same as list API) for order-linked receipts.
      // This ensures consistency: a receipt visible in the list is also accessible in detail.
      const orderScope = await getOrderScopeWhere(session.user.id, session.user.role);
      if (!orderScope) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const inScope = await prisma.order.count({
        where: { id: { in: [...linkedOrderIds] }, AND: [orderScope] },
      });
      if (inScope !== linkedOrderIds.size) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      // Fallback: customer-scope for receipts without order links (e.g. project-only)
      const resolvedCustId = await resolveReceiptCustomerId(receipt);
      if (resolvedCustId) {
        const scope = await getFinanceCustomerScopeWhere(session.user.id, session.user.role);
        if (scope && !scope.id.in.includes(resolvedCustId)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
      if (receipt.projectId) {
        const projScope = await getFinanceProjectScopeWhere(session.user.id, session.user.role);
        if (projScope && !projScope.id.in.includes(receipt.projectId)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
    }
  }

  return NextResponse.json(receipt);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { amount, receivedAt, source, remark, orderId } = body;

  // Reject projectId edits — project-only receipts are deprecated
  if ("projectId" in body || "customerId" in body) {
    return NextResponse.json({ error: "projectId/customerId 已废弃，customer 由订单派生" }, { status: 400 });
  }

  const existing = await prisma.financeReceipt.findUnique({
    where: { id },
    include: {
      settledAdvances: { select: { id: true, amount: true } },
      settledAdvanceRefunds: { select: { id: true, amount: true } },
      allocations: { select: { id: true, amount: true } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  if (existing.deleted) return NextResponse.json({ error: "已删除的到款记录不能编辑" }, { status: 409 });

  // §9.3: Block amount/orderId/source changes if receipt has allocations
  const hasAllocations = existing.allocations.length > 0;
  if (hasAllocations) {
    if (amount !== undefined && amount !== existing.amount) {
      return NextResponse.json({
        error: "该回款包含发票核销分摊，不能修改金额。请先撤销核销后再修改",
      }, { status: 409 });
    }
    if (orderId !== undefined) {
      return NextResponse.json({
        error: "该回款包含发票核销分摊，不能修改关联订单",
      }, { status: 409 });
    }
    if (source !== undefined && source !== existing.source) {
      return NextResponse.json({
        error: "该回款包含发票核销分摊，不能修改来源",
      }, { status: 409 });
    }
  }

  // Validation
  if (amount !== undefined) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });
    }
  }
  let parsedReceivedAt: Date | undefined;
  if (receivedAt !== undefined) {
    try {
      parsedReceivedAt = parseReceivedAtInput(receivedAt);
    } catch {
      return NextResponse.json({ error: "到款日期无效" }, { status: 400 });
    }
  }
  const VALID_SOURCES = ["MANUAL", "BANK", "PINGOODMICE_ORDER", "OTHER"];
  if (source !== undefined && !VALID_SOURCES.includes(source)) {
    return NextResponse.json({ error: "来源值无效" }, { status: 400 });
  }

  // Block amount/orderId changes if this receipt has settled advances or refunds
  const hasSettlements = existing.settledAdvances.length > 0 || existing.settledAdvanceRefunds.length > 0;
  if ((amount !== undefined && amount !== existing.amount) || (orderId !== undefined && orderId !== existing.orderId)) {
    if (hasSettlements) {
      return NextResponse.json({ error: "该回款已用于预收款核销或垫付退款，修改金额或订单可能破坏结算一致性。请先解除关联后再修改" }, { status: 409 });
    }
  }

  // Resolve effective orderId: use new if provided, else keep existing
  const effectiveOrderId = orderId !== undefined ? orderId : existing.orderId;

  // For allocation-based receipts, allow editing without orderId
  if (!hasAllocations && !effectiveOrderId) {
    return NextResponse.json({ error: "回款必须关联订单。请先迁移此记录或设置 orderId" }, { status: 400 });
  }

  // Derive customerId from order — only for non-allocation receipts
  let derivedCustomerId = existing.customerId;
  if (effectiveOrderId && !hasAllocations) {
    const order = await prisma.order.findUnique({
      where: { id: effectiveOrderId },
      select: { id: true, customerId: true },
    });
    if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 400 });
    derivedCustomerId = order.customerId;

    // Clear legacy fields when orderId is confirmed
    const clearLegacy = (effectiveOrderId && (existing.projectId || existing.projectInvoiceId || existing.externalOrderId || existing.externalOrderInvoiceRequestId));
    const receipt = await prisma.financeReceipt.update({
      where: { id },
      data: {
        ...(amount !== undefined ? { amount } : {}),
        ...(parsedReceivedAt !== undefined ? { receivedAt: parsedReceivedAt } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(remark !== undefined ? { remark } : {}),
        customerId: derivedCustomerId,
        ...(orderId !== undefined ? { orderId } : {}),
        ...(clearLegacy ? { projectId: null, projectInvoiceId: null, externalOrderId: null, externalOrderInvoiceRequestId: null } : {}),
      },
    });
    return NextResponse.json(receipt);
  }

  // Allocation-based receipt: only allow remark, receivedAt, source edits
  const receipt = await prisma.financeReceipt.update({
    where: { id },
    data: {
      ...(parsedReceivedAt !== undefined ? { receivedAt: parsedReceivedAt } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(remark !== undefined ? { remark } : {}),
    },
  });

  return NextResponse.json(receipt);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let reason: string | undefined;
  try {
    const body = await req.json();
    reason = body.reason?.trim() || undefined;
  } catch {
    // reason is optional
  }

  const receipt = await prisma.financeReceipt.findUnique({
    where: { id },
    include: {
      settledAdvances: { select: { id: true } },
      settledAdvanceRefunds: { select: { id: true } },
      order: { select: { id: true } },
      customer: { select: { id: true } },
      project: { select: { id: true } },
      projectInvoice: { select: { id: true } },
      externalOrderInvoiceRequest: { select: { id: true } },
      allocations: {
        select: {
          id: true,
          invoiceId: true,
          orderId: true,
          amount: true,
          createdAt: true,
        },
      },
    },
  });

  if (!receipt) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  if (receipt.deleted) return NextResponse.json({ error: "该到款记录已删除" }, { status: 409 });

  if (receipt.settledAdvances.length > 0 || receipt.settledAdvanceRefunds.length > 0) {
    return NextResponse.json({ error: "该到款已用于预收款核销或垫付退款，请先解除核销关系后再删除" }, { status: 409 });
  }

  // Build snapshot including allocations (§9.2)
  const snapshot = {
    id: receipt.id,
    amount: receipt.amount,
    receivedAt: receipt.receivedAt.toISOString(),
    source: receipt.source,
    remark: receipt.remark,
    orderId: receipt.orderId,
    customerId: receipt.customerId,
    projectId: receipt.projectId,
    projectInvoiceId: receipt.projectInvoiceId,
    externalOrderInvoiceRequestId: receipt.externalOrderInvoiceRequestId,
    externalOrderId: receipt.externalOrderId,
    createdById: receipt.createdById,
    createdAt: receipt.createdAt.toISOString(),
    allocations: receipt.allocations.map((a) => ({
      id: a.id,
      invoiceId: a.invoiceId,
      orderId: a.orderId,
      amount: a.amount,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  const [deletionLog] = await prisma.$transaction([
    prisma.financeReceiptDeletionLog.create({
      data: {
        receiptId: receipt.id,
        amount: receipt.amount,
        receivedAt: receipt.receivedAt,
        orderId: receipt.orderId,
        customerId: receipt.customerId,
        projectId: receipt.projectId,
        source: receipt.source,
        remark: receipt.remark,
        reason,
        snapshotJson: JSON.stringify(snapshot),
        deletedById: session.user.id,
      },
    }),
    prisma.financeReceipt.update({
      where: { id },
      data: {
        deleted: true,
        deletedAt: new Date(),
        deletedById: session.user.id,
        deleteReason: reason || null,
      },
    }),
  ]);

  return NextResponse.json({ receiptId: receipt.id, deletionLogId: deletionLog.id });
}
