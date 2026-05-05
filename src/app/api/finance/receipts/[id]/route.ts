import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";

async function resolveReceiptCustomerId(receipt: {
  customerId: string | null;
  projectId: string | null;
  externalOrderId: string | null;
  orderId: string | null;
  projectInvoiceId: string | null;
  externalOrderInvoiceRequestId: string | null;
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
    },
  });
  if (!receipt) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  if (session.user.role !== "ADMIN") {
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
  const { amount, receivedAt, source, remark, customerId, projectId } = body;

  const existing = await prisma.financeReceipt.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  const receipt = await prisma.financeReceipt.update({
    where: { id },
    data: {
      ...(amount !== undefined ? { amount } : {}),
      ...(receivedAt !== undefined ? { receivedAt: new Date(receivedAt) } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(remark !== undefined ? { remark } : {}),
      ...(customerId !== undefined ? { customerId } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    },
  });

  return NextResponse.json(receipt);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.financeReceipt.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  await prisma.financeReceipt.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
