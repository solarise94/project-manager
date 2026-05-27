import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCrmCommunicationMetricsByOwnerUserIds } from "@/lib/crm/communication-metrics";
import { getCrmLifecycleSummariesForCustomers, getEffectiveCrmLifecycleStage } from "@/lib/crm/lifecycle";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

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

  // Batch: profile counts per owner
  const ownerUserIds = [...emailToUserId.values()];
  const profileCounts = await prisma.crmCustomerProfile.groupBy({
    by: ["ownerUserId"],
    where: { ownerUserId: { in: ownerUserIds }, archived: false },
    _count: true,
  });
  const profileCountMap = new Map(profileCounts.map((g) => [g.ownerUserId, g._count]));

  // Batch: checkin counts (30d) per user
  const checkinCounts30d = await prisma.crmVisitCheckin.groupBy({
    by: ["userId"],
    where: { userId: { in: ownerUserIds }, createdAt: { gte: d30 }, status: "COMPLETED" },
    _count: true,
  });
  const checkin30dMap = new Map(checkinCounts30d.map((g) => [g.userId, g._count]));

  // Batch: last checkin per user
  const lastCheckins = await prisma.crmVisitCheckin.findMany({
    where: { userId: { in: ownerUserIds }, status: "COMPLETED" },
    select: { userId: true, createdAt: true },
    orderBy: [{ userId: "asc" }, { createdAt: "desc" }],
  });
  const lastCheckinMap = new Map<string, Date>();
  for (const checkin of lastCheckins) {
    if (!lastCheckinMap.has(checkin.userId)) {
      lastCheckinMap.set(checkin.userId, checkin.createdAt);
    }
  }

  // Batch: overdue follow-ups per owner
  const overdueCounts = await prisma.crmFollowUpTask.groupBy({
    by: ["ownerUserId"],
    where: { ownerUserId: { in: ownerUserIds }, status: "OPEN", dueAt: { lt: now } },
    _count: true,
  });
  const overdueMap = new Map(overdueCounts.map((g) => [g.ownerUserId, g._count]));

  // Batch: interaction counts (30d) per profile owner
  const profilesByOwner = await prisma.crmCustomerProfile.findMany({
    where: { ownerUserId: { in: ownerUserIds }, archived: false },
    select: { id: true, ownerUserId: true, sourceCustomerId: true, assignmentStatus: true },
  });
  const ownerProfileIds = new Map<string, string[]>();
  for (const p of profilesByOwner) {
    const ids = ownerProfileIds.get(p.ownerUserId) || [];
    ids.push(p.id);
    ownerProfileIds.set(p.ownerUserId, ids);
  }
  const allProfileIds = profilesByOwner.map((p) => p.id);
  const allAssignedCustomerIds = [...new Set(
    profilesByOwner
      .filter((profile) => profile.assignmentStatus === "ASSIGNED")
      .map((profile) => profile.sourceCustomerId),
  )];

  const [interactionCounts30d, communicationByOwner, lifecycleMap] = await Promise.all([
    allProfileIds.length > 0
      ? prisma.crmInteraction.groupBy({
          by: ["profileId"],
          where: { profileId: { in: allProfileIds }, happenedAt: { gte: d30 }, type: { not: "VISIT" } },
          _count: true,
        })
      : Promise.resolve([]),
    getCrmCommunicationMetricsByOwnerUserIds({
      ownerUserIds,
      from: d30,
      to: now,
    }),
    getCrmLifecycleSummariesForCustomers(allAssignedCustomerIds),
  ]);
  const interactionCountMap = new Map(interactionCounts30d.map((g) => [g.profileId, g._count]));
  const ownerInteractionCountMap = new Map<string, number>();
  for (const [ownerUserId, profileIds] of ownerProfileIds) {
    let total = 0;
    for (const profileId of profileIds) total += interactionCountMap.get(profileId) || 0;
    ownerInteractionCountMap.set(ownerUserId, total);
  }

  const ownerLifecycleStats = new Map<string, {
    orderedCustomerCount30d: number;
    repeatCustomerCount30d: number;
    dormantCustomerCount: number;
    dormantWarningCustomerCount: number;
  }>();
  for (const summary of lifecycleMap.values()) {
    const current = ownerLifecycleStats.get(summary.ownerUserId) ?? {
      orderedCustomerCount30d: 0,
      repeatCustomerCount30d: 0,
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
    if (lifecycleStage === "DORMANT") current.dormantCustomerCount += 1;
    if (summary.dormantRisk && lifecycleStage !== "DORMANT") current.dormantWarningCustomerCount += 1;
    ownerLifecycleStats.set(summary.ownerUserId, current);
  }

  // Assemble per‑representative rows
  const representativeMetrics = reps.map((rep) => {
    const userId = emailToUserId.get(rep.email) || null;
    const profileCount = userId ? (profileCountMap.get(userId) || 0) : 0;
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
        dormantCustomerCount: 0,
        dormantWarningCustomerCount: 0,
      };
    }

    const communication = communicationByOwner.get(ownerUserId);
    const lifecycleStats = ownerLifecycleStats.get(ownerUserId) ?? {
      orderedCustomerCount30d: 0,
      repeatCustomerCount30d: 0,
      dormantCustomerCount: 0,
      dormantWarningCustomerCount: 0,
    };

    return {
      ...rep,
      dueCommunicationTaskCount: communication?.dueCommunicationTaskCount ?? 0,
      doneCommunicationTaskCount: communication?.doneCommunicationTaskCount ?? 0,
      overdueCommunicationTaskCount: communication?.overdueCommunicationTaskCount ?? 0,
      communicatedCustomerCount30d: communication?.communicatedCustomerCount ?? 0,
      communicationCoverageRate30d: communication?.communicationCoverageRate ?? 0,
      orderedCustomerCount30d: lifecycleStats.orderedCustomerCount30d,
      repeatCustomerCount30d: lifecycleStats.repeatCustomerCount30d,
      repeatCustomerRate30d: lifecycleStats.orderedCustomerCount30d > 0
        ? lifecycleStats.repeatCustomerCount30d / lifecycleStats.orderedCustomerCount30d
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
