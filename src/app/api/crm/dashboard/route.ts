import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentativeRole, isRegionalManagerRole, getRegionalManagerUserIds } from "@/lib/crm/permissions";
import { CRM_EFFECTIVE_INTERACTION_TYPES } from "@/lib/crm/constants";
import { resolveEffectiveCustomerRepresentatives } from "@/lib/crm/customer-effective-representative";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const isScoped = isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role);

  // Resolve effective representatives for all non-archived profiles
  const allProfiles = await prisma.crmCustomerProfile.findMany({
    where: { archived: false },
    select: {
      id: true,
      sourceCustomerId: true,
      ownerUserId: true,
      stage: true,
      assignmentStatus: true,
      lastFollowUpAt: true,
      assignedAt: true,
      createdAt: true,
    },
  });

  const allCustomerIds = [...new Set(allProfiles.map((p) => p.sourceCustomerId))];
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(allCustomerIds);

  // Determine visible customerIds for scoped roles
  let allowedOwnerIds: string[] | null = null;
  if (isScoped) {
    if (session.user.role === "REPRESENTATIVE") {
      allowedOwnerIds = [session.user.id];
    } else if (session.user.role === "REGIONAL_MANAGER") {
      const repUserIds = await getRegionalManagerUserIds(session.user.id);
      allowedOwnerIds = repUserIds && repUserIds.length > 0 ? [session.user.id, ...repUserIds] : [session.user.id];
    }
  }

  const visibleCustomerIds = new Set<string>();
  const visibleProfileIds = new Set<string>();
  const myCustomerIds = new Set<string>();
  const myProfileIds = new Set<string>();

  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    const effectiveOwnerId = effective?.ownerUserId;

    if (!isScoped || (effectiveOwnerId && allowedOwnerIds?.includes(effectiveOwnerId))) {
      visibleCustomerIds.add(profile.sourceCustomerId);
      visibleProfileIds.add(profile.id);
    }

    if (effectiveOwnerId === session.user.id) {
      myCustomerIds.add(profile.sourceCustomerId);
      myProfileIds.add(profile.id);
    }
  }

  const visibleCustomerIdArray = [...visibleCustomerIds];
  const visibleProfileIdArray = [...visibleProfileIds];

  const followUpOwnerFilter = isScoped
    ? { profileId: { in: visibleProfileIdArray } }
    : {};
  const checkinUserFilter = isScoped
    ? { profileId: { in: visibleProfileIdArray } }
    : {};
  const interactionProfileFilter = isScoped
    ? { profileId: { in: visibleProfileIdArray } }
    : {};
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
    visibleProfileIdArray.length,
    myProfileIds.size,
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
      where: { id: { in: visibleProfileIdArray } },
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
        id: { in: visibleProfileIdArray },
        sourceCustomer: { orders: { some: validOrderWhere } },
      },
    }),
    prisma.crmCustomerProfile.count({
      where: { id: { in: visibleProfileIdArray }, stage: "DORMANT" },
    }),
    prisma.crmCustomerProfile.count({
      where: {
        id: { in: visibleProfileIdArray },
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
    myProfileIds.size,
    prisma.crmInteraction.findMany({
      where: {
        profileId: { in: [...myProfileIds] },
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
        customerId: { in: visibleCustomerIdArray },
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
          id: { in: visibleProfileIdArray },
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
