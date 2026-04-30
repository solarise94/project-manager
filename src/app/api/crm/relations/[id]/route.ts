import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentativeRole, isRegionalManagerRole } from "@/lib/crm/permissions";

const customerSelect = { id: true, name: true, customerCode: true, organization: true };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const relation = await prisma.customerRelation.findUnique({ where: { id } });
  if (!relation) return NextResponse.json({ error: "Relation not found" }, { status: 404 });

  if (isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.role === "USER" && relation.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.strength !== undefined) data.strength = body.strength || null;
  if (body.notes !== undefined) data.notes = body.notes || null;
  if (body.introducedAt !== undefined) {
    data.introducedAt = body.introducedAt ? new Date(body.introducedAt) : null;
  }

  const updated = await prisma.customerRelation.update({
    where: { id },
    data,
    include: {
      fromCustomer: { select: customerSelect },
      toCustomer: { select: customerSelect },
      createdByUser: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ relation: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const relation = await prisma.customerRelation.findUnique({ where: { id } });
  if (!relation) return NextResponse.json({ error: "Relation not found" }, { status: 404 });

  if (isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.role === "USER" && relation.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.customerRelation.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
