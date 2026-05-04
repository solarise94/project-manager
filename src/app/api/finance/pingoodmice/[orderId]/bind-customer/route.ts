import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orderId } = await params;
  const body = await req.json();
  const { customerId } = body;

  if (!customerId) {
    return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
  }

  const order = await prisma.externalOrder.findUnique({ where: { id: orderId } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const updated = await prisma.externalOrder.update({
    where: { id: orderId },
    data: {
      customerId,
      customerMatchStatus: "MANUAL_MATCHED",
      customerMatchScore: null,
      customerMatchReason: `manual_bind_by_${session.user.id}`,
    },
    select: {
      id: true,
      externalOrderNo: true,
      customerMatchStatus: true,
      customer: { select: { id: true, name: true, customerCode: true } },
    },
  });

  return NextResponse.json(updated);
}
