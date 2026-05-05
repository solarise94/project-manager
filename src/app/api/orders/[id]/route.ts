import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOrderAccessBlocked, getOrderScopeWhere } from "@/lib/orders/permissions";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isOrderAccessBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, customerCode: true } },
      representative: { select: { id: true, name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      sourceRecords: { orderBy: { createdAt: "desc" } },
      projectLinks: {
        include: {
          project: { select: { id: true, name: true, status: true } },
        },
      },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 50 },
      mergeSources: {
        include: { sourceOrder: { select: { id: true, orderNo: true } } },
      },
      mergeTargets: {
        include: { targetOrder: { select: { id: true, orderNo: true } } },
      },
      _count: { select: { lines: true, sourceRecords: true, projectLinks: true, receipts: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Scope check for non-ADMIN
  if (session.user.role !== "ADMIN") {
    const scopeWhere = await getOrderScopeWhere(session.user.id, session.user.role);
    if (scopeWhere) {
      // Check if this order is inside the scope
      const inScope = await prisma.order.count({
        where: { id, AND: [scopeWhere] },
      });
      if (inScope === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  return NextResponse.json({ order });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const {
    title, description, category, status, deliveryStatus,
    orderedAt, confirmedAt, deliveredAt,
    customerId, customerMatchStatus, customerMatchScore, customerMatchReason,
    representativeId,
    financeAmountOverride, financeTreatment, financeNote,
    buyerNameSnapshot, buyerPhoneSnapshot, buyerWechatSnapshot, buyerOrgNameSnapshot, buyerAddressSnapshot,
  } = body as Record<string, unknown>;

  const data: Record<string, unknown> = {};

  if (title !== undefined) data.title = String(title).trim();
  if (description !== undefined) data.description = (description as string)?.trim() || null;
  if (category !== undefined) data.category = category;
  if (status !== undefined) data.status = status;
  if (deliveryStatus !== undefined) data.deliveryStatus = deliveryStatus;
  if (orderedAt !== undefined) data.orderedAt = orderedAt ? new Date(orderedAt as string) : null;
  if (confirmedAt !== undefined) data.confirmedAt = confirmedAt ? new Date(confirmedAt as string) : null;
  if (deliveredAt !== undefined) data.deliveredAt = deliveredAt ? new Date(deliveredAt as string) : null;
  if (customerId !== undefined) data.customerId = (customerId as string) || null;
  if (customerMatchStatus !== undefined) data.customerMatchStatus = customerMatchStatus;
  if (customerMatchScore !== undefined) data.customerMatchScore = customerMatchScore;
  if (customerMatchReason !== undefined) data.customerMatchReason = (customerMatchReason as string) || null;
  if (representativeId !== undefined) data.representativeId = (representativeId as string) || null;
  if (financeAmountOverride !== undefined) data.financeAmountOverride = financeAmountOverride === null ? null : Number(financeAmountOverride);
  if (financeTreatment !== undefined) data.financeTreatment = financeTreatment;
  if (financeNote !== undefined) data.financeNote = (financeNote as string)?.trim() || null;
  if (buyerNameSnapshot !== undefined) data.buyerNameSnapshot = (buyerNameSnapshot as string)?.trim() || null;
  if (buyerPhoneSnapshot !== undefined) data.buyerPhoneSnapshot = (buyerPhoneSnapshot as string)?.trim() || null;
  if (buyerWechatSnapshot !== undefined) data.buyerWechatSnapshot = (buyerWechatSnapshot as string)?.trim() || null;
  if (buyerOrgNameSnapshot !== undefined) data.buyerOrgNameSnapshot = (buyerOrgNameSnapshot as string)?.trim() || null;
  if (buyerAddressSnapshot !== undefined) data.buyerAddressSnapshot = (buyerAddressSnapshot as string)?.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Record status change
  if (status !== undefined && status !== existing.id) {
    await prisma.orderStatusHistory.create({
      data: {
        orderId: id,
        oldStatus: null, // keep simple for now
        newStatus: status as string,
        createdById: session.user.id,
      },
    });
  }

  const updated = await prisma.order.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, name: true, customerCode: true } },
      representative: { select: { id: true, name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      projectLinks: { include: { project: { select: { id: true, name: true, status: true } } } },
    },
  });

  return NextResponse.json({ order: updated });
}
