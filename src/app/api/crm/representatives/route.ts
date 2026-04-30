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

  const where: Prisma.RepresentativeWhereInput = {};
  if (repEmailFilter) where.email = { in: repEmailFilter };
  if (search) where.name = { contains: search };

  const reps = await prisma.representative.findMany({
    where,
    select: { id: true, name: true, email: true, archived: true },
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

  const representatives = await Promise.all(
    reps.map(async (rep) => {
      const linkedUser = emailToUser.get(rep.email);
      const userId = linkedUser?.id;

      if (!userId) {
        return {
          representativeId: rep.id,
          name: rep.name,
          email: rep.email,
          archived: rep.archived,
          userId: null,
          userName: null,
          customerCount: 0,
          visitCheckinCount: 0,
          lastCheckinAt: null,
          overdueFollowUps: 0,
          longUnvisitedCount: 0,
        };
      }

      const [
        customerCount,
        visitCheckinCount,
        lastCheckin,
        overdueFollowUps,
        longUnvisitedCount,
      ] = await Promise.all([
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
        // Long-unvisited: profiles with no recent visit or interaction
        prisma.crmCustomerProfile.count({
          where: {
            ownerUserId: userId,
            archived: false,
            assignmentStatus: "ASSIGNED",
            visitCheckins: { none: { status: "COMPLETED", createdAt: { gte: thresholdDate } } },
            interactions: { none: { type: "VISIT", happenedAt: { gte: thresholdDate } } },
          },
        }),
      ]);

      return {
        representativeId: rep.id,
        name: rep.name,
        email: rep.email,
        archived: rep.archived,
        userId: linkedUser.id,
        userName: linkedUser.name,
        customerCount,
        visitCheckinCount,
        lastCheckinAt: lastCheckin?.createdAt?.toISOString() ?? null,
        overdueFollowUps,
        longUnvisitedCount,
      };
    })
  );

  return NextResponse.json({ representatives });
}
