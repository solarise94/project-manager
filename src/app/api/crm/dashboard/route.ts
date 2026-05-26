import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCrmProfileScopeWhere, isRepresentativeRole, isRegionalManagerRole, extractScopedUserIds } from "@/lib/crm/permissions";
import { getCrmLifecycleSummariesForCustomers } from "@/lib/crm/lifecycle";
import { getCrmCommunicationMetrics } from "@/lib/crm/communication-metrics";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roleWhere = await getCrmProfileScopeWhere(session.user.id, session.user.role);
  const isScoped = isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // For scoped roles, resolve the set of userIds visible to this user
  const scopedUserIds = isScoped ? extractScopedUserIds(roleWhere) : null;

  const followUpOwnerFilter = scopedUserIds ? { ownerUserId: { in: scopedUserIds } } : {};
  const checkinUserFilter = scopedUserIds ? { userId: { in: scopedUserIds } } : {};
  const interactionProfileFilter = scopedUserIds
    ? { profile: { ownerUserId: { in: scopedUserIds } } }
    : {};

  const [profiles, totalProfiles, myProfiles, pendingFollowUps, overdueFollowUps, thisWeekCheckins, stageGroups, recentInteractions] = await Promise.all([
    prisma.crmCustomerProfile.findMany({
      where: { ...roleWhere, archived: false },
      select: { id: true, sourceCustomerId: true },
    }),
    prisma.crmCustomerProfile.count({ where: { ...roleWhere, archived: false } }),
    prisma.crmCustomerProfile.count({ where: { ownerUserId: session.user.id, archived: false } }),
    prisma.crmFollowUpTask.count({
      where: { status: "OPEN", ...followUpOwnerFilter },
    }),
    prisma.crmFollowUpTask.count({
      where: { status: "OPEN", dueAt: { lt: now }, ...followUpOwnerFilter },
    }),
    prisma.crmVisitCheckin.count({
      where: { createdAt: { gte: weekAgo }, status: "COMPLETED", ...checkinUserFilter },
    }),
    prisma.crmCustomerProfile.groupBy({
      by: ["stage"],
      where: { ...roleWhere, archived: false },
      _count: true,
    }),
    prisma.crmInteraction.findMany({
      where: interactionProfileFilter,
      include: { createdByUser: { select: { id: true, name: true } } },
      orderBy: { happenedAt: "desc" },
      take: 10,
    }),
  ]);

  const lifecycleMap = await getCrmLifecycleSummariesForCustomers(profiles.map((profile) => profile.sourceCustomerId));
  const lifecycleValues = [...lifecycleMap.values()];
  const orderedCustomerCount = lifecycleValues.filter((item) => item.validOrderCount > 0).length;
  const repeatCustomerCount = lifecycleValues.filter((item) => item.isRepeatCustomer).length;
  const dormantCustomerCount = lifecycleValues.filter((item) => item.stage === "DORMANT").length;
  const dormantWarningCustomerCount = lifecycleValues.filter((item) => item.dormantRisk && item.stage !== "DORMANT").length;
  const communicationMetrics = await getCrmCommunicationMetrics({
    profileIds: profiles.map((profile) => profile.id),
    from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    to: now,
  });

  return NextResponse.json({
    stats: {
      totalProfiles,
      myProfiles,
      pendingFollowUps,
      overdueFollowUps,
      thisWeekCheckins,
      orderedCustomerCount,
      repeatCustomerCount,
      repeatCustomerRate: orderedCustomerCount > 0 ? repeatCustomerCount / orderedCustomerCount : 0,
      dormantCustomerCount,
      dormantWarningCustomerCount,
      communicatedCustomerCount30d: communicationMetrics.communicatedCustomerCount,
      communicationCoverageRate30d: communicationMetrics.communicationCoverageRate,
      stageDistribution: stageGroups.map((g) => ({ stage: g.stage, _count: g._count })),
      recentInteractions,
    },
  });
}
