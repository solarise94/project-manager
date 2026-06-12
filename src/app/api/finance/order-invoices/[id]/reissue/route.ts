import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findBlockingInvoicesForOrder, assertInvoiceNotOccupied } from "@/lib/finance/order-invoices";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const original = await prisma.externalOrderInvoiceRequest.findUnique({
    where: { id },
    include: {
      orderCoverage: { select: { orderId: true } },
      order: { select: { id: true } },
    },
  });

  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (original.status !== "ISSUED") {
    return NextResponse.json({ error: "只有已开票的发票才能重开" }, { status: 400 });
  }

  // Check if already has any adjustment
  const existingAdjustment = await prisma.invoiceAdjustment.findFirst({
    where: { originalInvoiceId: id },
  });
  if (existingAdjustment?.kind === "RED") {
    return NextResponse.json({ error: "该发票已冲红，不能重开" }, { status: 400 });
  }
  if (existingAdjustment?.kind === "REISSUE") {
    return NextResponse.json({ error: "该发票已重开，不能重复重开" }, { status: 400 });
  }

  // §9.1: Check invoice occupation before allowing REISSUE (same as RED)
  try {
    await assertInvoiceNotOccupied(id);
  } catch (err: unknown) {
    const e = err as { status?: number; body?: unknown };
    if (e.status === 409) {
      return NextResponse.json(e.body, { status: 409 });
    }
    throw err;
  }

  const body = await req.json();
  const {
    reason,
    contactName, sellerProfileId,
    sellerName,
    buyerOrganizationId, buyerOrganizationName, buyerTaxId,
    invoiceType, contentSummary, remark, items, taxIdFromLookup,
  } = body as Record<string, unknown>;

  // Collect all covered order IDs from original
  const coveredOrderIds = original.orderCoverage.map((c) => c.orderId);
  if (original.orderId) coveredOrderIds.push(original.orderId);
  const uniqueOrderIds = [...new Set(coveredOrderIds)];

  // Check for blocking invoices on covered orders.
  // Allow if the only blocker is the original invoice itself (being reissued).
  for (const oid of uniqueOrderIds) {
    const blockers = await findBlockingInvoicesForOrder(oid);
    const otherBlockers = blockers.filter((b) => b.id !== id);
    if (otherBlockers.length > 0) {
      const b = otherBlockers[0];
      return NextResponse.json({
        error: `订单已有${b.status === "ISSUED" ? "已开票" : b.status === "REQUESTED" ? "待开票" : "草稿"}记录，不能重开`,
        blockingInvoiceId: b.id,
        blockingInvoiceStatus: b.status,
      }, { status: 400 });
    }
  }

  if (!buyerOrganizationName || !(buyerOrganizationName as string).trim()) {
    return NextResponse.json({ error: "对方公司名称不能为空" }, { status: 400 });
  }

  // Resolve seller profile
  let sellerSnapshot: Record<string, unknown> = {};
  if (sellerProfileId) {
    const profile = await prisma.billingProfile.findUnique({ where: { id: sellerProfileId as string } });
    if (profile) {
      sellerSnapshot = {
        sellerProfileId: profile.id, sellerName: profile.name,
        sellerTaxId: profile.taxId || null, sellerBankName: profile.bankName || null,
        sellerBankAccount: profile.bankAccount || null, sellerAddress: profile.address || null,
        sellerPhone: profile.phone || null,
      };
    }
  }
  if (!sellerSnapshot.sellerName && (sellerName as string)?.trim()) {
    sellerSnapshot.sellerName = (sellerName as string).trim();
  }

  const itemRows = (Array.isArray(items) ? items : []).filter((it: Record<string, unknown>) => (it.itemName as string)?.trim());
  const totalAmount = itemRows.reduce((sum: number, it: Record<string, unknown>) => sum + (Number(it.amount) || 0), 0);

  // Build remark with reissue note appended
  const finalRemark = remark
    ? `${remark}\n[重开原发票: ${id}]`
    : `[重开原发票: ${id}]`;

  let newInvoice;
  try {
    newInvoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.externalOrderInvoiceRequest.create({
        data: {
          orderId: original.orderId,
          externalOrderId: original.externalOrderId,
          contactName: (contactName as string)?.trim() || null,
          ...sellerSnapshot,
          buyerOrganizationId: (buyerOrganizationId as string) || null,
          buyerOrganizationName: (buyerOrganizationName as string).trim(),
          buyerTaxId: (buyerTaxId as string)?.trim() || null,
          buyerTaxIdFromLookup: !!taxIdFromLookup,
          invoiceType: invoiceType === "SPECIAL" ? "SPECIAL" : "NORMAL",
          contentSummary: (contentSummary as string)?.trim() || null,
          totalAmount,
          remark: finalRemark,
          status: "DRAFT",
          createdById: session.user.id,
          items: itemRows.length > 0 ? {
            create: itemRows.map((it: Record<string, unknown>, i: number) => ({
              itemName: (it.itemName as string).trim(),
              spec: (it.spec as string)?.trim() || null,
              unit: (it.unit as string)?.trim() || null,
              quantity: it.quantity != null ? Number(it.quantity) : null,
              amount: Number(it.amount) || 0,
              sortOrder: i,
            })),
          } : undefined,
        },
      });

      // Reuse original coverage orders
      for (const oid of uniqueOrderIds) {
        await tx.orderInvoiceCoverage.create({
          data: { invoiceRequestId: inv.id, orderId: oid },
        });
      }

      // Create adjustment record
      await tx.invoiceAdjustment.create({
        data: {
          kind: "REISSUE",
          reason: (reason as string)?.trim() || null,
          originalInvoiceId: id,
          newInvoiceId: inv.id,
          createdById: session.user.id,
        },
      });

      return inv;
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "该发票已冲红或已重开，不能重开" }, { status: 409 });
    }
    throw err;
  }

  const full = await prisma.externalOrderInvoiceRequest.findUnique({
    where: { id: newInvoice.id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { id: true, name: true } },
      orderCoverage: { include: { order: { select: { id: true, orderNo: true } } } },
    },
  });

  return NextResponse.json({ invoice: full }, { status: 201 });
}
