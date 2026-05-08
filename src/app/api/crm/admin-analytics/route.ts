import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  const lastCheckins = await prisma.crmVisitCheckin.groupBy({
    by: ["userId"],
    where: { userId: { in: ownerUserIds }, status: "COMPLETED" },
    _max: { createdAt: true },
  });
  const lastCheckinMap = new Map(lastCheckins.map((g) => [g.userId, g._max.createdAt]));

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
    select: { id: true, ownerUserId: true },
  });
  const ownerProfileIds = new Map<string, string[]>();
  for (const p of profilesByOwner) {
    const ids = ownerProfileIds.get(p.ownerUserId) || [];
    ids.push(p.id);
    ownerProfileIds.set(p.ownerUserId, ids);
  }
  const allProfileIds = profilesByOwner.map((p) => p.id);

  const interactionCounts30d = await prisma.crmInteraction.groupBy({
    by: ["profileId"],
    where: { profileId: { in: allProfileIds }, happenedAt: { gte: d30 }, type: { not: "VISIT" } },
    _count: true,
  });
  const interactionCountMap = new Map(interactionCounts30d.map((g) => [g.profileId, g._count]));

  // Assemble per‑representative rows
  const representativeMetrics = reps.map((rep) => {
    const userId = emailToUserId.get(rep.email) || null;
    const profileCount = userId ? (profileCountMap.get(userId) || 0) : 0;
    const checkin30d = userId ? (checkin30dMap.get(userId) || 0) : 0;
    const lastCheckin = userId ? (lastCheckinMap.get(userId) || null) : null;
    const overdue = userId ? (overdueMap.get(userId) || 0) : 0;

    const profileIds = userId ? (ownerProfileIds.get(userId) || []) : [];
    let interactions30d = 0;
    for (const pid of profileIds) {
      interactions30d += interactionCountMap.get(pid) || 0;
    }

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

  return NextResponse.json({
    global: {
      interactionCount7d,
      interactionCount30d,
      checkinCount7d,
      checkinCount30d,
    },
    representatives: representativeMetrics,
  });
}
