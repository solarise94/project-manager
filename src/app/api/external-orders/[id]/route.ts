import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { VALID_DUPLICATE_TRANSITIONS } from "@/lib/external-order";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.externalOrder.findUnique({
    where: { id },
    include: {
      invoiceRequests: {
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      reviewedBy: { select: { id: true, name: true } },
      mergedInto: { select: { id: true, externalOrderNo: true, source: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let duplicateGroup: Array<{
    id: string; externalOrderNo: string; source: string; platform: string | null;
    receiverName: string | null; receiverPhone: string | null;
    paidAmount: number | null; orderAt: Date | null;
    productNamesRaw: string | null; duplicateStatus: string;
  }> = [];
  if (order.duplicateGroupId) {
    duplicateGroup = await prisma.externalOrder.findMany({
      where: { duplicateGroupId: order.duplicateGroupId, id: { not: order.id } },
      select: {
        id: true, externalOrderNo: true, source: true, platform: true,
        receiverName: true, receiverPhone: true,
        paidAmount: true, orderAt: true,
        productNamesRaw: true, duplicateStatus: true,
      },
    });
  }

  return NextResponse.json({ order, duplicateGroup });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { duplicateStatus, reviewNote } = body;

  const order = await prisma.externalOrder.findUnique({ where: { id }, select: { id: true, duplicateStatus: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (duplicateStatus) {
    const allowed = VALID_DUPLICATE_TRANSITIONS[order.duplicateStatus] || [];
    if (!allowed.includes(duplicateStatus)) {
      return NextResponse.json({
        error: `不允许从 ${order.duplicateStatus} 变更到 ${duplicateStatus}`,
      }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {
    reviewedAt: new Date(),
    reviewedById: session.user.id,
  };
  if (duplicateStatus) data.duplicateStatus = duplicateStatus;
  if (reviewNote !== undefined) data.reviewNote = reviewNote;

  // Clear group when marking unique or ignored
  if (duplicateStatus === "UNIQUE" || duplicateStatus === "IGNORED") {
    data.duplicateGroupId = null;
  }

  const updated = await prisma.externalOrder.update({
    where: { id },
    data,
    include: {
      invoiceRequests: {
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      reviewedBy: { select: { id: true, name: true } },
      mergedInto: { select: { id: true, externalOrderNo: true, source: true } },
    },
  });

  return NextResponse.json({ order: updated });
}
