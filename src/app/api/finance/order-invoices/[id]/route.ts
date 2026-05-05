import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncOrderInvoiceStatus } from "@/lib/external-order";

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["REQUESTED", "CANCELLED"],
  REQUESTED: ["ISSUED", "CANCELLED"],
};

async function syncAllCoveredOrders(invoiceId: string) {
  const newCoverage = await prisma.orderInvoiceCoverage.findMany({
    where: { invoiceRequestId: invoiceId },
    select: { orderId: true },
  });
  for (const cov of newCoverage) {
    // Find legacy ExternalOrder via Order.legacyExternalOrderId
    const order = await prisma.order.findUnique({
      where: { id: cov.orderId },
      select: { legacyExternalOrderId: true },
    });
    const legacyId = order?.legacyExternalOrderId ?? null;
    if (legacyId) {
      await syncOrderInvoiceStatus(prisma, legacyId, cov.orderId);
    }
    // Always sync new path for OrderInvoiceCoverage
    await syncOrderInvoiceStatus(prisma, cov.orderId, cov.orderId);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const invoice = await prisma.externalOrderInvoiceRequest.findUnique({
    where: { id },
    select: { status: true, orderId: true },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const currentStatus = invoice.status;
  if (currentStatus === "ISSUED" || currentStatus === "CANCELLED") {
    return NextResponse.json({ error: "终态开票申请不可修改" }, { status: 400 });
  }

  const body = await req.json();
  const {
    status, contactName, sellerProfileId, sellerName,
    sellerTaxId: manualSellerTaxId, sellerBankName: manualSellerBankName,
    sellerBankAccount: manualSellerBankAccount,
    buyerOrganizationId, buyerOrganizationName, buyerTaxId,
    invoiceType, contentSummary, remark, items, taxIdFromLookup,
  } = body as Record<string, unknown>;

  if (status && status !== currentStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(status as string)) {
      return NextResponse.json({ error: `不允许从 ${currentStatus} 转为 ${status}` }, { status: 400 });
    }
  }

  if (currentStatus === "REQUESTED") {
    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (remark !== undefined) data.remark = (remark as string)?.trim() || null;
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "已申请状态只能修改备注或变更状态" }, { status: 400 });
    }
    const updated = await prisma.externalOrderInvoiceRequest.update({
      where: { id }, data,
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        createdBy: { select: { id: true, name: true } },
        orderCoverage: { include: { order: { select: { id: true, orderNo: true } } } },
      },
    });
    await syncAllCoveredOrders(id);
    return NextResponse.json({ invoice: updated });
  }

  const data: Record<string, unknown> = {};
  if (status) data.status = status;
  if (contactName !== undefined) data.contactName = (contactName as string)?.trim() || null;
  if (remark !== undefined) data.remark = (remark as string)?.trim() || null;
  if (invoiceType !== undefined) data.invoiceType = invoiceType === "SPECIAL" ? "SPECIAL" : "NORMAL";
  if (contentSummary !== undefined) data.contentSummary = (contentSummary as string)?.trim() || null;

  if (sellerProfileId !== undefined) {
    if (sellerProfileId) {
      const profile = await prisma.billingProfile.findUnique({ where: { id: sellerProfileId as string } });
      if (profile) {
        data.sellerProfileId = profile.id; data.sellerName = profile.name;
        data.sellerTaxId = profile.taxId || null; data.sellerBankName = profile.bankName || null;
        data.sellerBankAccount = profile.bankAccount || null;
        data.sellerAddress = profile.address || null; data.sellerPhone = profile.phone || null;
      }
    } else {
      data.sellerProfileId = null; data.sellerAddress = null; data.sellerPhone = null;
      if (sellerName !== undefined) data.sellerName = (sellerName as string)?.trim() || null;
      data.sellerTaxId = (manualSellerTaxId as string)?.trim() || null;
      data.sellerBankName = (manualSellerBankName as string)?.trim() || null;
      data.sellerBankAccount = (manualSellerBankAccount as string)?.trim() || null;
    }
  }

  if (buyerOrganizationId !== undefined) data.buyerOrganizationId = buyerOrganizationId || null;
  if (buyerOrganizationName !== undefined) data.buyerOrganizationName = (buyerOrganizationName as string)?.trim() || "";
  if (buyerTaxId !== undefined) data.buyerTaxId = (buyerTaxId as string)?.trim() || null;
  if (taxIdFromLookup !== undefined) data.buyerTaxIdFromLookup = !!taxIdFromLookup;

  if (items !== undefined) {
    const itemRows = (Array.isArray(items) ? items : []).filter((it: Record<string, unknown>) => (it.itemName as string)?.trim());
    data.totalAmount = itemRows.reduce((sum: number, it: Record<string, unknown>) => sum + (Number(it.amount) || 0), 0);
    await prisma.externalOrderInvoiceItem.deleteMany({ where: { invoiceRequestId: id } });
    if (itemRows.length > 0) {
      await prisma.externalOrderInvoiceItem.createMany({
        data: itemRows.map((it: Record<string, unknown>, i: number) => ({
          invoiceRequestId: id, sortOrder: i,
          itemName: (it.itemName as string).trim(), spec: (it.spec as string)?.trim() || null,
          unit: (it.unit as string)?.trim() || null, quantity: it.quantity != null ? Number(it.quantity) : null,
          amount: Number(it.amount) || 0,
        })),
      });
    }
  }

  if (Object.keys(data).length === 0 && items === undefined) {
    return NextResponse.json({ error: "无更新内容" }, { status: 400 });
  }

  const updated = await prisma.externalOrderInvoiceRequest.update({
    where: { id }, data,
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { id: true, name: true } },
      orderCoverage: { include: { order: { select: { id: true, orderNo: true } } } },
    },
  });

  await syncAllCoveredOrders(id);
  return NextResponse.json({ invoice: updated });
}
