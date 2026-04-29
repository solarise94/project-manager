import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectContextReadable, isRepresentative } from "@/lib/permissions";

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["REQUESTED", "CANCELLED"],
  REQUESTED: ["ISSUED", "CANCELLED"],
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const invoice = await prisma.projectInvoice.findUnique({
    where: { id },
    select: { projectId: true, status: true, buyerTaxIdFromLookup: true },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let project: { deleted: boolean } | undefined;
  try {
    project = await assertProjectContextReadable(invoice.projectId, session.user.id, session.user.role) as { deleted: boolean };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (project?.deleted) {
    return NextResponse.json({ error: "已删除的项目不能修改开票申请" }, { status: 403 });
  }

  const currentStatus = invoice.status;

  // ISSUED and CANCELLED are terminal — no edits allowed
  if (currentStatus === "ISSUED" || currentStatus === "CANCELLED") {
    return NextResponse.json({ error: "终态开票申请不可修改" }, { status: 400 });
  }

  const body = await req.json();
  const {
    status,
    contactName,
    projectCode,
    sellerProfileId,
    sellerName,
    sellerTaxId: manualSellerTaxId,
    sellerBankName: manualSellerBankName,
    sellerBankAccount: manualSellerBankAccount,
    buyerOrganizationId,
    buyerOrganizationName,
    buyerTaxId,
    invoiceType,
    contentSummary,
    remark,
    items,
    taxIdFromLookup,
  } = body as {
    status?: string;
    contactName?: string;
    projectCode?: string;
    sellerProfileId?: string;
    sellerName?: string;
    sellerTaxId?: string;
    sellerBankName?: string;
    sellerBankAccount?: string;
    buyerOrganizationId?: string;
    buyerOrganizationName?: string;
    buyerTaxId?: string;
    invoiceType?: string;
    contentSummary?: string;
    remark?: string;
    items?: Array<{
      itemName: string;
      spec?: string;
      unit?: string;
      quantity?: number;
      amount?: number;
    }>;
    taxIdFromLookup?: boolean;
  };

  // Validate status transition if requested
  if (status && status !== currentStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: `不允许从 ${currentStatus} 转为 ${status}` }, { status: 400 });
    }
  }

  // REQUESTED: only remark and status changes allowed
  if (currentStatus === "REQUESTED") {
    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (remark !== undefined) data.remark = remark?.trim() || null;
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "已申请状态只能修改备注或变更状态" }, { status: 400 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const inv = await tx.projectInvoice.update({
        where: { id },
        data,
        include: { items: { orderBy: { sortOrder: "asc" } }, createdBy: { select: { id: true, name: true } } },
      });
      if (status && status !== currentStatus) {
        const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票", CANCELLED: "已取消" };
        await tx.activityLog.create({
          data: {
            type: "INVOICE_UPDATED",
            content: `开票申请状态从「${STATUS_LABEL[currentStatus] || currentStatus}」变更为「${STATUS_LABEL[status] || status}」`,
            metadata: JSON.stringify({ invoiceId: id, oldStatus: currentStatus, newStatus: status }),
            projectId: invoice.projectId,
            userId: session.user.id,
          },
        });
      }
      return inv;
    });
    return NextResponse.json({ invoice: updated });
  }

  // DRAFT: full edit allowed
  const data: Record<string, unknown> = {};
  if (status) data.status = status;
  if (contactName !== undefined) data.contactName = contactName?.trim() || null;
  if (projectCode !== undefined) data.projectCode = projectCode?.trim() || null;
  if (remark !== undefined) data.remark = remark?.trim() || null;
  if (invoiceType !== undefined) data.invoiceType = invoiceType === "SPECIAL" ? "SPECIAL" : "NORMAL";
  if (contentSummary !== undefined) data.contentSummary = contentSummary?.trim() || null;

  // Seller profile snapshot
  if (sellerProfileId !== undefined) {
    if (sellerProfileId) {
      const profile = await prisma.billingProfile.findUnique({ where: { id: sellerProfileId } });
      if (profile) {
        data.sellerProfileId = profile.id;
        data.sellerName = profile.name;
        data.sellerTaxId = profile.taxId || null;
        data.sellerBankName = profile.bankName || null;
        data.sellerBankAccount = profile.bankAccount || null;
        data.sellerAddress = profile.address || null;
        data.sellerPhone = profile.phone || null;
      }
    } else {
      data.sellerProfileId = null;
      data.sellerAddress = null;
      data.sellerPhone = null;
      if (sellerName !== undefined) data.sellerName = sellerName?.trim() || null;
      // Manual seller fields
      data.sellerTaxId = manualSellerTaxId?.trim() || null;
      data.sellerBankName = manualSellerBankName?.trim() || null;
      data.sellerBankAccount = manualSellerBankAccount?.trim() || null;
    }
  } else if (sellerName !== undefined) {
    data.sellerName = sellerName?.trim() || null;
  }

  // Buyer fields
  if (buyerOrganizationId !== undefined) data.buyerOrganizationId = buyerOrganizationId || null;
  if (buyerOrganizationName !== undefined) data.buyerOrganizationName = buyerOrganizationName?.trim() || "";
  if (buyerTaxId !== undefined) data.buyerTaxId = buyerTaxId?.trim() || null;
  if (taxIdFromLookup !== undefined) data.buyerTaxIdFromLookup = !!taxIdFromLookup;

  // Buyer taxId validation
  if (data.buyerOrganizationId && !data.buyerTaxId && buyerTaxId === undefined) {
    // Check if existing invoice has taxId
    const existing = await prisma.projectInvoice.findUnique({ where: { id }, select: { buyerTaxId: true } });
    if (!existing?.buyerTaxId) {
      return NextResponse.json({ error: "已选择单位但未填写税号" }, { status: 400 });
    }
  }

  // Buyer taxId writeback — skip when taxId came from AI lookup
  // Check both payload flag and persisted flag on the invoice
  const finalBuyerOrgId = (data.buyerOrganizationId as string) || undefined;
  const finalBuyerTaxId = (data.buyerTaxId as string) || undefined;
  const isFromLookup = taxIdFromLookup ?? invoice.buyerTaxIdFromLookup;
  if (finalBuyerOrgId && finalBuyerTaxId && !isFromLookup) {
    const org = await prisma.organization.findUnique({ where: { id: finalBuyerOrgId }, select: { taxId: true } });
    if (org && !org.taxId) {
      await prisma.organization.update({ where: { id: finalBuyerOrgId }, data: { taxId: finalBuyerTaxId } });
    }
  }

  // Items: replace semantics (precompute rows, apply inside transaction)
  const itemRows = items !== undefined
    ? items.filter((it) => it.itemName?.trim()).map((it, i) => ({
        invoiceId: id,
        sortOrder: i,
        itemName: it.itemName.trim(),
        spec: it.spec?.trim() || null,
        unit: it.unit?.trim() || null,
        quantity: it.quantity ?? null,
        amount: it.amount || 0,
      }))
    : undefined;

  if (itemRows !== undefined) {
    data.totalAmount = itemRows.reduce((sum, it) => sum + (it.amount || 0), 0);
  }

  if (Object.keys(data).length === 0 && items === undefined) {
    return NextResponse.json({ error: "无更新内容" }, { status: 400 });
  }

  const updatedDraft = await prisma.$transaction(async (tx) => {
    if (itemRows !== undefined) {
      await tx.projectInvoiceItem.deleteMany({ where: { invoiceId: id } });
      if (itemRows.length > 0) {
        await tx.projectInvoiceItem.createMany({ data: itemRows });
      }
    }

    const inv = await tx.projectInvoice.update({
      where: { id },
      data,
      include: { items: { orderBy: { sortOrder: "asc" } }, createdBy: { select: { id: true, name: true } } },
    });

    if (status && status !== currentStatus) {
      const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票", CANCELLED: "已取消" };
      await tx.activityLog.create({
        data: {
          type: "INVOICE_UPDATED",
          content: `开票申请状态从「${STATUS_LABEL[currentStatus] || currentStatus}」变更为「${STATUS_LABEL[status] || status}」`,
          metadata: JSON.stringify({ invoiceId: id, oldStatus: currentStatus, newStatus: status }),
          projectId: invoice.projectId,
          userId: session.user.id,
        },
      });
    }

    return inv;
  });

  return NextResponse.json({ invoice: updatedDraft });
}
