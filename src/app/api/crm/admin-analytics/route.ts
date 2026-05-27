import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCrmCommunicationMetricsByProfileIds } from "@/lib/crm/communication-metrics";
import { getCrmLifecycleSummariesForCustomers, getEffectiveCrmLifecycleStage } from "@/lib/crm/lifecycle";
import { resolveEffectiveCustomerRepresentatives } from "@/lib/crm/customer-effective-representative";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // ── Global aggregates ────────────────────────────────────────────
  const [
    interactionCount7d,
    interactionCount30d,
    checkinCount7d,
    checkinCount30d,
  ] = await Promise.all([
    prisma.crmInteraction.count({ where: { happenedAt: { gte: d7 }, type: { not: "VISIT" } } }),
    prisma.crmInteraction.count({ where: { happenedAt: { gte: d30 }, type: { not: "VISIT" } } }),
    prisma.crmVisitCheckin.count({ where: { createdAt: { gte: d7 }, status: "COMPLETED" } }),
    prisma.crmVisitCheckin.count({ where: { createdAt: { gte: d30 }, status: "COMPLETED" } }),
  ]);

  // ── Per‑representative metrics ───────────────────────────────────
  // Get all non‑archived representatives
  const reps = await prisma.representative.findMany({
    where: { archived: false },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  // Map rep email → User IDs for CRM scope lookup
  const repEmails = reps.map((r) => r.email);
  const repUsers = await prisma.user.findMany({
    where: { email: { in: repEmails }, role: { in: ["REPRESENTATIVE", "REGIONAL_MANAGER"] } },
    select: { id: true, email: true },
  });
  const emailToUserId = new Map(repUsers.map((u) => [u.email, u.id]));

  // ── Effective representative resolution ───────────────────────────
  // Query ALL non-archived CRM profiles and resolve effective owners
  const allProfiles = await prisma.crmCustomerProfile.findMany({
    where: { archived: false },
    select: {
      id: true,
      ownerUserId: true,
      sourceCustomerId: true,
      assignmentStatus: true,
    },
  });

  const allCustomerIds = [...new Set(allProfiles.map((p) => p.sourceCustomerId))];
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(allCustomerIds);

  // Group by effective ownerUserId
  const ownerEffectiveProfileIds = new Map<string, string[]>();
  const ownerEffectiveCustomerIds = new Map<string, string[]>();
  const ownerProfileCountMap = new Map<string, number>();
  const customerEffectiveOwnerMap = new Map<string, string>();

  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    if (!effective || !effective.ownerUserId) continue;

    const ownerUserId = effective.ownerUserId;
    customerEffectiveOwnerMap.set(profile.sourceCustomerId, ownerUserId);

    const profileIds = ownerEffectiveProfileIds.get(ownerUserId) || [];
    profileIds.push(profile.id);
    ownerEffectiveProfileIds.set(ownerUserId, profileIds);

    const customerIds = ownerEffectiveCustomerIds.get(ownerUserId) || [];
    customerIds.push(profile.sourceCustomerId);
    ownerEffectiveCustomerIds.set(ownerUserId, customerIds);

    ownerProfileCountMap.set(ownerUserId, (ownerProfileCountMap.get(ownerUserId) || 0) + 1);
  }

  const allEffectiveProfileIds = [...new Set(
    Array.from(ownerEffectiveProfileIds.values()).flat(),
  )];

  // Batch: checkin counts (30d) per user
  const ownerUserIds = [...ownerEffectiveCustomerIds.keys()];
  const checkinCounts30d = ownerUserIds.length > 0
    ? await prisma.crmVisitCheckin.groupBy({
        by: ["userId"],
        where: { userId: { in: ownerUserIds }, createdAt: { gte: d30 }, status: "COMPLETED" },
        _count: true,
      })
    : [];
  const checkin30dMap = new Map(checkinCounts30d.map((g) => [g.userId, g._count]));

  // Batch: last checkin per user
  const lastCheckins = ownerUserIds.length > 0
    ? await prisma.crmVisitCheckin.findMany({
        where: { userId: { in: ownerUserIds }, status: "COMPLETED" },
        select: { userId: true, createdAt: true },
        orderBy: [{ userId: "asc" }, { createdAt: "desc" }],
      })
    : [];
  const lastCheckinMap = new Map<string, Date>();
  for (const checkin of lastCheckins) {
    if (!lastCheckinMap.has(checkin.userId)) {
      lastCheckinMap.set(checkin.userId, checkin.createdAt);
    }
  }

  // Batch: overdue follow-ups per owner
  const overdueCounts = ownerUserIds.length > 0
    ? await prisma.crmFollowUpTask.groupBy({
        by: ["ownerUserId"],
        where: { ownerUserId: { in: ownerUserIds }, status: "OPEN", dueAt: { lt: now } },
        _count: true,
      })
    : [];
  const overdueMap = new Map(overdueCounts.map((g) => [g.ownerUserId, g._count]));

  // Batch: interaction counts (30d) per profile
  const interactionCounts30d = allEffectiveProfileIds.length > 0
    ? await prisma.crmInteraction.groupBy({
        by: ["profileId"],
        where: { profileId: { in: allEffectiveProfileIds }, happenedAt: { gte: d30 }, type: { not: "VISIT" } },
        _count: true,
      })
    : [];
  const interactionCountMap = new Map(interactionCounts30d.map((g) => [g.profileId, g._count]));

  // Re-group interaction counts by effective owner
  const ownerInteractionCountMap = new Map<string, number>();
  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    if (!effective || !effective.ownerUserId) continue;
    const ownerUserId = effective.ownerUserId;
    ownerInteractionCountMap.set(
      ownerUserId,
      (ownerInteractionCountMap.get(ownerUserId) || 0) + (interactionCountMap.get(profile.id) || 0),
    );
  }

  // Communication metrics by profile, then re-group by effective owner
  const communicationByProfile = allEffectiveProfileIds.length > 0
    ? await getCrmCommunicationMetricsByProfileIds({
        profileIds: allEffectiveProfileIds,
        from: d30,
        to: now,
      })
    : new Map<string, ReturnType<typeof getCrmCommunicationMetricsByProfileIds> extends Promise<infer T> ? T extends Map<string, infer V> ? V : never : never>();

  const ownerCommDueMap = new Map<string, number>();
  const ownerCommDoneMap = new Map<string, number>();
  const ownerCommOverdueMap = new Map<string, number>();
  const ownerCommCountMap = new Map<string, number>();

  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    if (!effective || !effective.ownerUserId) continue;
    const ownerUserId = effective.ownerUserId;
    const comm = communicationByProfile.get(profile.id);
    if (comm) {
      ownerCommDueMap.set(ownerUserId, (ownerCommDueMap.get(ownerUserId) || 0) + comm.dueCommunicationTaskCount);
      ownerCommDoneMap.set(ownerUserId, (ownerCommDoneMap.get(ownerUserId) || 0) + comm.doneCommunicationTaskCount);
      ownerCommOverdueMap.set(ownerUserId, (ownerCommOverdueMap.get(ownerUserId) || 0) + comm.overdueCommunicationTaskCount);
      ownerCommCountMap.set(ownerUserId, (ownerCommCountMap.get(ownerUserId) || 0) + comm.communicatedCustomerCount);
    }
  }

  // Lifecycle stats grouped by effective owner
  const lifecycleMap = await getCrmLifecycleSummariesForCustomers(allCustomerIds);
  const ownerLifecycleStats = new Map<string, {
    orderedCustomerCount30d: number;
    repeatCustomerCount30d: number;
    orderedCustomerCount90d: number;
    repeatCustomerCount90d: number;
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
      dormantCustomerCount: 0,
      dormantWarningCustomerCount: 0,
    };
    const lifecycleStage = getEffectiveCrmLifecycleStage(summary);
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

  // Assemble per‑representative rows
  const representativeMetrics = reps.map((rep) => {
    const userId = emailToUserId.get(rep.email) || null;
    const profileCount = userId ? (ownerProfileCountMap.get(userId) || 0) : 0;
    const checkin30d = userId ? (checkin30dMap.get(userId) || 0) : 0;
    const lastCheckin = userId ? (lastCheckinMap.get(userId) || null) : null;
    const overdue = userId ? (overdueMap.get(userId) || 0) : 0;
    const interactions30d = userId ? (ownerInteractionCountMap.get(userId) || 0) : 0;

    const visitDensity = profileCount > 0 ? checkin30d / profileCount : 0;
    const interactionDensity = profileCount > 0 ? interactions30d / profileCount : 0;

    return {
      representativeId: rep.id,
      name: rep.name,
      email: rep.email,
      hasUser: !!userId,
      profileCount,
      checkinCount30d: checkin30d,
      lastCheckinAt: lastCheckin?.toISOString() ?? null,
      overdueFollowUps: overdue,
      interactionCount30d: interactions30d,
      visitDensity: Math.round(visitDensity * 100) / 100,
      interactionDensity: Math.round(interactionDensity * 100) / 100,
    };
  });

  const enriched = representativeMetrics.map((rep) => {
    if (!rep.hasUser) {
      return {
        ...rep,
        dueCommunicationTaskCount: 0,
        doneCommunicationTaskCount: 0,
        overdueCommunicationTaskCount: 0,
        communicatedCustomerCount30d: 0,
        communicationCoverageRate30d: 0,
        orderedCustomerCount30d: 0,
        repeatCustomerCount30d: 0,
        repeatCustomerRate30d: 0,
        orderedCustomerCount90d: 0,
        repeatCustomerCount90d: 0,
        repeatCustomerRate90d: 0,
        dormantCustomerCount: 0,
        dormantWarningCustomerCount: 0,
      };
    }

    const ownerUserId = emailToUserId.get(rep.email);
    if (!ownerUserId) {
      return {
        ...rep,
        dueCommunicationTaskCount: 0,
        doneCommunicationTaskCount: 0,
        overdueCommunicationTaskCount: 0,
        communicatedCustomerCount30d: 0,
        communicationCoverageRate30d: 0,
        orderedCustomerCount30d: 0,
        repeatCustomerCount30d: 0,
        repeatCustomerRate30d: 0,
        orderedCustomerCount90d: 0,
        repeatCustomerCount90d: 0,
        repeatCustomerRate90d: 0,
        dormantCustomerCount: 0,
        dormantWarningCustomerCount: 0,
      };
    }

    const lifecycleStats = ownerLifecycleStats.get(ownerUserId) ?? {
      orderedCustomerCount30d: 0,
      repeatCustomerCount30d: 0,
      orderedCustomerCount90d: 0,
      repeatCustomerCount90d: 0,
      dormantCustomerCount: 0,
      dormantWarningCustomerCount: 0,
    };

    const commCount = ownerCommCountMap.get(ownerUserId) || 0;
    const commCoverageRate = rep.profileCount > 0 ? commCount / rep.profileCount : 0;

    return {
      ...rep,
      dueCommunicationTaskCount: ownerCommDueMap.get(ownerUserId) || 0,
      doneCommunicationTaskCount: ownerCommDoneMap.get(ownerUserId) || 0,
      overdueCommunicationTaskCount: ownerCommOverdueMap.get(ownerUserId) || 0,
      communicatedCustomerCount30d: commCount,
      communicationCoverageRate30d: commCoverageRate,
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

  return NextResponse.json({
    global: {
      interactionCount7d,
      interactionCount30d,
      checkinCount7d,
      checkinCount30d,
    },
    representatives: enriched,
  });
}
