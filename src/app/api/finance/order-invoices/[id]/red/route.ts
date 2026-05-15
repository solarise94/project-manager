import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const invoice = await prisma.externalOrderInvoiceRequest.findUnique({
    where: { id },
    include: {
      order: { select: { id: true, orderNo: true } },
      orderCoverage: { select: { orderId: true } },
    },
  });

  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status !== "ISSUED") {
    return NextResponse.json({ error: "只有已开票的发票才能冲红" }, { status: 400 });
  }

  const body = await req.json();
  const { reason } = body as Record<string, unknown>;
  if (!reason || !(reason as string).trim()) {
    return NextResponse.json({ error: "冲红原因不能为空" }, { status: 400 });
  }

  // Check if already has a red or reissue adjustment
  const existingAdjustment = await prisma.invoiceAdjustment.findFirst({
    where: { originalInvoiceId: id },
  });
  if (existingAdjustment?.kind === "RED") {
    return NextResponse.json({ error: "该发票已冲红，不能重复冲红" }, { status: 400 });
  }
  if (existingAdjustment?.kind === "REISSUE") {
    return NextResponse.json({ error: "该发票已重开，请先取消重开后再冲红" }, { status: 400 });
  }

  try {
    const adjustment = await prisma.invoiceAdjustment.create({
      data: {
        kind: "RED",
        reason: (reason as string).trim(),
        originalInvoiceId: id,
        createdById: session.user.id,
      },
    });

    return NextResponse.json({ adjustment }, { status: 201 });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "该发票已冲红或已重开" }, { status: 409 });
    }
    throw err;
  }
}
