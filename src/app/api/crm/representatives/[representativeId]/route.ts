import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRegionalManagerRole } from "@/lib/crm/permissions";
import { REFLOW_THRESHOLD_DAYS } from "@/lib/crm/constants";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ representativeId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "REPRESENTATIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { representativeId } = await params;
  const rep = await prisma.representative.findUnique({
    where: { id: representativeId },
    include: { regionAssignments: { include: { region: { select: { id: true, name: true } } } } },
  });
  if (!rep) return NextResponse.json({ error: "Representative not found" }, { status: 404 });

  // Regional manager: verify this rep is in their managed set
  if (isRegionalManagerRole(session.user.role)) {
    const manager = await prisma.crmRegionManager.findUnique({
      where: { userId: session.user.id, archived: false },
      include: { reps: { where: { representativeId }, select: { id: true } } },
    });
    if (!manager || manager.reps.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Find linked User
  const linkedUser = await prisma.user.findFirst({
    where: { email: rep.email },
    select: { id: true, name: true },
  });

  const userId = linkedUser?.id;
  const thresholdDate = new Date(Date.now() - REFLOW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  if (!userId) {
    return NextResponse.json({
      representative: { id: rep.id, name: rep.name, email: rep.email, archived: rep.archived },
      linkedUser: null,
      customerCount: 0,
      visitCheckinCount: 0,
      lastCheckinAt: null,
      overdueFollowUps: 0,
      longUnvisitedCount: 0,
      customers: [],
      recentCheckins: [],
      openFollowUps: [],
      relationCount: 0,
      regions: rep.regionAssignments.map((a) => ({
        id: a.region.id,
        name: a.region.name,
        isPrimary: a.isPrimary,
      })),
    });
  }

  const [
    customerCount,
    visitCheckinCount,
    lastCheckin,
    overdueFollowUps,
    longUnvisitedCount,
    customers,
    recentCheckins,
    openFollowUps,
    relationCount,
  ] = await Promise.all([
    prisma.crmCustomerProfile.count({
      where: { ownerUserId: userId, archived: false, assignmentStatus: "ASSIGNED" },
    }),
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
    prisma.crmCustomerProfile.findMany({
      where: { ownerUserId: userId, archived: false, assignmentStatus: "ASSIGNED" },
      include: {
        sourceCustomer: {
          select: { id: true, name: true, customerCode: true, principal: true, email: true, wechat: true, organization: true, address: true },
        },
        ownerUser: { select: { id: true, name: true } },
        _count: { select: { interactions: true, followUpTasks: true, visitCheckins: true, addresses: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.crmVisitCheckin.findMany({
      where: { userId, status: "COMPLETED" },
      include: { media: true, user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.crmFollowUpTask.findMany({
      where: { ownerUserId: userId, status: "OPEN" },
      include: {
        ownerUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
        profile: { select: { id: true, sourceCustomerId: true, sourceCustomer: { select: { id: true, name: true, customerCode: true } } } },
      },
      orderBy: { dueAt: "asc" },
      take: 20,
    }),
    // Count relations where the rep's customers are involved
    prisma.customerRelation.count({
      where: {
        OR: [
          { fromCustomer: { crmProfile: { ownerUserId: userId, assignmentStatus: "ASSIGNED" } } },
          { toCustomer: { crmProfile: { ownerUserId: userId, assignmentStatus: "ASSIGNED" } } },
        ],
      },
    }),
  ]);

  return NextResponse.json({
    representative: { id: rep.id, name: rep.name, email: rep.email, archived: rep.archived },
    linkedUser,
    customerCount,
    visitCheckinCount,
    lastCheckinAt: lastCheckin?.createdAt?.toISOString() ?? null,
    overdueFollowUps,
    longUnvisitedCount,
    customers,
    recentCheckins,
    openFollowUps,
    relationCount,
    regions: rep.regionAssignments.map((a) => ({
      id: a.region.id,
      name: a.region.name,
      isPrimary: a.isPrimary,
    })),
  });
}
