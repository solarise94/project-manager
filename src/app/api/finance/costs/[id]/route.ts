import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidCostType, resolveAndValidateCostRefs } from "@/lib/finance/costs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.financeCost.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { amount, costType, customerId, orderId, projectId, occurredAt, remark } = body as Record<string, unknown>;

  if (amount !== undefined) {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: "金额必须为正数" }, { status: 400 });
    }
  }
  if (costType !== undefined && !isValidCostType(costType as string)) {
    return NextResponse.json({ error: `无效成本类型` }, { status: 400 });
  }

  // Validate entity refs if any are changing, and write back resolved values
  let resolvedCustomerId: string | null = existing.customerId;
  let resolvedProjectId: string | null = existing.projectId;

  if (customerId !== undefined || orderId !== undefined || projectId !== undefined) {
    const validation = await resolveAndValidateCostRefs({
      customerId: customerId !== undefined ? ((customerId as string) || null) : existing.customerId,
      orderId: orderId !== undefined ? ((orderId as string) || null) : existing.orderId,
      projectId: projectId !== undefined ? ((projectId as string) || null) : existing.projectId,
    });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    resolvedCustomerId = validation.resolvedCustomerId;
    resolvedProjectId = validation.resolvedProjectId;
  }

  const data: Record<string, unknown> = {};
  if (amount !== undefined) data.amount = Number(amount);
  if (costType !== undefined) data.costType = costType;
  if (customerId !== undefined || orderId !== undefined || projectId !== undefined) {
    data.customerId = resolvedCustomerId;
    data.projectId = resolvedProjectId ?? (projectId !== undefined ? ((projectId as string) || null) : existing.projectId);
  }
  if (orderId !== undefined) data.orderId = (orderId as string) || null;
  if (occurredAt !== undefined) data.occurredAt = new Date(occurredAt as string);
  if (remark !== undefined) data.remark = (remark as string)?.trim() || null;

  const updated = await prisma.financeCost.update({
    where: { id }, data,
    include: {
      customer: { select: { id: true, name: true } },
      order: { select: { id: true, orderNo: true } },
      project: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ cost: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.financeCost.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
