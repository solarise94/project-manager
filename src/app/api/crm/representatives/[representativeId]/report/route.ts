import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRegionalManagerRole } from "@/lib/crm/permissions";
import { deriveGraduationStatus } from "@/lib/crm/profile-filters";
import { resolveEffectiveCustomerRepresentatives } from "@/lib/crm/customer-effective-representative";

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

/** Shared permission checker for read access */
async function assertReportReadable(session: { user: { id: string; role: string } }, representativeId: string) {
  const rep = await prisma.representative.findUnique({ where: { id: representativeId } });
  if (!rep) return { ok: false, status: 404, error: "Representative not found" } as const;

  if (session.user.role === "REPRESENTATIVE") {
    const linkedUser = await prisma.user.findFirst({
      where: { email: rep.email, id: session.user.id },
    });
    if (!linkedUser) return { ok: false, status: 403, error: "Forbidden" } as const;
  } else if (isRegionalManagerRole(session.user.role)) {
    const manager = await prisma.crmRegionManager.findUnique({
      where: { userId: session.user.id, archived: false },
      include: { reps: { where: { representativeId }, select: { id: true } } },
    });
    if (!manager || manager.reps.length === 0) {
      return { ok: false, status: 403, error: "Forbidden" } as const;
    }
  } else if (session.user.role !== "ADMIN") {
    return { ok: false, status: 403, error: "Forbidden" } as const;
  }
  return { ok: true, rep } as const;
}

/** Get linked userId for a representative */
async function getLinkedUserId(repEmail: string) {
  const user = await prisma.user.findFirst({ where: { email: repEmail }, select: { id: true } });
  return user?.id ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ representativeId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { representativeId } = await params;
  const perm = await assertReportReadable(session, representativeId);
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });
  const rep = perm.rep;

  const { start: periodStart, end: periodEnd } = getWeekWindow();
  const periodKey = fmtDate(periodStart);

  const userId = await getLinkedUserId(rep.email);

  if (!userId) {
    return NextResponse.json({
      representative: { id: rep.id, name: rep.name, email: rep.email },
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      summary: { visitCheckinCount: 0, newCustomerCount: 0, reservedOrderCount: 0, reservedOrderAmount: 0, communicatedCustomerCount: 0 },
      customers: [],
      lines: [],
      draftNote: null,
    });
  }

  // Resolve effective representatives for all non-archived profiles
  const allProfiles = await prisma.crmCustomerProfile.findMany({
    where: { archived: false },
    select: { id: true, sourceCustomerId: true, createdAt: true, assignedAt: true },
  });
  const profileCustomerIds = [...new Set(allProfiles.map((p) => p.sourceCustomerId))];
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(profileCustomerIds);

  // Collect effective customers belonging to this rep
  const effectiveCustomerIds: string[] = [];
  const effectiveProfileMap = new Map<string, { createdAt: Date; assignedAt: Date | null }>();
  for (const profile of allProfiles) {
    const effective = effectiveMap.get(profile.sourceCustomerId);
    if (effective?.ownerUserId === userId) {
      effectiveCustomerIds.push(profile.sourceCustomerId);
      effectiveProfileMap.set(profile.sourceCustomerId, { createdAt: profile.createdAt, assignedAt: profile.assignedAt });
    }
  }

  // Summary stats
  const [visitCheckinCount, reservedOrders] = await Promise.all([
    prisma.crmVisitCheckin.count({
      where: { userId, status: "COMPLETED", createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    effectiveCustomerIds.length > 0
      ? prisma.order.findMany({
          where: {
            customerId: { in: effectiveCustomerIds },
            OR: [
              { orderedAt: { gte: periodStart, lt: periodEnd } },
              { orderedAt: null, confirmedAt: { gte: periodStart, lt: periodEnd } },
              { orderedAt: null, confirmedAt: null, createdAt: { gte: periodStart, lt: periodEnd } },
            ],
            deleted: false,
          },
          select: { customerId: true, totalAmount: true, financeAmountOverride: true },
        })
      : Promise.resolve([]),
  ]);

  // New customers this week: based on effective anchorAt
  const newCustomerIds: string[] = [];
  for (const customerId of effectiveCustomerIds) {
    const effective = effectiveMap.get(customerId);
    const anchorAt = effective?.anchorAt;
    if (anchorAt && anchorAt >= periodStart && anchorAt < periodEnd) {
      newCustomerIds.push(customerId);
    }
  }
  const newCustomerCount = newCustomerIds.length;

  const reservedOrderCount = reservedOrders.length;
  const reservedOrderAmount = reservedOrders.reduce(
    (sum, order) => sum + (order.financeAmountOverride ?? order.totalAmount ?? 0),
    0,
  );

  // Customer list: visited this week + new this week + ordered this week
  const visitedCustomerIds = (
    await prisma.crmVisitCheckin.findMany({
      where: { userId, status: "COMPLETED", createdAt: { gte: periodStart, lt: periodEnd } },
      select: { profile: { select: { sourceCustomerId: true } } },
      distinct: ["profileId"],
    })
  ).map((v) => v.profile?.sourceCustomerId).filter(Boolean) as string[];

  const orderCustomerIds = reservedOrders
    .map((order) => order.customerId)
    .filter(Boolean) as string[];

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

  // Draft with lines
  const draft = await prisma.crmRepresentativeReportDraft.findUnique({
    where: {
      representativeId_periodType_periodKey: {
        representativeId,
        periodType: "WEEK",
        periodKey,
      },
    },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });

  // Check which line customers still exist
  const lineCustomerIds = draft?.lines.map((l) => l.customerId) ?? [];
  const existingCustomers = lineCustomerIds.length > 0
    ? await prisma.customer.findMany({
        where: { id: { in: lineCustomerIds } },
        select: { id: true },
      })
    : [];
  const existingCustomerIds = new Set(existingCustomers.map((c) => c.id));

  // Supplement detail queries for line customers not in this week's active list
  const extraCustomerIds = lineCustomerIds.filter((id) => !allCustomerIds.includes(id));
  if (extraCustomerIds.length > 0) {
    const extraProfiles = await prisma.crmCustomerProfile.findMany({
      where: { sourceCustomerId: { in: extraCustomerIds } },
      include: {
        sourceCustomer: {
          select: { id: true, name: true, customerCode: true, organization: true },
        },
      },
    });
    for (const p of extraProfiles) {
      profileMap.set(p.sourceCustomerId, p);
    }

    const extraVisitCounts = await Promise.all(
      extraCustomerIds.map(async (cid) => {
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
    );
    for (const v of extraVisitCounts) {
      visitCountMap.set(v.customerId, v.count);
    }

    const extraLastVisits = await Promise.all(
      extraCustomerIds.map(async (cid) => {
        const v = await prisma.crmVisitCheckin.findFirst({
          where: { userId, status: "COMPLETED", profile: { sourceCustomerId: cid } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        return { customerId: cid, lastVisitAt: v?.createdAt?.toISOString() ?? null };
      })
    );
    for (const v of extraLastVisits) {
      lastVisitMap.set(v.customerId, v.lastVisitAt);
    }
  }

  const lines = (draft?.lines ?? []).map((l) => {
    const profile = profileMap.get(l.customerId);
    const sc = profile?.sourceCustomer;
    return {
      id: l.id,
      customerId: l.customerId,
      customerName: l.customerName,
      customerCode: sc?.customerCode || "",
      organization: l.organization,
      demand: l.demand,
      note: l.note,
      sortOrder: l.sortOrder,
      customerExists: existingCustomerIds.has(l.customerId),
      stage: profile?.stage || "",
      importance: profile?.importance || "",
      weeklyVisitCount: visitCountMap.get(l.customerId) || 0,
      lastVisitAt: lastVisitMap.get(l.customerId) || null,
      hasOrderThisWeek: orderCustomerIds.includes(l.customerId),
    };
  });

  return NextResponse.json({
    representative: { id: rep.id, name: rep.name, email: rep.email },
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    summary: { visitCheckinCount, newCustomerCount, reservedOrderCount, reservedOrderAmount, communicatedCustomerCount: communicatedCount },
    customers,
    lines,
    draftNote: draft?.note ?? null,
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

  // Write permission: only the rep themselves
  if (session.user.role !== "REPRESENTATIVE") {
    return NextResponse.json({ error: "Forbidden: only representative can edit their own report" }, { status: 403 });
  }
  const linkedUser = await prisma.user.findFirst({
    where: { email: rep.email, id: session.user.id },
  });
  if (!linkedUser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { periodType, periodKey, note, lines: rawLines } = body;

  if (!periodType || !periodKey) {
    return NextResponse.json({ error: "periodType and periodKey are required" }, { status: 400 });
  }

  // Validate lines if provided
  let normalizedLines: Array<{
    customerId: string;
    customerName: string;
    organization: string | null;
    demand: string;
    note: string;
  }> | undefined;

  if (rawLines !== undefined) {
    if (!Array.isArray(rawLines)) {
      return NextResponse.json({ error: "lines must be an array" }, { status: 400 });
    }
    if (rawLines.length > 50) {
      return NextResponse.json({ error: "lines exceeds maximum of 50" }, { status: 400 });
    }

    const MAX_LEN = 2000;
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];
      if (!l || typeof l !== "object") {
        return NextResponse.json({ error: `lines[${i}] is not an object` }, { status: 400 });
      }
      if (!l.customerId || typeof l.customerId !== "string") {
        return NextResponse.json({ error: `lines[${i}].customerId is required` }, { status: 400 });
      }
      if (typeof l.customerName !== "string" || l.customerName.length > MAX_LEN) {
        return NextResponse.json({ error: `lines[${i}].customerName too long` }, { status: 400 });
      }
      if (l.organization && typeof l.organization !== "string") {
        return NextResponse.json({ error: `lines[${i}].organization must be a string` }, { status: 400 });
      }
      if (typeof l.demand !== "string" || l.demand.length > MAX_LEN) {
        return NextResponse.json({ error: `lines[${i}].demand too long` }, { status: 400 });
      }
      if (typeof l.note !== "string" || l.note.length > MAX_LEN) {
        return NextResponse.json({ error: `lines[${i}].note too long` }, { status: 400 });
      }
    }

    normalizedLines = rawLines.map((l: Record<string, unknown>) => ({
      customerId: String(l.customerId),
      customerName: String(l.customerName || "").slice(0, MAX_LEN),
      organization: l.organization ? String(l.organization).slice(0, MAX_LEN) : null,
      demand: String(l.demand || "").slice(0, MAX_LEN),
      note: String(l.note || "").slice(0, MAX_LEN),
    }));

    // Ownership validation: each customerId must belong to this rep via effective representative
    const lineCustomerIds = normalizedLines.map((l) => l.customerId);
    if (lineCustomerIds.length > 0) {
      const effectiveMap = await resolveEffectiveCustomerRepresentatives(lineCustomerIds);
      for (let i = 0; i < lineCustomerIds.length; i++) {
        const effective = effectiveMap.get(lineCustomerIds[i]);
        if (effective?.ownerUserId !== linkedUser.id) {
          return NextResponse.json(
            { error: `lines[${i}].customerId does not belong to you` },
            { status: 403 }
          );
        }
      }
    }
  }

  // Transactional save
  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.crmRepresentativeReportDraft.upsert({
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
        note: note !== undefined ? (note?.trim() || "") : "",
        createdByUserId: session.user.id,
      },
      update: {
        ...(note !== undefined ? { note: note?.trim() || "" } : {}),
        updatedByUserId: session.user.id,
      },
    });

    if (normalizedLines !== undefined) {
      await tx.crmRepresentativeReportLine.deleteMany({
        where: { reportDraftId: draft.id },
      });
      if (normalizedLines.length > 0) {
        await tx.crmRepresentativeReportLine.createMany({
          data: normalizedLines.map((l, i) => ({
            reportDraftId: draft.id,
            customerId: l.customerId,
            customerName: l.customerName,
            organization: l.organization,
            demand: l.demand,
            note: l.note,
            sortOrder: i,
          })),
        });
      }
    }

    const updatedLines = await tx.crmRepresentativeReportLine.findMany({
      where: { reportDraftId: draft.id },
      orderBy: { sortOrder: "asc" },
    });

    return {
      draftNote: draft.note,
      lines: updatedLines.map((l) => ({
        id: l.id,
        customerId: l.customerId,
        customerName: l.customerName,
        organization: l.organization,
        demand: l.demand,
        note: l.note,
        sortOrder: l.sortOrder,
      })),
    };
  });

  return NextResponse.json(result);
}

// POST alias retained for backward compatibility (browser unload sendBeacon)
export { PATCH as POST };
