import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { syncOrderInvoiceStatus } from "@/lib/external-order";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: sourceId } = await params;
  const body = await req.json();
  const { masterId } = body as { masterId?: string };

  if (!masterId) return NextResponse.json({ error: "masterId is required" }, { status: 400 });
  if (masterId === sourceId) return NextResponse.json({ error: "不能合并到自身" }, { status: 400 });

  const [source, master] = await Promise.all([
    prisma.externalOrder.findUnique({ where: { id: sourceId }, select: { id: true, duplicateStatus: true, mergedIntoId: true } }),
    prisma.externalOrder.findUnique({ where: { id: masterId }, select: { id: true, duplicateStatus: true, mergedIntoId: true } }),
  ]);

  if (!source) return NextResponse.json({ error: "源订单不存在" }, { status: 404 });
  if (!master) return NextResponse.json({ error: "目标订单不存在" }, { status: 404 });
  if (source.mergedIntoId) return NextResponse.json({ error: "源订单已被合并" }, { status: 400 });
  if (master.mergedIntoId) return NextResponse.json({ error: "目标订单已被合并" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    // Move direct invoices from source to master
    await tx.externalOrderInvoiceRequest.updateMany({
      where: { externalOrderId: sourceId },
      data: { externalOrderId: masterId },
    });

    // Migrate coverage records: source → master, skip on unique conflict
    const sourceCoverage = await tx.externalOrderInvoiceCoverage.findMany({
      where: { externalOrderId: sourceId },
      select: { id: true, invoiceRequestId: true },
    });

    for (const cov of sourceCoverage) {
      // Delete source coverage first, then try to create at master
      // If master already has this invoice covered, skip (unique constraint)
      await tx.externalOrderInvoiceCoverage.delete({ where: { id: cov.id } });
      const existing = await tx.externalOrderInvoiceCoverage.findUnique({
        where: { invoiceRequestId_externalOrderId: { invoiceRequestId: cov.invoiceRequestId, externalOrderId: masterId } },
        select: { id: true },
      });
      if (!existing) {
        await tx.externalOrderInvoiceCoverage.create({
          data: { invoiceRequestId: cov.invoiceRequestId, externalOrderId: masterId },
        });
      }
    }

    // Mark source as merged
    await tx.externalOrder.update({
      where: { id: sourceId },
      data: {
        duplicateStatus: "MERGED",
        mergedIntoId: masterId,
        duplicateGroupId: null,
        reviewedAt: new Date(),
        reviewedById: session.user.id,
      },
    });

    // If master was UNREVIEWED, mark it as DUPLICATE (confirmed as target of a merge)
    if (master.duplicateStatus === "UNREVIEWED") {
      await tx.externalOrder.update({
        where: { id: masterId },
        data: {
          duplicateStatus: "DUPLICATE",
          reviewedAt: new Date(),
          reviewedById: session.user.id,
        },
      });
    }

    // Sync status on both sides
    await syncOrderInvoiceStatus(tx as typeof prisma, masterId);
    await syncOrderInvoiceStatus(tx as typeof prisma, sourceId);
  });

  return NextResponse.json({ merged: true, masterId, sourceId });
}
