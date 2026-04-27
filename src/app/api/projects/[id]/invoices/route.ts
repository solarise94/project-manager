import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectContextReadable, isRepresentative } from "@/lib/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await params;
  try {
    await assertProjectContextReadable(projectId, session.user.id, session.user.role);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invoices = await prisma.projectInvoice.findMany({
    where: { projectId },
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

  const { id: projectId } = await params;
  let project: { deleted: boolean } | undefined;
  try {
    project = await assertProjectContextReadable(projectId, session.user.id, session.user.role) as { deleted: boolean };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (project?.deleted) {
    return NextResponse.json({ error: "已删除的项目不能新建开票申请" }, { status: 403 });
  }

  const body = await req.json();
  const {
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

  if (!buyerOrganizationName?.trim()) {
    return NextResponse.json({ error: "对方公司名称不能为空" }, { status: 400 });
  }

  if (!sellerProfileId && !sellerName?.trim()) {
    return NextResponse.json({ error: "开票方不能为空" }, { status: 400 });
  }

  // If org selected but no taxId provided, reject
  if (buyerOrganizationId && !buyerTaxId?.trim()) {
    return NextResponse.json({ error: "已选择单位但未填写税号，请补填统一社会信用代码/纳税人识别号" }, { status: 400 });
  }

  const itemRows = (items || []).filter((it) => it.itemName?.trim());
  const totalAmount = itemRows.reduce((sum, it) => sum + (it.amount || 0), 0);

  // If org selected and has no taxId in master data, write back the provided one
  // Skip writeback when taxId came from AI lookup (requires human confirmation at org level)
  if (buyerOrganizationId && buyerTaxId?.trim() && !taxIdFromLookup) {
    const org = await prisma.organization.findUnique({
      where: { id: buyerOrganizationId },
      select: { taxId: true },
    });
    if (org && !org.taxId) {
      await prisma.organization.update({
        where: { id: buyerOrganizationId },
        data: { taxId: buyerTaxId.trim() },
      });
    }
  }

  // Resolve seller profile snapshot
  let sellerSnapshot: {
    sellerProfileId?: string | null;
    sellerName?: string | null;
    sellerTaxId?: string | null;
    sellerBankName?: string | null;
    sellerBankAccount?: string | null;
    sellerAddress?: string | null;
    sellerPhone?: string | null;
  } = {};
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
  // Manual seller fields (only when no profile selected)
  if (!sellerProfileId) {
    if (manualSellerTaxId?.trim()) sellerSnapshot.sellerTaxId = manualSellerTaxId.trim();
    if (manualSellerBankName?.trim()) sellerSnapshot.sellerBankName = manualSellerBankName.trim();
    if (manualSellerBankAccount?.trim()) sellerSnapshot.sellerBankAccount = manualSellerBankAccount.trim();
  }

  const invoice = await prisma.projectInvoice.create({
    data: {
      projectId,
      contactName: contactName?.trim() || null,
      projectCode: projectCode?.trim() || null,
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

  return NextResponse.json({ invoice }, { status: 201 });
}
