import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { ids } = body as { ids: string[] };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }

  let deleted = 0;
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const id of ids) {
    const order = await prisma.externalOrder.findUnique({
      where: { id },
      select: {
        id: true,
        invoiceRequests: { select: { id: true }, take: 1 },
      },
    });

    if (!order) {
      skipped.push({ id, reason: "订单不存在" });
      continue;
    }

    if (order.invoiceRequests.length > 0) {
      skipped.push({ id, reason: "存在开票申请，无法删除" });
      continue;
    }

    // Hard delete: invoice items cascade via ExternalOrderInvoiceRequest
    await prisma.externalOrder.delete({ where: { id } });
    deleted++;
  }

  return NextResponse.json({ deleted, skipped });
}
