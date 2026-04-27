import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { buildInvoicePrefillFromOrder } from "@/lib/external-order";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.externalOrder.findUnique({
    where: { id },
    select: {
      receiverName: true, productNamesJson: true, productNamesRaw: true,
      itemCount: true, paidAmount: true, merchantRemark: true,
      formNote: true, scheduledDeliveryText: true, receiverAddress: true,
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const draft = buildInvoicePrefillFromOrder(order);
  return NextResponse.json({ draft });
}
