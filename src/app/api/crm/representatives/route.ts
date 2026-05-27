import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { isRegionalManagerRole } from "@/lib/crm/permissions";
import { REFLOW_THRESHOLD_DAYS } from "@/lib/crm/constants";
import { getCrmCommunicationMetricsByProfileIds } from "@/lib/crm/communication-metrics";
import { getCrmLifecycleSummariesForCustomers, getEffectiveCrmLifecycleStage } from "@/lib/crm/lifecycle";
import { resolveEffectiveCustomerRepresentatives } from "@/lib/crm/customer-effective-representative";

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

  // ── Effective representative resolution ───────────────────────────
  // Query ALL non-archived CRM profiles to compute effective ownership
  const allProfiles = await prisma.crmCustomerProfile.findMany({
    where: { archived: false },
    select: {
      id: true,
      ownerUserId: true,
      sourceCustomerId: true,
      assignmentStatus: true,
      assignedAt: true,
      createdAt: true,
    },
  });

  const allCustomerIds = [...new Set(allProfiles.map((p) => p.sourceCustomerId))];
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(allCustomerIds);
  // profile lookup not needed here — all metrics are resolved via effectiveMap

  // Build effective owner groups
  const ownerEffectiveCustomerIds = new Map<string, string[]>();
  const ownerEffectiveProfileIds = new Map<string, string[]>();
  const ownerCustomerCountMap = new Map<string, number>();
  const customerEffectiveOwnerMap = new Map<string, string>();

  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    if (!effective || !effective.ownerUserId) continue;

    const ownerUserId = effective.ownerUserId;
    customerEffectiveOwnerMap.set(profile.sourceCustomerId, ownerUserId);

    const customerIds = ownerEffectiveCustomerIds.get(ownerUserId) || [];
    customerIds.push(profile.sourceCustomerId);
    ownerEffectiveCustomerIds.set(ownerUserId, customerIds);

    const profileIds = ownerEffectiveProfileIds.get(ownerUserId) || [];
    profileIds.push(profile.id);
    ownerEffectiveProfileIds.set(ownerUserId, profileIds);

    ownerCustomerCountMap.set(ownerUserId, (ownerCustomerCountMap.get(ownerUserId) || 0) + 1);
  }

  // Period window for today/week stats
  const now = new Date();
  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const d90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const thresholdDate = new Date(Date.now() - REFLOW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

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

  // Collect all effective profile IDs for batch queries
  const allEffectiveProfileIds = [...new Set(
    Array.from(ownerEffectiveProfileIds.values()).flat(),
  )];

  // ── Batch queries ────────────────────────────────────────────────
  const allOwnerUserIds = [...ownerEffectiveCustomerIds.keys()];

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
    communicationByProfile,
    lifecycleMap,
  ] = await Promise.all([
    allOwnerUserIds.length > 0
      ? prisma.crmVisitCheckin.groupBy({
          by: ["userId"],
          where: { userId: { in: allOwnerUserIds }, status: "COMPLETED", createdAt: { gte: d30 } },
          _count: true,
        })
      : Promise.resolve([]),
    allOwnerUserIds.length > 0
      ? prisma.crmVisitCheckin.findMany({
          where: { userId: { in: allOwnerUserIds }, status: "COMPLETED" },
          select: { userId: true, createdAt: true },
          orderBy: [{ userId: "asc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    allOwnerUserIds.length > 0
      ? prisma.crmFollowUpTask.groupBy({
          by: ["ownerUserId"],
          where: { ownerUserId: { in: allOwnerUserIds }, status: "OPEN", dueAt: { lt: now } },
          _count: true,
        })
      : Promise.resolve([]),
    allEffectiveProfileIds.length > 0
      ? prisma.crmInteraction.groupBy({
          by: ["profileId"],
          where: { profileId: { in: allEffectiveProfileIds }, happenedAt: { gte: d30 } },
          _count: true,
        })
      : Promise.resolve([]),
    periodStart && periodEnd && allOwnerUserIds.length > 0
      ? prisma.crmVisitCheckin.groupBy({
          by: ["userId"],
          where: { userId: { in: allOwnerUserIds }, status: "COMPLETED", createdAt: { gte: periodStart, lt: periodEnd } },
          _count: true,
        })
      : Promise.resolve([]),
    periodStart && periodEnd && allEffectiveProfileIds.length > 0
      ? prisma.crmInteraction.groupBy({
          by: ["profileId"],
          where: { profileId: { in: allEffectiveProfileIds }, happenedAt: { gte: periodStart, lt: periodEnd } },
          _count: true,
        })
      : Promise.resolve([]),
    periodStart && periodEnd
      ? prisma.order.findMany({
          where: {
            customerId: { in: allCustomerIds },
            OR: [
              { orderedAt: { gte: periodStart, lt: periodEnd } },
              { orderedAt: null, confirmedAt: { gte: periodStart, lt: periodEnd } },
              { orderedAt: null, confirmedAt: null, createdAt: { gte: periodStart, lt: periodEnd } },
            ],
            deleted: false,
            archived: false,
            status: { in: ["CONFIRMED", "CLOSED"] },
          },
          select: { customerId: true, totalAmount: true, financeAmountOverride: true },
        })
      : Promise.resolve([]),
    allEffectiveProfileIds.length > 0
      ? prisma.crmVisitCheckin.findMany({
          where: { profileId: { in: allEffectiveProfileIds }, status: "COMPLETED" },
          select: { profileId: true, createdAt: true },
          orderBy: [{ profileId: "asc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    allEffectiveProfileIds.length > 0
      ? prisma.crmInteraction.findMany({
          where: { profileId: { in: allEffectiveProfileIds }, type: "VISIT" },
          select: { profileId: true, happenedAt: true },
          orderBy: [{ profileId: "asc" }, { happenedAt: "desc" }],
        })
      : Promise.resolve([]),
    getCrmCommunicationMetricsByProfileIds({
      profileIds: allEffectiveProfileIds,
      from: d30,
      to: now,
    }),
    getCrmLifecycleSummariesForCustomers(allCustomerIds),
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

  // Re-group profile-level metrics by effective owner
  const ownerInteractionCount30dMap = new Map<string, number>();
  const ownerPeriodInteractionCountMap = new Map<string, number>();
  const ownerLongUnvisitedCountMap = new Map<string, number>();
  const ownerDueCommMap = new Map<string, number>();
  const ownerDoneCommMap = new Map<string, number>();
  const ownerOverdueCommMap = new Map<string, number>();
  const ownerCommunicatedCountMap = new Map<string, number>();

  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    if (!effective || !effective.ownerUserId) continue;
    const ownerUserId = effective.ownerUserId;

    // Interaction counts (re-mapped by effective owner)
    ownerInteractionCount30dMap.set(
      ownerUserId,
      (ownerInteractionCount30dMap.get(ownerUserId) || 0) + (interaction30dMap.get(profile.id) || 0),
    );
    ownerPeriodInteractionCountMap.set(
      ownerUserId,
      (ownerPeriodInteractionCountMap.get(ownerUserId) || 0) + (periodInteractionMap.get(profile.id) || 0),
    );

    // Long unvisited
    const lastActivity = lastCheckinByProfile.get(profile.id) ?? lastVisitInteractionByProfile.get(profile.id) ?? null;
    if (!lastActivity || lastActivity < thresholdDate) {
      ownerLongUnvisitedCountMap.set(
        ownerUserId,
        (ownerLongUnvisitedCountMap.get(ownerUserId) || 0) + 1,
      );
    }

    // Communication metrics (re-mapped by effective owner)
    const comm = communicationByProfile.get(profile.id);
    if (comm) {
      ownerDueCommMap.set(ownerUserId, (ownerDueCommMap.get(ownerUserId) || 0) + comm.dueCommunicationTaskCount);
      ownerDoneCommMap.set(ownerUserId, (ownerDoneCommMap.get(ownerUserId) || 0) + comm.doneCommunicationTaskCount);
      ownerOverdueCommMap.set(ownerUserId, (ownerOverdueCommMap.get(ownerUserId) || 0) + comm.overdueCommunicationTaskCount);
      ownerCommunicatedCountMap.set(ownerUserId, (ownerCommunicatedCountMap.get(ownerUserId) || 0) + comm.communicatedCustomerCount);
    }
  }

  // Period orders grouped by effective owner
  const ownerPeriodOrderStatsMap = new Map<string, { count: number; amount: number }>();
  const ownerPeriodNewCustomerCountMap = new Map<string, number>();

  for (const order of periodOrders) {
    if (!order.customerId) continue;
    const ownerUserId = customerEffectiveOwnerMap.get(order.customerId);
    if (!ownerUserId) continue;
    const current = ownerPeriodOrderStatsMap.get(ownerUserId) ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount += order.financeAmountOverride ?? order.totalAmount ?? 0;
    ownerPeriodOrderStatsMap.set(ownerUserId, current);
  }

  // Period new customers (by effective anchor)
  if (periodStart && periodEnd) {
    for (const profile of allProfiles) {
      const effective = effectiveMap.get(profile.sourceCustomerId);
      if (!effective || !effective.ownerUserId) continue;
      const anchorAt = effective.anchorAt;
      if (!anchorAt) continue;
      if (anchorAt >= periodStart && anchorAt < periodEnd) {
        ownerPeriodNewCustomerCountMap.set(
          effective.ownerUserId,
          (ownerPeriodNewCustomerCountMap.get(effective.ownerUserId) || 0) + 1,
        );
      }
    }
  }

  // Lifecycle stats grouped by effective owner (using effective anchor)
  const ownerLifecycleStats = new Map<string, {
    orderedCustomerCount30d: number;
    repeatCustomerCount30d: number;
    orderedCustomerCount90d: number;
    repeatCustomerCount90d: number;
    activeCustomerCount: number;
    newCustomerCount30d: number;
    convertedCustomerCount30d: number;
    newCustomerCount90d: number;
    convertedCustomerCount90d: number;
    dormantCustomerCount: number;
    dormantWarningCustomerCount: number;
  }>();

  for (const summary of lifecycleMap.values()) {
    const effective = effectiveMap.get(summary.customerId);
    if (!effective || !effective.ownerUserId) continue;

    const current = ownerLifecycleStats.get(effective.ownerUserId) ?? {
      orderedCustomerCount30d: 0,
      repeatCustomerCount30d: 0,
      orderedCustomerCount90d: 0,
      repeatCustomerCount90d: 0,
      activeCustomerCount: 0,
      newCustomerCount30d: 0,
      convertedCustomerCount30d: 0,
      newCustomerCount90d: 0,
      convertedCustomerCount90d: 0,
      dormantCustomerCount: 0,
      dormantWarningCustomerCount: 0,
    };

    const anchorAt = effective.anchorAt;
    const lifecycleStage = getEffectiveCrmLifecycleStage(summary);

    if (lifecycleStage === "ACTIVE") {
      current.activeCustomerCount += 1;
    }

    if (anchorAt && anchorAt >= d30) {
      current.newCustomerCount30d += 1;
      if (
        summary.firstOrderAt &&
        summary.firstOrderAt >= d30 &&
        summary.firstOrderAt >= anchorAt
      ) {
        current.convertedCustomerCount30d += 1;
      }
    }

    if (anchorAt && anchorAt >= d90) {
      current.newCustomerCount90d += 1;
      if (
        summary.firstOrderAt &&
        summary.firstOrderAt >= d90 &&
        summary.firstOrderAt >= anchorAt
      ) {
        current.convertedCustomerCount90d += 1;
      }
    }

    if (summary.validOrderCount > 0 && summary.lastOrderAt && summary.lastOrderAt >= d30) {
      current.orderedCustomerCount30d += 1;
    }
    if (summary.isRepeatCustomer && summary.lastOrderAt && summary.lastOrderAt >= d30) {
      current.repeatCustomerCount30d += 1;
    }

    if (summary.validOrderCount > 0 && summary.lastOrderAt && summary.lastOrderAt >= d90) {
      current.orderedCustomerCount90d += 1;
    }
    if (summary.isRepeatCustomer && summary.lastOrderAt && summary.lastOrderAt >= d90) {
      current.repeatCustomerCount90d += 1;
    }

    if (lifecycleStage === "DORMANT") current.dormantCustomerCount += 1;
    if (summary.dormantRisk && lifecycleStage !== "DORMANT") current.dormantWarningCustomerCount += 1;
    ownerLifecycleStats.set(effective.ownerUserId, current);
  }

  // ── Assemble results ─────────────────────────────────────────────
  let representatives = reps.map((rep) => {
    const linkedUser = emailToUser.get(rep.email);
    const userId = linkedUser?.id || null;
    const lifecycleStats = userId
      ? ownerLifecycleStats.get(userId) ?? {
          orderedCustomerCount30d: 0,
          repeatCustomerCount30d: 0,
          orderedCustomerCount90d: 0,
          repeatCustomerCount90d: 0,
          activeCustomerCount: 0,
          newCustomerCount30d: 0,
          convertedCustomerCount30d: 0,
          newCustomerCount90d: 0,
          convertedCustomerCount90d: 0,
          dormantCustomerCount: 0,
          dormantWarningCustomerCount: 0,
        }
      : {
          orderedCustomerCount30d: 0,
          repeatCustomerCount30d: 0,
          orderedCustomerCount90d: 0,
          repeatCustomerCount90d: 0,
          activeCustomerCount: 0,
          newCustomerCount30d: 0,
          convertedCustomerCount30d: 0,
          newCustomerCount90d: 0,
          convertedCustomerCount90d: 0,
          dormantCustomerCount: 0,
          dormantWarningCustomerCount: 0,
        };
    const periodOrderStats = userId
      ? ownerPeriodOrderStatsMap.get(userId) ?? { count: 0, amount: 0 }
      : { count: 0, amount: 0 };

    const effectiveCustomerCount = userId ? (ownerCustomerCountMap.get(userId) || 0) : 0;

    // Communication coverage rate needs total effective customers as denominator
    const commCount = userId ? (ownerCommunicatedCountMap.get(userId) || 0) : 0;
    const commCoverageRate = effectiveCustomerCount > 0 ? commCount / effectiveCustomerCount : 0;

    return {
      representativeId: rep.id,
      name: rep.name,
      email: rep.email,
      archived: rep.archived,
      userId,
      userName: linkedUser?.name || null,
      customerCount: effectiveCustomerCount,
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
      dueCommunicationTaskCount: userId ? (ownerDueCommMap.get(userId) || 0) : 0,
      doneCommunicationTaskCount: userId ? (ownerDoneCommMap.get(userId) || 0) : 0,
      overdueCommunicationTaskCount: userId ? (ownerOverdueCommMap.get(userId) || 0) : 0,
      communicatedCustomerCount30d: commCount,
      communicationCoverageRate30d: commCoverageRate,
      activeCustomerCount: lifecycleStats.activeCustomerCount,
      newCustomerCount30d: lifecycleStats.newCustomerCount30d,
      convertedCustomerCount30d: lifecycleStats.convertedCustomerCount30d,
      conversionRate30d: lifecycleStats.newCustomerCount30d > 0
        ? lifecycleStats.convertedCustomerCount30d / lifecycleStats.newCustomerCount30d
        : 0,
      newCustomerCount90d: lifecycleStats.newCustomerCount90d,
      convertedCustomerCount90d: lifecycleStats.convertedCustomerCount90d,
      conversionRate90d: lifecycleStats.newCustomerCount90d > 0
        ? lifecycleStats.convertedCustomerCount90d / lifecycleStats.newCustomerCount90d
        : 0,
      orderedCustomerCount30d: lifecycleStats.orderedCustomerCount30d,
      repeatCustomerCount30d: lifecycleStats.repeatCustomerCount30d,
      repeatCustomerRate30d: lifecycleStats.orderedCustomerCount30d > 0
        ? lifecycleStats.repeatCustomerCount30d / lifecycleStats.orderedCustomerCount30d
        : 0,
      orderedCustomerCount90d: lifecycleStats.orderedCustomerCount90d,
      repeatCustomerCount90d: lifecycleStats.repeatCustomerCount90d,
      repeatCustomerRate90d: lifecycleStats.orderedCustomerCount90d > 0
        ? lifecycleStats.repeatCustomerCount90d / lifecycleStats.orderedCustomerCount90d
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
