import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCrmProfileScopeWhere, isRepresentativeRole, isRegionalManagerRole, extractScopedUserIds } from "@/lib/crm/permissions";
import { CRM_EFFECTIVE_INTERACTION_TYPES } from "@/lib/crm/constants";

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
  const visibleProfileWhere = { ...roleWhere, archived: false };
  const assignedVisibleProfileWhere = { ...visibleProfileWhere, assignmentStatus: "ASSIGNED" };
  const validOrderWhere = {
    deleted: false,
    archived: false,
    status: { in: ["CONFIRMED", "CLOSED"] },
  };
  const warningDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [
    totalProfiles,
    myProfiles,
    pendingFollowUps,
    overdueFollowUps,
    thisWeekCheckins,
    stageGroups,
    recentInteractions,
    orderedCustomerCount,
    dormantCustomerCount,
    dormantWarningCustomerCount,
    assignedCustomerCount,
    communicatedInteractions,
    repeatedOrderGroups,
  ] = await Promise.all([
    prisma.crmCustomerProfile.count({ where: visibleProfileWhere }),
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
      where: visibleProfileWhere,
      _count: true,
    }),
    prisma.crmInteraction.findMany({
      where: interactionProfileFilter,
      include: { createdByUser: { select: { id: true, name: true } } },
      orderBy: { happenedAt: "desc" },
      take: 10,
    }),
    prisma.crmCustomerProfile.count({
      where: {
        ...visibleProfileWhere,
        sourceCustomer: { orders: { some: validOrderWhere } },
      },
    }),
    prisma.crmCustomerProfile.count({
      where: { ...visibleProfileWhere, stage: "DORMANT" },
    }),
    prisma.crmCustomerProfile.count({
      where: {
        ...visibleProfileWhere,
        assignmentStatus: "ASSIGNED",
        stage: { in: ["NEW", "CONTACTED", "FOLLOWING"] },
        sourceCustomer: { orders: { none: validOrderWhere } },
        OR: [
          { lastFollowUpAt: { lt: warningDate } },
          { AND: [{ lastFollowUpAt: null }, { assignedAt: { lt: warningDate } }] },
          { AND: [{ lastFollowUpAt: null }, { assignedAt: null }, { createdAt: { lt: warningDate } }] },
        ],
      },
    }),
    prisma.crmCustomerProfile.count({ where: assignedVisibleProfileWhere }),
    prisma.crmInteraction.findMany({
      where: {
        profile: assignedVisibleProfileWhere,
        type: { in: CRM_EFFECTIVE_INTERACTION_TYPES as unknown as string[] },
        happenedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), lt: now },
      },
      select: { profileId: true },
      distinct: ["profileId"],
    }),
    prisma.order.groupBy({
      by: ["customerId"],
      where: {
        ...validOrderWhere,
        customerId: { not: null },
      },
      _count: true,
    }),
  ]);

  const repeatedCustomerIds = repeatedOrderGroups
    .filter((group) => group.customerId && group._count >= 2)
    .map((group) => group.customerId as string);
  const repeatCustomerCount = repeatedCustomerIds.length > 0
    ? await prisma.crmCustomerProfile.count({
        where: {
          ...visibleProfileWhere,
          sourceCustomerId: { in: repeatedCustomerIds },
        },
      })
    : 0;
  const communicatedCustomerCount = communicatedInteractions.length;
  const communicationCoverageRate30d = assignedCustomerCount > 0
    ? communicatedCustomerCount / assignedCustomerCount
    : 0;

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
      communicatedCustomerCount30d: communicatedCustomerCount,
      communicationCoverageRate30d,
      stageDistribution: stageGroups.map((g) => ({ stage: g.stage, _count: g._count })),
      recentInteractions,
    },
  });
}
