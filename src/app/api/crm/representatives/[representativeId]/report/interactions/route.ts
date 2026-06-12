import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveEffectiveCustomerRepresentative } from "@/lib/crm/customer-effective-representative";
import { canReadRepresentativeReport } from "@/lib/crm/representative-report-access";

/** Compute week boundaries: Monday 00:00:00 to next Monday 00:00:00 */
function getWeekWindow() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(start.getDate() + diff);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ representativeId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { representativeId } = await params;
  const rep = await prisma.representative.findUnique({ where: { id: representativeId } });
  if (!rep) return NextResponse.json({ error: "Representative not found" }, { status: 404 });

  const readable = await canReadRepresentativeReport(
    session.user.id,
    session.user.role,
    representativeId,
  );
  if (!readable) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  if (!customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }

  // Find linked user for ownership check
  const linkedUser = await prisma.user.findFirst({
    where: { email: rep.email },
    select: { id: true },
  });

  if (!linkedUser) {
    return NextResponse.json({ interactions: [] });
  }

  // Ownership check: customer must belong to this rep via effective representative
  const effective = await resolveEffectiveCustomerRepresentative(customerId);

  if (effective.ownerUserId !== linkedUser.id) {
    return NextResponse.json({ error: "Forbidden: customer does not belong to this representative" }, { status: 403 });
  }

  const { start: periodStart, end: periodEnd } = getWeekWindow();

  const interactions = await prisma.crmInteraction.findMany({
    where: {
      profile: { sourceCustomerId: customerId },
      happenedAt: { gte: periodStart, lt: periodEnd },
    },
    orderBy: { happenedAt: "desc" },
    take: 5,
    select: {
      summaryTitle: true,
      summary: true,
      summaryNote: true,
      happenedAt: true,
    },
  });

  return NextResponse.json({
    interactions: interactions.map((ix) => ({
      summaryTitle: ix.summaryTitle,
      summary: ix.summary,
      summaryNote: ix.summaryNote,
      happenedAt: ix.happenedAt.toISOString(),
    })),
  });
}
