import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { isRegionalManagerRole } from "@/lib/crm/permissions";
import { REFLOW_THRESHOLD_DAYS } from "@/lib/crm/constants";
import { getCrmCommunicationMetricsByOwnerUserIds } from "@/lib/crm/communication-metrics";
import { getCrmLifecycleSummariesForCustomers } from "@/lib/crm/lifecycle";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "REPRESENTATIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const representativeIdsParam = searchParams.get("representativeIds") || "";
  const regionId = searchParams.get("regionId") || "";
  const archived = searchParams.get("archived") || "active";
  const hasUserParam = searchParams.get("hasUser") || "";
  const hasOverdueParam = searchParams.get("hasOverdue") || "";
  const hasLongUnvisitedParam = searchParams.get("hasLongUnvisited") || "";
  const sort = searchParams.get("sort") || "name";
  const order = searchParams.get("order") || "asc";
  const period = searchParams.get("period") || ""; // "today" | "week" | ""

  // Determine which representatives to query
  let repEmailFilter: string[] | undefined;
  if (isRegionalManagerRole(session.user.role)) {
    const manager = await prisma.crmRegionManager.findUnique({
      where: { userId: session.user.id, archived: false },
      include: { reps: { select: { representative: { select: { email: true } } } } },
    });
    if (!manager || manager.reps.length === 0) {
      return NextResponse.json({ representatives: [] });
    }
    repEmailFilter = manager.reps.map((r) => r.representative.email);
  }

  // Build where clause
  const where: Prisma.RepresentativeWhereInput = {};
  if (repEmailFilter) where.email = { in: repEmailFilter };
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { email: { contains: search } },
    ];
  }

  // Filter by specific representative IDs
  if (representativeIdsParam) {
    const ids = representativeIdsParam.split(",").filter(Boolean);
    // Scope enforcement for REGIONAL_MANAGER
    if (isRegionalManagerRole(session.user.role) && repEmailFilter) {
      const allowedReps = await prisma.representative.findMany({
        where: { id: { in: ids }, email: { in: repEmailFilter } },
        select: { id: true },
      });
      where.id = { in: allowedReps.map((r) => r.id) };
    } else {
      where.id = { in: ids };
    }
  }

  // Archived filter
  if (archived === "active") where.archived = false;
  else if (archived === "archived") where.archived = true;

  // Region filter
  if (regionId) {
    where.regionAssignments = { some: { regionId } };
  }

  const reps = await prisma.representative.findMany({
    where,
    select: {
      id: true, name: true, email: true, archived: true,
      regionAssignments: {
        select: { id: true, isPrimary: true, region: { select: { id: true, name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  // For each rep, look up the linked User (by email matching with role REPRESENTATIVE)
  const repEmails = reps.map((r) => r.email);
  const repUsers = await prisma.user.findMany({
    where: { email: { in: repEmails } },
    select: { id: true, email: true, name: true, role: true },
  });
  const emailToUser = new Map(repUsers.map((u) => [u.email, u]));
  const ownerUserIds = repUsers.map((user) => user.id);

  // Compute stats for each rep
  const thresholdDate = new Date(Date.now() - REFLOW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Period window for today/week stats
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  if (period === "today" || period === "week") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (period === "week") {
      // Monday 00:00
      const day = start.getDay();
      const diff = day === 0 ? -6 : 1 - day; // Sunday → go back 6 days, else go back to Monday
      start.setDate(start.getDate() + diff);
    }
    periodStart = start;
    periodEnd = new Date(start);
    if (period === "today") {
      periodEnd.setDate(periodEnd.getDate() + 1);
    } else {
      periodEnd.setDate(periodEnd.getDate() + 7);
    }
  }

  const allProfiles = ownerUserIds.length > 0
    ? await prisma.crmCustomerProfile.findMany({
        where: { ownerUserId: { in: ownerUserIds }, archived: false },
        select: {
          id: true,
          ownerUserId: true,
          sourceCustomerId: true,
          assignmentStatus: true,
          assignedAt: true,
          createdAt: true,
        },
      })
    : [];

  const ownerAssignedProfileIds = new Map<string, string[]>();
  const ownerAssignedCustomerIds = new Map<string, string[]>();
  const ownerCustomerCountMap = new Map<string, number>();
  const ownerPeriodNewCustomerCountMap = new Map<string, number>();
  const customerOwnerMap = new Map<string, string>();

  for (const profile of allProfiles) {
    if (profile.assignmentStatus !== "ASSIGNED") continue;
    const profileIds = ownerAssignedProfileIds.get(profile.ownerUserId) || [];
    profileIds.push(profile.id);
    ownerAssignedProfileIds.set(profile.ownerUserId, profileIds);

    const customerIds = ownerAssignedCustomerIds.get(profile.ownerUserId) || [];
    customerIds.push(profile.sourceCustomerId);
    ownerAssignedCustomerIds.set(profile.ownerUserId, customerIds);
    ownerCustomerCountMap.set(profile.ownerUserId, (ownerCustomerCountMap.get(profile.ownerUserId) || 0) + 1);
    customerOwnerMap.set(profile.sourceCustomerId, profile.ownerUserId);

    if (periodStart && periodEnd) {
      const isNewInPeriod = (profile.assignedAt && profile.assignedAt >= periodStart && profile.assignedAt < periodEnd)
        || (!profile.assignedAt && profile.createdAt >= periodStart && profile.createdAt < periodEnd);
      if (isNewInPeriod) {
        ownerPeriodNewCustomerCountMap.set(
          profile.ownerUserId,
          (ownerPeriodNewCustomerCountMap.get(profile.ownerUserId) || 0) + 1,
        );
      }
    }
  }

  const allAssignedProfileIds = [...new Set(
    Array.from(ownerAssignedProfileIds.values()).flat(),
  )];
  const allAssignedCustomerIds = [...new Set(
    Array.from(ownerAssignedCustomerIds.values()).flat(),
  )];

  const [
    checkinCounts30d,
    lastCheckins,
    overdueCounts,
    interactionCounts30d,
    periodVisitCheckinCounts,
    periodInteractionCounts,
    periodOrders,
    completedCheckins,
    visitInteractions,
    communicationByOwner,
    lifecycleMap,
  ] = await Promise.all([
    ownerUserIds.length > 0
      ? prisma.crmVisitCheckin.groupBy({
          by: ["userId"],
          where: { userId: { in: ownerUserIds }, status: "COMPLETED", createdAt: { gte: d30 } },
          _count: true,
        })
      : Promise.resolve([]),
    ownerUserIds.length > 0
      ? prisma.crmVisitCheckin.findMany({
          where: { userId: { in: ownerUserIds }, status: "COMPLETED" },
          select: { userId: true, createdAt: true },
          orderBy: [{ userId: "asc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    ownerUserIds.length > 0
      ? prisma.crmFollowUpTask.groupBy({
          by: ["ownerUserId"],
          where: { ownerUserId: { in: ownerUserIds }, status: "OPEN", dueAt: { lt: now } },
          _count: true,
        })
      : Promise.resolve([]),
    allAssignedProfileIds.length > 0
      ? prisma.crmInteraction.groupBy({
          by: ["profileId"],
          where: { profileId: { in: allAssignedProfileIds }, happenedAt: { gte: d30 } },
          _count: true,
        })
      : Promise.resolve([]),
    periodStart && periodEnd && ownerUserIds.length > 0
      ? prisma.crmVisitCheckin.groupBy({
          by: ["userId"],
          where: { userId: { in: ownerUserIds }, status: "COMPLETED", createdAt: { gte: periodStart, lt: periodEnd } },
          _count: true,
        })
      : Promise.resolve([]),
    periodStart && periodEnd && allAssignedProfileIds.length > 0
      ? prisma.crmInteraction.groupBy({
          by: ["profileId"],
          where: { profileId: { in: allAssignedProfileIds }, happenedAt: { gte: periodStart, lt: periodEnd } },
          _count: true,
        })
      : Promise.resolve([]),
    periodStart && periodEnd && allAssignedCustomerIds.length > 0
      ? prisma.order.findMany({
          where: {
            customerId: { in: allAssignedCustomerIds },
            orderedAt: { gte: periodStart, lt: periodEnd },
            deleted: false,
            archived: false,
            status: { in: ["CONFIRMED", "CLOSED"] },
          },
          select: { customerId: true, totalAmount: true, financeAmountOverride: true },
        })
      : Promise.resolve([]),
    allAssignedProfileIds.length > 0
      ? prisma.crmVisitCheckin.findMany({
          where: { profileId: { in: allAssignedProfileIds }, status: "COMPLETED" },
          select: { profileId: true, createdAt: true },
          orderBy: [{ profileId: "asc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    allAssignedProfileIds.length > 0
      ? prisma.crmInteraction.findMany({
          where: { profileId: { in: allAssignedProfileIds }, type: "VISIT" },
          select: { profileId: true, happenedAt: true },
          orderBy: [{ profileId: "asc" }, { happenedAt: "desc" }],
        })
      : Promise.resolve([]),
    getCrmCommunicationMetricsByOwnerUserIds({
      ownerUserIds,
      from: d30,
      to: now,
    }),
    getCrmLifecycleSummariesForCustomers(allAssignedCustomerIds),
  ]);

  const checkin30dMap = new Map(checkinCounts30d.map((row) => [row.userId, row._count]));
  const lastCheckinMap = new Map<string, Date>();
  for (const checkin of lastCheckins) {
    if (!lastCheckinMap.has(checkin.userId)) {
      lastCheckinMap.set(checkin.userId, checkin.createdAt);
    }
  }
  const overdueMap = new Map(overdueCounts.map((row) => [row.ownerUserId, row._count]));
  const interaction30dMap = new Map(interactionCounts30d.map((row) => [row.profileId, row._count]));
  const periodVisitCheckinMap = new Map(periodVisitCheckinCounts.map((row) => [row.userId, row._count]));
  const periodInteractionMap = new Map(periodInteractionCounts.map((row) => [row.profileId, row._count]));

  const lastCheckinByProfile = new Map<string, Date>();
  for (const checkin of completedCheckins) {
    if (!lastCheckinByProfile.has(checkin.profileId)) {
      lastCheckinByProfile.set(checkin.profileId, checkin.createdAt);
    }
  }
  const lastVisitInteractionByProfile = new Map<string, Date>();
  for (const interaction of visitInteractions) {
    if (!lastVisitInteractionByProfile.has(interaction.profileId)) {
      lastVisitInteractionByProfile.set(interaction.profileId, interaction.happenedAt);
    }
  }

  const ownerLongUnvisitedCountMap = new Map<string, number>();
  const ownerInteractionCount30dMap = new Map<string, number>();
  const ownerPeriodInteractionCountMap = new Map<string, number>();
  for (const [ownerUserId, profileIds] of ownerAssignedProfileIds) {
    let longUnvisitedCount = 0;
    let interactionCount30d = 0;
    let periodInteractionCount = 0;
    for (const profileId of profileIds) {
      const lastActivity = lastCheckinByProfile.get(profileId) ?? lastVisitInteractionByProfile.get(profileId) ?? null;
      if (!lastActivity || lastActivity < thresholdDate) longUnvisitedCount += 1;
      interactionCount30d += interaction30dMap.get(profileId) || 0;
      periodInteractionCount += periodInteractionMap.get(profileId) || 0;
    }
    ownerLongUnvisitedCountMap.set(ownerUserId, longUnvisitedCount);
    ownerInteractionCount30dMap.set(ownerUserId, interactionCount30d);
    ownerPeriodInteractionCountMap.set(ownerUserId, periodInteractionCount);
  }

  const ownerPeriodOrderStatsMap = new Map<string, { count: number; amount: number }>();
  for (const order of periodOrders) {
    if (!order.customerId) continue;
    const ownerUserId = customerOwnerMap.get(order.customerId);
    if (!ownerUserId) continue;
    const current = ownerPeriodOrderStatsMap.get(ownerUserId) ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount += order.financeAmountOverride ?? order.totalAmount ?? 0;
    ownerPeriodOrderStatsMap.set(ownerUserId, current);
  }

  const ownerLifecycleStats = new Map<string, {
    orderedCustomerCount30d: number;
    repeatCustomerCount30d: number;
    activeCustomerCount: number;
    newCustomerCount30d: number;
    convertedCustomerCount30d: number;
    dormantCustomerCount: number;
    dormantWarningCustomerCount: number;
  }>();
  for (const summary of lifecycleMap.values()) {
    const current = ownerLifecycleStats.get(summary.ownerUserId) ?? {
      orderedCustomerCount30d: 0,
      repeatCustomerCount30d: 0,
      activeCustomerCount: 0,
      newCustomerCount30d: 0,
      convertedCustomerCount30d: 0,
      dormantCustomerCount: 0,
      dormantWarningCustomerCount: 0,
    };

    const anchorAt = summary.assignedAt ?? summary.createdAt;

    if (summary.stage === "ACTIVE") {
      current.activeCustomerCount += 1;
    }

    if (anchorAt >= d30) {
      current.newCustomerCount30d += 1;

      if (
        summary.firstOrderAt &&
        summary.firstOrderAt >= d30 &&
        summary.firstOrderAt >= anchorAt
      ) {
        current.convertedCustomerCount30d += 1;
      }
    }

    if (summary.validOrderCount > 0 && summary.lastOrderAt && summary.lastOrderAt >= d30) {
      current.orderedCustomerCount30d += 1;
    }
    if (summary.isRepeatCustomer && summary.lastOrderAt && summary.lastOrderAt >= d30) {
      current.repeatCustomerCount30d += 1;
    }
    if (summary.stage === "DORMANT") current.dormantCustomerCount += 1;
    if (summary.dormantRisk && summary.stage !== "DORMANT") current.dormantWarningCustomerCount += 1;
    ownerLifecycleStats.set(summary.ownerUserId, current);
  }

  let representatives = reps.map((rep) => {
    const linkedUser = emailToUser.get(rep.email);
    const userId = linkedUser?.id || null;
    const communication = userId ? communicationByOwner.get(userId) : null;
    const lifecycleStats = userId
      ? ownerLifecycleStats.get(userId) ?? {
          orderedCustomerCount30d: 0,
          repeatCustomerCount30d: 0,
          activeCustomerCount: 0,
          newCustomerCount30d: 0,
          convertedCustomerCount30d: 0,
          dormantCustomerCount: 0,
          dormantWarningCustomerCount: 0,
        }
      : {
          orderedCustomerCount30d: 0,
          repeatCustomerCount30d: 0,
          activeCustomerCount: 0,
          newCustomerCount30d: 0,
          convertedCustomerCount30d: 0,
          dormantCustomerCount: 0,
          dormantWarningCustomerCount: 0,
        };
    const periodOrderStats = userId
      ? ownerPeriodOrderStatsMap.get(userId) ?? { count: 0, amount: 0 }
      : { count: 0, amount: 0 };

    return {
      representativeId: rep.id,
      name: rep.name,
      email: rep.email,
      archived: rep.archived,
      userId,
      userName: linkedUser?.name || null,
      customerCount: userId ? (ownerCustomerCountMap.get(userId) || 0) : 0,
      visitCheckinCount: userId ? (checkin30dMap.get(userId) || 0) : 0,
      interactionCount30d: userId ? (ownerInteractionCount30dMap.get(userId) || 0) : 0,
      lastCheckinAt: userId ? (lastCheckinMap.get(userId)?.toISOString() ?? null) : null,
      overdueFollowUps: userId ? (overdueMap.get(userId) || 0) : 0,
      longUnvisitedCount: userId ? (ownerLongUnvisitedCountMap.get(userId) || 0) : 0,
      regions: rep.regionAssignments.map((a) => ({ id: a.region.id, name: a.region.name, isPrimary: a.isPrimary })),
      periodVisitCheckinCount: userId ? (periodVisitCheckinMap.get(userId) || 0) : 0,
      periodInteractionCount: userId ? (ownerPeriodInteractionCountMap.get(userId) || 0) : 0,
      periodNewCustomerCount: userId ? (ownerPeriodNewCustomerCountMap.get(userId) || 0) : 0,
      periodReservedOrderCount: periodOrderStats.count,
      periodReservedOrderAmount: periodOrderStats.amount,
      dueCommunicationTaskCount: communication?.dueCommunicationTaskCount ?? 0,
      doneCommunicationTaskCount: communication?.doneCommunicationTaskCount ?? 0,
      overdueCommunicationTaskCount: communication?.overdueCommunicationTaskCount ?? 0,
      communicatedCustomerCount30d: communication?.communicatedCustomerCount ?? 0,
      communicationCoverageRate30d: communication?.communicationCoverageRate ?? 0,
      activeCustomerCount: lifecycleStats.activeCustomerCount,
      newCustomerCount30d: lifecycleStats.newCustomerCount30d,
      convertedCustomerCount30d: lifecycleStats.convertedCustomerCount30d,
      conversionRate30d: lifecycleStats.newCustomerCount30d > 0
        ? lifecycleStats.convertedCustomerCount30d / lifecycleStats.newCustomerCount30d
        : 0,
      orderedCustomerCount30d: lifecycleStats.orderedCustomerCount30d,
      repeatCustomerCount30d: lifecycleStats.repeatCustomerCount30d,
      repeatCustomerRate30d: lifecycleStats.orderedCustomerCount30d > 0
        ? lifecycleStats.repeatCustomerCount30d / lifecycleStats.orderedCustomerCount30d
        : 0,
      dormantCustomerCount: lifecycleStats.dormantCustomerCount,
      dormantWarningCustomerCount: lifecycleStats.dormantWarningCustomerCount,
    };
  });

  // Post-filter: hasUser
  if (hasUserParam === "true") {
    representatives = representatives.filter((r) => r.userId !== null);
  } else if (hasUserParam === "false") {
    representatives = representatives.filter((r) => r.userId === null);
  }

  // Post-filter: hasOverdue
  if (hasOverdueParam === "true") {
    representatives = representatives.filter((r) => r.overdueFollowUps > 0);
  } else if (hasOverdueParam === "false") {
    representatives = representatives.filter((r) => r.overdueFollowUps === 0);
  }

  // Post-filter: hasLongUnvisited
  if (hasLongUnvisitedParam === "true") {
    representatives = representatives.filter((r) => r.longUnvisitedCount > 0);
  } else if (hasLongUnvisitedParam === "false") {
    representatives = representatives.filter((r) => r.longUnvisitedCount === 0);
  }

  // Sort
  const sortField = sort || "name";
  const sortOrder = order === "desc" ? -1 : 1;
  representatives.sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name": cmp = a.name.localeCompare(b.name); break;
      case "customerCount": cmp = a.customerCount - b.customerCount; break;
      case "visitCheckinCount": cmp = a.visitCheckinCount - b.visitCheckinCount; break;
      case "interactionCount30d":
        cmp = (a.interactionCount30d || 0) - (b.interactionCount30d || 0); break;
      case "overdueFollowUps": cmp = a.overdueFollowUps - b.overdueFollowUps; break;
      case "longUnvisitedCount": cmp = a.longUnvisitedCount - b.longUnvisitedCount; break;
      default: cmp = a.name.localeCompare(b.name);
    }
    return cmp * sortOrder;
  });

  return NextResponse.json({ representatives });
}
