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

  // Direct invoices + invoices that cover this order via coverage table
  const coverageInvoiceIds = (
    await prisma.externalOrderInvoiceCoverage.findMany({
      where: { externalOrderId },
      select: { invoiceRequestId: true },
    })
  ).map((c) => c.invoiceRequestId);

  const directInvoices = await prisma.externalOrderInvoiceRequest.findMany({
    where: { externalOrderId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const coverageInvoices = coverageInvoiceIds.length > 0
    ? await prisma.externalOrderInvoiceRequest.findMany({
        where: { id: { in: coverageInvoiceIds } },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Merge, deduplicate by id
  const seen = new Set(directInvoices.map((i) => i.id));
  const merged = [...directInvoices];
  for (const inv of coverageInvoices) {
    if (!seen.has(inv.id)) {
      merged.push(inv);
      seen.add(inv.id);
    }
  }

  return NextResponse.json({ invoices: merged });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
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
    coveredOrderIds,
  } = body as {
    contactName?: string; sellerProfileId?: string;
    sellerName?: string; sellerTaxId?: string;
    sellerBankName?: string; sellerBankAccount?: string;
    buyerOrganizationId?: string; buyerOrganizationName?: string;
    buyerTaxId?: string; invoiceType?: string; contentSummary?: string;
    remark?: string;
    items?: Array<{ itemName: string; spec?: string; unit?: string; quantity?: number; amount?: number }>;
    taxIdFromLookup?: boolean;
    coveredOrderIds?: string[];
  };

  const allOrderIds = [externalOrderId, ...(coveredOrderIds || [])].filter((v, i, a) => a.indexOf(v) === i);

  // Validate covered orders: exist, not merged, no active invoice
  if (coveredOrderIds?.length) {
    const coveredOrders = await prisma.externalOrder.findMany({
      where: { id: { in: coveredOrderIds } },
      select: { id: true, mergedIntoId: true, duplicateStatus: true, invoiceStatus: true },
    });
    if (coveredOrders.length !== coveredOrderIds.length) {
      return NextResponse.json({ error: "部分被覆盖订单不存在" }, { status: 400 });
    }
    for (const co of coveredOrders) {
      if (co.mergedIntoId || co.duplicateStatus === "MERGED") {
        return NextResponse.json({ error: `订单 ${co.id.slice(-6)} 已被合并，不能参与开票` }, { status: 400 });
      }
      if (co.invoiceStatus !== "NONE") {
        return NextResponse.json({ error: `订单 ${co.id.slice(-6)} 已有有效开票，不能重复开票` }, { status: 400 });
      }
    }
  }

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

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.externalOrderInvoiceRequest.create({
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

    // Write coverage for all covered order IDs
    if (coveredOrderIds?.length) {
      await tx.externalOrderInvoiceCoverage.createMany({
        data: coveredOrderIds.map((oid) => ({
          invoiceRequestId: inv.id,
          externalOrderId: oid,
        })),
      });
    }

    // Sync invoice status for all affected orders
    for (const oid of allOrderIds) {
      await syncOrderInvoiceStatus(tx as typeof prisma, oid);
    }

    return inv;
  });

  return NextResponse.json({ invoice }, { status: 201 });
}
