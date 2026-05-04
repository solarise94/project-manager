import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
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
  const { financeCategory, financeTreatment, financeAmountOverride, financeNote, projectId, customerId } = body;

  const VALID_CATEGORIES = ["UNKNOWN", "PRODUCT", "SERVICE"];
  const VALID_TREATMENTS = ["AUTO", "STANDALONE", "PROJECT_INCLUDED", "EXCLUDED"];

  if (financeCategory !== undefined && !VALID_CATEGORIES.includes(financeCategory)) {
    return NextResponse.json({ error: `Invalid financeCategory: ${financeCategory}` }, { status: 400 });
  }
  if (financeTreatment !== undefined && !VALID_TREATMENTS.includes(financeTreatment)) {
    return NextResponse.json({ error: `Invalid financeTreatment: ${financeTreatment}` }, { status: 400 });
  }
  if (financeAmountOverride !== undefined && financeAmountOverride !== null) {
    if (typeof financeAmountOverride !== "number" || isNaN(financeAmountOverride) || financeAmountOverride < 0) {
      return NextResponse.json({ error: "financeAmountOverride must be a non-negative number or null" }, { status: 400 });
    }
  }

  const existing = await prisma.externalOrder.findUnique({ where: { id: orderId } });
  if (!existing) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (financeCategory !== undefined) data.financeCategory = financeCategory;
  if (financeTreatment !== undefined) data.financeTreatment = financeTreatment;
  if (financeAmountOverride !== undefined) data.financeAmountOverride = financeAmountOverride === null ? null : financeAmountOverride;
  if (financeNote !== undefined) data.financeNote = financeNote || null;
  if (projectId !== undefined) data.projectId = projectId || null;
  if (customerId !== undefined) data.customerId = customerId || null;

  const updated = await prisma.externalOrder.update({
    where: { id: orderId },
    data,
    select: {
      id: true, externalOrderNo: true,
      financeCategory: true, financeTreatment: true,
      financeAmountOverride: true, financeNote: true,
      projectId: true, project: { select: { id: true, name: true } },
      customerId: true, customer: { select: { id: true, name: true, customerCode: true } },
      customerMatchStatus: true, customerMatchScore: true, customerMatchReason: true,
    },
  });

  return NextResponse.json(updated);
}
