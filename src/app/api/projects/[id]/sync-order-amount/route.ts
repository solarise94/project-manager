import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const invoiceInclude = {
  invoiceRequests: {
    where: { status: { not: "CANCELLED" } },
    select: { id: true },
  },
  invoiceCoverage: {
    where: { invoiceRequest: { status: { not: "CANCELLED" } } },
    select: { id: true },
  },
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const projectId = (await params).id;
  const body = await req.json();
  const { orderId, mode } = body as { orderId?: string; mode?: string };

  if (!orderId || !mode) {
    return NextResponse.json({ error: "orderId and mode are required" }, { status: 400 });
  }
  if (!["ALLOCATED_AMOUNT", "FINANCE_OVERRIDE", "ORDER_TOTAL"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  // Load project
  const project = await prisma.project.findUnique({
    where: { id: projectId, deleted: false },
    select: { id: true, name: true, budgetAmount: true },
  });
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  if (!project.budgetAmount || project.budgetAmount <= 0) {
    return NextResponse.json({ error: "项目金额必须大于 0" }, { status: 400 });
  }

  // Verify the order is linked to this project
  const link = await prisma.orderProjectLink.findFirst({
    where: { projectId, orderId },
    select: { id: true, allocatedAmount: true, orderId: true, projectId: true },
  });
  if (!link) {
    return NextResponse.json({ error: "该订单未关联到当前项目" }, { status: 400 });
  }

  // Load order with financial context
  const order = await prisma.order.findUnique({
    where: { id: orderId, deleted: false },
    select: {
      id: true,
      orderNo: true,
      source: true,
      totalAmount: true,
      financeAmountOverride: true,
      lines: { select: { id: true, amount: true, unitPrice: true, quantity: true } },
      receipts: { select: { id: true } },
      financeCosts: { select: { id: true } },
      ...invoiceInclude,
      projectLinks: { select: { id: true, projectId: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const hasInvoices =
    order.invoiceRequests.length > 0 || order.invoiceCoverage.length > 0;
  const hasReceipts = order.receipts.length > 0;
  const hasCosts = order.financeCosts.length > 0;
  const isManual = order.source === "MANUAL";

  // FINANCE_OVERRIDE guard: only single-project orders (override is order-global)
  if (mode === "FINANCE_OVERRIDE" && order.projectLinks.length > 1) {
    return NextResponse.json(
      { error: "该订单关联多个项目，请使用分摊金额模式" },
      { status: 400 },
    );
  }

  // ORDER_TOTAL guard: only MANUAL orders with no invoices/receipts/costs
  if (mode === "ORDER_TOTAL") {
    if (!isManual) {
      return NextResponse.json(
        { error: "非手动创建的订单不能修改原始金额" },
        { status: 400 },
      );
    }
    if (hasInvoices || hasReceipts || hasCosts) {
      return NextResponse.json(
        { error: "订单已有发票/收款/成本记录，不能修改原始金额。请使用财务覆盖或分摊模式" },
        { status: 400 },
      );
    }
  }

  // Execute sync in transaction
  const newAmount = project.budgetAmount;
  const oldAmount =
    mode === "ALLOCATED_AMOUNT"
      ? (link.allocatedAmount ?? 0)
      : mode === "FINANCE_OVERRIDE"
        ? (order.financeAmountOverride ?? order.totalAmount)
        : order.totalAmount;

  await prisma.$transaction(async (tx) => {
    if (mode === "ALLOCATED_AMOUNT") {
      await tx.orderProjectLink.update({
        where: { id: link.id },
        data: { allocatedAmount: newAmount },
      });
    } else if (mode === "FINANCE_OVERRIDE") {
      await tx.order.update({
        where: { id: orderId },
        data: { financeAmountOverride: newAmount },
      });
    } else if (mode === "ORDER_TOTAL") {
      await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount: newAmount,
          financeAmountOverride: null,
        },
      });
      // If there's exactly one line, sync it too
      if (order.lines.length === 1) {
        const line = order.lines[0];
        const quantity = line.quantity && line.quantity > 0 ? line.quantity : 1;
        await tx.orderLine.update({
          where: { id: line.id },
          data: {
            amount: newAmount,
            unitPrice: quantity > 0 ? newAmount / quantity : newAmount,
          },
        });
      }
    }

    await tx.activityLog.create({
      data: {
        type: "PROJECT_UPDATED",
        content: `项目金额同步到订单: ¥${oldAmount} → ¥${newAmount} (mode=${mode})`,
        metadata: JSON.stringify({
          action: "PROJECT_ORDER_AMOUNT_SYNCED",
          orderId,
          projectId,
          mode,
          oldAmount,
          newAmount,
        }),
        projectId,
        userId: session.user.id,
      },
    });
  });

  const modeLabel: Record<string, string> = {
    ALLOCATED_AMOUNT: `分摊金额已更新为 ¥${newAmount}`,
    FINANCE_OVERRIDE: `订单财务覆盖金额已更新为 ¥${newAmount}`,
    ORDER_TOTAL: `订单原始金额已更新为 ¥${newAmount}`,
  };

  return NextResponse.json({
    ok: true,
    newAmount,
    mode,
    message: modeLabel[mode],
  });
}
