import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCrmWhereForRole } from "@/lib/crm/permissions";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roleWhere = buildCrmWhereForRole(session.user.id, session.user.role);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalProfiles, myProfiles, pendingFollowUps, overdueFollowUps, thisWeekCheckins, stageGroups, recentInteractions] = await Promise.all([
    prisma.crmCustomerProfile.count({ where: { ...roleWhere, archived: false } }),
    prisma.crmCustomerProfile.count({ where: { ownerUserId: session.user.id, archived: false } }),
    prisma.crmFollowUpTask.count({
      where: {
        status: "OPEN",
        ...(session.user.role === "REPRESENTATIVE" ? { ownerUserId: session.user.id } : {}),
      },
    }),
    prisma.crmFollowUpTask.count({
      where: {
        status: "OPEN",
        dueAt: { lt: now },
        ...(session.user.role === "REPRESENTATIVE" ? { ownerUserId: session.user.id } : {}),
      },
    }),
    prisma.crmVisitCheckin.count({
      where: {
        createdAt: { gte: weekAgo },
        status: "COMPLETED",
        ...(session.user.role === "REPRESENTATIVE" ? { userId: session.user.id } : {}),
      },
    }),
    prisma.crmCustomerProfile.groupBy({
      by: ["stage"],
      where: { ...roleWhere, archived: false },
      _count: true,
    }),
    prisma.crmInteraction.findMany({
      where: session.user.role === "REPRESENTATIVE"
        ? { profile: { ownerUserId: session.user.id } }
        : {},
      include: { createdByUser: { select: { id: true, name: true } } },
      orderBy: { happenedAt: "desc" },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    stats: {
      totalProfiles,
      myProfiles,
      pendingFollowUps,
      overdueFollowUps,
      thisWeekCheckins,
      stageDistribution: stageGroups.map((g) => ({ stage: g.stage, _count: g._count })),
      recentInteractions,
    },
  });
}
