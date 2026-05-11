import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRegionalManagerRole } from "@/lib/crm/permissions";
import { deriveGraduationStatus } from "@/lib/crm/profile-filters";

/** Compute week boundaries: Monday 00:00:00 to next Monday 00:00:00 */
function getWeekWindow() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(start.getDate() + diff);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

/** Format YYYY-MM-DD */
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ representativeId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { representativeId } = await params;
  const rep = await prisma.representative.findUnique({ where: { id: representativeId } });
  if (!rep) return NextResponse.json({ error: "Representative not found" }, { status: 404 });

  // Permission: ADMIN/USER/REGIONAL_MANAGER can view any; REPRESENTATIVE only self
  if (session.user.role === "REPRESENTATIVE") {
    const linkedUser = await prisma.user.findFirst({
      where: { email: rep.email, id: session.user.id },
    });
    if (!linkedUser) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (isRegionalManagerRole(session.user.role)) {
    const manager = await prisma.crmRegionManager.findUnique({
      where: { userId: session.user.id, archived: false },
      include: { reps: { where: { representativeId }, select: { id: true } } },
    });
    if (!manager || manager.reps.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { start: periodStart, end: periodEnd } = getWeekWindow();
  const periodKey = fmtDate(periodStart);

  // Find linked user
  const linkedUser = await prisma.user.findFirst({
    where: { email: rep.email },
    select: { id: true },
  });
  const userId = linkedUser?.id;

  if (!userId) {
    return NextResponse.json({
      representative: { id: rep.id, name: rep.name, email: rep.email },
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      summary: { visitCheckinCount: 0, newCustomerCount: 0, reservedOrderCount: 0, communicatedCustomerCount: 0 },
      customers: [],
      draftNote: null,
    });
  }

  // Summary stats
  const [visitCheckinCount, newCustomerCount, reservedOrderCount] = await Promise.all([
    prisma.crmVisitCheckin.count({
      where: { userId, status: "COMPLETED", createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.crmCustomerProfile.count({
      where: {
        ownerUserId: userId,
        archived: false,
        OR: [
          { assignedAt: { gte: periodStart, lt: periodEnd } },
          { AND: [{ assignedAt: null }, { createdAt: { gte: periodStart, lt: periodEnd } }] },
        ],
      },
    }),
    prisma.order.count({
      where: {
        representativeId,
        orderedAt: { gte: periodStart, lt: periodEnd },
        customerMatchStatus: { not: "UNMATCHED" },
      },
    }),
  ]);

  // Customer list: visited this week + new this week + ordered this week
  const visitedCustomerIds = (
    await prisma.crmVisitCheckin.findMany({
      where: { userId, status: "COMPLETED", createdAt: { gte: periodStart, lt: periodEnd } },
      select: { profile: { select: { sourceCustomerId: true } } },
      distinct: ["profileId"],
    })
  ).map((v) => v.profile?.sourceCustomerId).filter(Boolean) as string[];

  const newCustomerIds = (
    await prisma.crmCustomerProfile.findMany({
      where: {
        ownerUserId: userId,
        archived: false,
        OR: [
          { assignedAt: { gte: periodStart, lt: periodEnd } },
          { AND: [{ assignedAt: null }, { createdAt: { gte: periodStart, lt: periodEnd } }] },
        ],
      },
      select: { sourceCustomerId: true },
    })
  ).map((p) => p.sourceCustomerId);

  const orderCustomerIds = (
    await prisma.order.findMany({
      where: {
        representativeId,
        orderedAt: { gte: periodStart, lt: periodEnd },
        customerMatchStatus: { not: "UNMATCHED" },
        customerId: { not: null },
      },
      select: { customerId: true },
      distinct: ["customerId"],
    })
  ).map((o) => o.customerId).filter(Boolean) as string[];

  const allCustomerIds = [...new Set([...visitedCustomerIds, ...newCustomerIds, ...orderCustomerIds])];

  // Fetch CRM profiles with full data
  const profiles = allCustomerIds.length > 0
    ? await prisma.crmCustomerProfile.findMany({
        where: { sourceCustomerId: { in: allCustomerIds } },
        include: {
          sourceCustomer: {
            select: { id: true, name: true, customerCode: true, organization: true },
          },
        },
      })
    : [];
  const profileMap = new Map(profiles.map((p) => [p.sourceCustomerId, p]));

  // Weekly visit counts per customer
  const visitCounts = allCustomerIds.length > 0
    ? await Promise.all(
        allCustomerIds.map(async (cid) => {
          const count = await prisma.crmVisitCheckin.count({
            where: {
              userId,
              status: "COMPLETED",
              createdAt: { gte: periodStart, lt: periodEnd },
              profile: { sourceCustomerId: cid },
            },
          });
          return { customerId: cid, count };
        })
      )
    : [];
  const visitCountMap = new Map(visitCounts.map((v) => [v.customerId, v.count]));

  // Latest visit per customer
  const lastVisits = allCustomerIds.length > 0
    ? await Promise.all(
        allCustomerIds.map(async (cid) => {
          const v = await prisma.crmVisitCheckin.findFirst({
            where: { userId, status: "COMPLETED", profile: { sourceCustomerId: cid } },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          return { customerId: cid, lastVisitAt: v?.createdAt?.toISOString() ?? null };
        })
      )
    : [];
  const lastVisitMap = new Map(lastVisits.map((v) => [v.customerId, v.lastVisitAt]));

  // Latest interaction per customer (for demand summary)
  const latestInteractions = allCustomerIds.length > 0
    ? await Promise.all(
        allCustomerIds.map(async (cid) => {
          const profile = profileMap.get(cid);
          if (!profile) return { customerId: cid, interaction: null };
          const ix = await prisma.crmInteraction.findFirst({
            where: { profileId: profile.id },
            orderBy: { happenedAt: "desc" },
            select: { summaryTitle: true, summary: true, summaryNote: true, happenedAt: true },
          });
          return { customerId: cid, interaction: ix };
        })
      )
    : [];
  const interactionMap = new Map(latestInteractions.map((v) => [v.customerId, v.interaction]));

  // Next follow-up per customer
  const nextFollowUps = allCustomerIds.length > 0
    ? await Promise.all(
        allCustomerIds.map(async (cid) => {
          const profile = profileMap.get(cid);
          if (!profile) return { customerId: cid, nextAt: null };
          const task = await prisma.crmFollowUpTask.findFirst({
            where: { profileId: profile.id, status: "OPEN" },
            orderBy: { dueAt: "asc" },
            select: { dueAt: true },
          });
          return { customerId: cid, nextAt: task?.dueAt?.toISOString() ?? null };
        })
      )
    : [];
  const nextFollowUpMap = new Map(nextFollowUps.map((v) => [v.customerId, v.nextAt]));

  // Communicated customer count (has any interaction this week)
  const communicatedCount = allCustomerIds.length > 0
    ? (await Promise.all(
        allCustomerIds.map(async (cid) => {
          const profile = profileMap.get(cid);
          if (!profile) return false;
          const count = await prisma.crmInteraction.count({
            where: {
              profileId: profile.id,
              happenedAt: { gte: periodStart, lt: periodEnd },
            },
          });
          return count > 0;
        })
      )).filter(Boolean).length
    : 0;

  // Build customer rows
  const customers = allCustomerIds.map((cid) => {
    const profile = profileMap.get(cid);
    const sc = profile?.sourceCustomer;
    const ix = interactionMap.get(cid) || null;
    const demandSummary =
      ix?.summaryTitle?.trim() ||
      ix?.summary?.trim() ||
      ix?.summaryNote?.trim() ||
      profile?.summary?.trim() ||
      null;

    return {
      customerId: cid,
      customerName: sc?.name || "未知",
      customerCode: sc?.customerCode || "",
      organization: sc?.organization || null,
      stage: profile?.stage || "",
      importance: profile?.importance || "",
      personCategory: profile?.personCategory || null,
      jobTitle: profile?.jobTitle || null,
      graduationStatus: deriveGraduationStatus(profile?.personCategory || null, profile?.graduationDate ?? null),
      weeklyVisitCount: visitCountMap.get(cid) || 0,
      lastVisitAt: lastVisitMap.get(cid) || null,
      latestDemand: demandSummary || null,
      latestInteractionAt: ix?.happenedAt?.toISOString() ?? null,
      nextFollowUpAt: nextFollowUpMap.get(cid) || null,
      hasOrderThisWeek: orderCustomerIds.includes(cid),
    };
  });

  // Draft note
  const draft = await prisma.crmRepresentativeReportDraft.findUnique({
    where: {
      representativeId_periodType_periodKey: {
        representativeId,
        periodType: "WEEK",
        periodKey,
      },
    },
    select: { note: true },
  });

  return NextResponse.json({
    representative: { id: rep.id, name: rep.name, email: rep.email },
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    summary: { visitCheckinCount, newCustomerCount, reservedOrderCount, communicatedCustomerCount: communicatedCount },
    customers,
    draftNote: draft?.note || null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ representativeId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { representativeId } = await params;
  const rep = await prisma.representative.findUnique({ where: { id: representativeId } });
  if (!rep) return NextResponse.json({ error: "Representative not found" }, { status: 404 });

  // Only the rep themselves (or ADMIN) can save draft
  if (session.user.role === "REPRESENTATIVE") {
    const linkedUser = await prisma.user.findFirst({
      where: { email: rep.email, id: session.user.id },
    });
    if (!linkedUser) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { periodType, periodKey, note } = body;

  if (!periodType || !periodKey) {
    return NextResponse.json({ error: "periodType and periodKey are required" }, { status: 400 });
  }

  const draft = await prisma.crmRepresentativeReportDraft.upsert({
    where: {
      representativeId_periodType_periodKey: {
        representativeId,
        periodType,
        periodKey,
      },
    },
    create: {
      representativeId,
      periodType,
      periodKey,
      note: note?.trim() || "",
      createdByUserId: session.user.id,
    },
    update: {
      note: note?.trim() || "",
      updatedByUserId: session.user.id,
    },
  });

  return NextResponse.json({ draft });
}

// POST alias for sendBeacon (browser unload only supports POST)
export { PATCH as POST };

