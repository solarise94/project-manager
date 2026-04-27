import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { syncOrderInvoiceStatus } from "@/lib/external-order";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: externalOrderId } = await params;
  const order = await prisma.externalOrder.findUnique({ where: { id: externalOrderId }, select: { id: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const invoices = await prisma.externalOrderInvoiceRequest.findMany({
    where: { externalOrderId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: externalOrderId } = await params;
  const order = await prisma.externalOrder.findUnique({ where: { id: externalOrderId }, select: { id: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const {
    contactName, sellerProfileId,
    sellerName, sellerTaxId: manualSellerTaxId,
    sellerBankName: manualSellerBankName, sellerBankAccount: manualSellerBankAccount,
    buyerOrganizationId, buyerOrganizationName, buyerTaxId,
    invoiceType, contentSummary, remark, items, taxIdFromLookup,
  } = body as {
    contactName?: string; sellerProfileId?: string;
    sellerName?: string; sellerTaxId?: string;
    sellerBankName?: string; sellerBankAccount?: string;
    buyerOrganizationId?: string; buyerOrganizationName?: string;
    buyerTaxId?: string; invoiceType?: string; contentSummary?: string;
    remark?: string;
    items?: Array<{ itemName: string; spec?: string; unit?: string; quantity?: number; amount?: number }>;
    taxIdFromLookup?: boolean;
  };

  if (!buyerOrganizationName?.trim()) {
    return NextResponse.json({ error: "对方公司名称不能为空" }, { status: 400 });
  }
  if (!sellerProfileId && !sellerName?.trim()) {
    return NextResponse.json({ error: "开票方不能为空" }, { status: 400 });
  }
  if (buyerOrganizationId && !buyerTaxId?.trim()) {
    return NextResponse.json({ error: "已选择单位但未填写税号" }, { status: 400 });
  }

  const itemRows = (items || []).filter((it) => it.itemName?.trim());
  const totalAmount = itemRows.reduce((sum, it) => sum + (it.amount || 0), 0);

  if (buyerOrganizationId && buyerTaxId?.trim() && !taxIdFromLookup) {
    const org = await prisma.organization.findUnique({
      where: { id: buyerOrganizationId }, select: { taxId: true },
    });
    if (org && !org.taxId) {
      await prisma.organization.update({
        where: { id: buyerOrganizationId }, data: { taxId: buyerTaxId.trim() },
      });
    }
  }

  let sellerSnapshot: Record<string, string | null> = {};
  if (sellerProfileId) {
    const profile = await prisma.billingProfile.findUnique({ where: { id: sellerProfileId } });
    if (profile) {
      sellerSnapshot = {
        sellerProfileId: profile.id,
        sellerName: profile.name,
        sellerTaxId: profile.taxId || null,
        sellerBankName: profile.bankName || null,
        sellerBankAccount: profile.bankAccount || null,
        sellerAddress: profile.address || null,
        sellerPhone: profile.phone || null,
      };
    }
  }
  if (!sellerSnapshot.sellerName && sellerName?.trim()) {
    sellerSnapshot.sellerName = sellerName.trim();
  }
  if (!sellerProfileId) {
    if (manualSellerTaxId?.trim()) sellerSnapshot.sellerTaxId = manualSellerTaxId.trim();
    if (manualSellerBankName?.trim()) sellerSnapshot.sellerBankName = manualSellerBankName.trim();
    if (manualSellerBankAccount?.trim()) sellerSnapshot.sellerBankAccount = manualSellerBankAccount.trim();
  }

  const invoice = await prisma.externalOrderInvoiceRequest.create({
    data: {
      externalOrderId,
      contactName: contactName?.trim() || null,
      ...sellerSnapshot,
      buyerOrganizationId: buyerOrganizationId || null,
      buyerOrganizationName: buyerOrganizationName.trim(),
      buyerTaxId: buyerTaxId?.trim() || null,
      buyerTaxIdFromLookup: !!taxIdFromLookup,
      invoiceType: invoiceType === "SPECIAL" ? "SPECIAL" : "NORMAL",
      contentSummary: contentSummary?.trim() || null,
      totalAmount,
      remark: remark?.trim() || null,
      createdById: session.user.id,
      items: {
        create: itemRows.map((it, i) => ({
          sortOrder: i,
          itemName: it.itemName.trim(),
          spec: it.spec?.trim() || null,
          unit: it.unit?.trim() || null,
          quantity: it.quantity ?? null,
          amount: it.amount || 0,
        })),
      },
    },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  await syncOrderInvoiceStatus(prisma, externalOrderId);

  return NextResponse.json({ invoice }, { status: 201 });
}
