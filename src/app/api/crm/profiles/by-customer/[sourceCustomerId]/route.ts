import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertCrmProfileAccessByCustomerId } from "@/lib/crm/permissions";
import { getCrmLifecycleSummaryByCustomerId } from "@/lib/crm/lifecycle";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sourceCustomerId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sourceCustomerId } = await params;

  try {
    await assertCrmProfileAccessByCustomerId(sourceCustomerId, session.user.id, session.user.role);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const profile = await prisma.crmCustomerProfile.findUnique({
    where: { sourceCustomerId },
    include: {
      sourceCustomer: {
        select: {
          id: true, name: true, customerCode: true, principal: true,
          email: true, wechat: true, organization: true, address: true,
          miniProgramId: true, archived: true,
        },
      },
      ownerUser: { select: { id: true, name: true } },
      addresses: { orderBy: { createdAt: "desc" } },
      interactions: {
        orderBy: { happenedAt: "desc" },
        take: 10,
        include: { createdByUser: { select: { id: true, name: true } } },
      },
      followUpTasks: {
        where: { status: "OPEN" },
        orderBy: { dueAt: "asc" },
        include: {
          ownerUser: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, name: true } },
        },
      },
      visitCheckins: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { media: true, user: { select: { id: true, name: true } } },
      },
      _count: { select: { interactions: true, followUpTasks: true, visitCheckins: true, addresses: true } },
    },
  });

  const lifecycle = await getCrmLifecycleSummaryByCustomerId(sourceCustomerId);

  return NextResponse.json({
    profile,
    lifecycle: lifecycle ? {
      ...lifecycle,
      lastActiveOrderAt: lifecycle.lastActiveOrderAt?.toISOString() ?? null,
      lastHistoricalOrderAt: lifecycle.lastHistoricalOrderAt?.toISOString() ?? null,
      lastOrderAt: lifecycle.lastOrderAt?.toISOString() ?? null,
      lastEffectiveInteractionAt: lifecycle.lastEffectiveInteractionAt?.toISOString() ?? null,
      nextCommunicationTaskAt: lifecycle.nextCommunicationTaskAt?.toISOString() ?? null,
    } : null,
  });
}
