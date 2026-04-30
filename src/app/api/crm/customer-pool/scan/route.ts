import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REFLOW_THRESHOLD_DAYS } from "@/lib/crm/constants";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const thresholdDays = body.thresholdDays || REFLOW_THRESHOLD_DAYS;
  const thresholdDate = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

  // Find ASSIGNED profiles where the newest COMPLETED checkin is older than threshold
  // AND the newest VISIT interaction is older than threshold (or neither exist)
  const profiles = await prisma.crmCustomerProfile.findMany({
    where: {
      archived: false,
      assignmentStatus: "ASSIGNED",
    },
    select: { id: true, ownerUserId: true },
  });

  const toMark: string[] = [];
  // Track per-owner count for aggregated notifications
  const ownerMarkedCount = new Map<string, number>();

  for (const p of profiles) {
    const [lastCheckin, lastVisitInteraction] = await Promise.all([
      prisma.crmVisitCheckin.findFirst({
        where: { profileId: p.id, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.crmInteraction.findFirst({
        where: { profileId: p.id, type: "VISIT" },
        orderBy: { happenedAt: "desc" },
        select: { happenedAt: true },
      }),
    ]);

    const lastActivity = lastCheckin?.createdAt ?? lastVisitInteraction?.happenedAt ?? null;
    if (!lastActivity || lastActivity < thresholdDate) {
      toMark.push(p.id);
      ownerMarkedCount.set(p.ownerUserId, (ownerMarkedCount.get(p.ownerUserId) || 0) + 1);
    }
  }

  if (toMark.length > 0) {
    const reason = `超过${thresholdDays}天未拜访`;
    await prisma.$transaction([
      prisma.crmCustomerProfile.updateMany({
        where: { id: { in: toMark } },
        data: { assignmentStatus: "RECALL_CANDIDATE" },
      }),
      prisma.crmCustomerAssignmentLog.createMany({
        data: toMark.map((profileId) => ({
          profileId,
          fromOwnerUserId: null,
          toOwnerUserId: null,
          action: "MARK_CANDIDATE",
          reason,
          createdByUserId: session.user.id,
        })),
      }),
    ]);

    // Aggregated notifications per owner
    for (const [ownerUserId, count] of ownerMarkedCount) {
      prisma.notification.create({
        data: {
          userId: ownerUserId,
          title: "客户流失预警",
          content: `有 ${count} 个客户超过 ${thresholdDays} 天未拜访，已进入待收回客户池`,
          type: "CRM_REFLOW_WARNING",
          link: "/crm/customer-pool?assignmentStatus=RECALL_CANDIDATE",
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ markedCount: toMark.length });
}
