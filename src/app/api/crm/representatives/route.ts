import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { isRegionalManagerRole } from "@/lib/crm/permissions";
import { REFLOW_THRESHOLD_DAYS } from "@/lib/crm/constants";

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

  // Compute stats for each rep
  const thresholdDate = new Date(Date.now() - REFLOW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

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

  let representatives = await Promise.all(
    reps.map(async (rep) => {
      const linkedUser = emailToUser.get(rep.email);
      const userId = linkedUser?.id;

      const base = {
        representativeId: rep.id,
        name: rep.name,
        email: rep.email,
        archived: rep.archived,
        userId: userId || null,
        userName: linkedUser?.name || null,
        customerCount: 0,
        visitCheckinCount: 0,
        lastCheckinAt: null as string | null,
        overdueFollowUps: 0,
        longUnvisitedCount: 0,
        regions: rep.regionAssignments.map((a) => ({ id: a.region.id, name: a.region.name, isPrimary: a.isPrimary })),
        periodVisitCheckinCount: 0,
        periodNewCustomerCount: 0,
        periodReservedOrderCount: 0,
      };

      if (!userId) return base;

      const statQueries: Promise<number | { createdAt: Date } | null>[] = [
        prisma.crmCustomerProfile.count({ where: { ownerUserId: userId, archived: false } }),
        prisma.crmVisitCheckin.count({
          where: { userId, status: "COMPLETED", createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        }),
        prisma.crmVisitCheckin.findFirst({
          where: { userId, status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        prisma.crmFollowUpTask.count({
          where: { ownerUserId: userId, status: "OPEN", dueAt: { lt: now } },
        }),
        prisma.crmCustomerProfile.count({
          where: {
            ownerUserId: userId,
            archived: false,
            assignmentStatus: "ASSIGNED",
            visitCheckins: { none: { status: "COMPLETED", createdAt: { gte: thresholdDate } } },
            interactions: { none: { type: "VISIT", happenedAt: { gte: thresholdDate } } },
          },
        }),
      ];

      // Period stats
      if (periodStart && periodEnd) {
        statQueries.push(
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
              representativeId: rep.id,
              orderedAt: { gte: periodStart, lt: periodEnd },
              customerMatchStatus: { not: "UNMATCHED" },
            },
          }),
        );
      }

      const results = await Promise.all(statQueries);
      const customerCount = results[0] as number;
      const visitCheckinCount = results[1] as number;
      const lastCheckin = results[2] as { createdAt: Date } | null;
      const overdueFollowUps = results[3] as number;
      const longUnvisitedCount = results[4] as number;

      const out = {
        ...base,
        customerCount,
        visitCheckinCount,
        lastCheckinAt: lastCheckin?.createdAt?.toISOString() ?? null,
        overdueFollowUps,
        longUnvisitedCount,
      };

      if (periodStart && periodEnd) {
        out.periodVisitCheckinCount = results[5] as number;
        out.periodNewCustomerCount = results[6] as number;
        out.periodReservedOrderCount = results[7] as number;
      }

      return out;
    })
  );

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
      case "overdueFollowUps": cmp = a.overdueFollowUps - b.overdueFollowUps; break;
      case "longUnvisitedCount": cmp = a.longUnvisitedCount - b.longUnvisitedCount; break;
      default: cmp = a.name.localeCompare(b.name);
    }
    return cmp * sortOrder;
  });

  return NextResponse.json({ representatives });
}
