import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: orderId, linkId } = await params;
  const body = await req.json();
  const { treatment, allocatedAmount, isPrimary, note } = body as Record<string, unknown>;

  const existing = await prisma.orderProjectLink.findUnique({ where: { id: linkId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.orderId !== orderId) return NextResponse.json({ error: "Forbidden: link does not belong to this order" }, { status: 403 });

  const data: Record<string, unknown> = {};
  if (treatment !== undefined) data.treatment = treatment;
  if (allocatedAmount !== undefined) data.allocatedAmount = allocatedAmount === null ? null : Number(allocatedAmount);
  if (isPrimary !== undefined) data.isPrimary = isPrimary;
  if (note !== undefined) data.note = (note as string)?.trim() || null;

  const updated = await prisma.orderProjectLink.update({
    where: { id: linkId },
    data,
    include: { project: { select: { id: true, name: true, status: true } } },
  });

  return NextResponse.json({ link: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: orderId, linkId } = await params;
  const existing = await prisma.orderProjectLink.findUnique({ where: { id: linkId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.orderId !== orderId) return NextResponse.json({ error: "Forbidden: link does not belong to this order" }, { status: 403 });

  await prisma.orderProjectLink.delete({ where: { id: linkId } });
  return NextResponse.json({ deleted: true });
}
