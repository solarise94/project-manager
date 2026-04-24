import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserProjectIds, isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const isAdmin = session.user.role === "ADMIN";

  let projectIds: string[] | null = null; // null = no filter (admin)
  if (isRepresentative(session.user.role)) {
    projectIds = await getRepresentativeProjectIds(session.user.id);
  } else if (!isAdmin) {
    projectIds = await getUserProjectIds(session.user.id);
  }
  if (projectIds !== null && projectIds.length === 0) {
    return NextResponse.json({
      totalProjects: 0,
      inProgressProjects: 0,
      completedProjects: 0,
      pendingTickets: 0,
      weekProjects: 0,
      weekTickets: 0,
      statusDistribution: [],
      ticketTrend: [],
    });
  }

  const projectIdFilter = projectIds ? { in: projectIds } : undefined;
  const baseProjectWhere = projectIds
    ? { id: projectIdFilter, deleted: false }
    : { deleted: false };
  const baseTicketWhere = isRepresentative(session.user.role)
    ? { projectId: projectIdFilter, project: { deleted: false }, createdBy: session.user.id }
    : projectIds
      ? { projectId: projectIdFilter, project: { deleted: false } }
      : { project: { deleted: false } };

  const [
    totalProjects,
    inProgressProjects,
    completedProjects,
    pendingTickets,
    weekProjects,
    weekTickets,
  ] = await Promise.all([
    prisma.project.count({ where: baseProjectWhere }),
    prisma.project.count({ where: { ...baseProjectWhere, status: "IN_PROGRESS" } }),
    prisma.project.count({ where: { ...baseProjectWhere, status: "COMPLETED" } }),
    prisma.ticket.count({ where: { ...baseTicketWhere, status: { not: "CLOSED" } } }),
    prisma.project.count({ where: { ...baseProjectWhere, createdAt: { gte: weekAgo } } }),
    prisma.ticket.count({ where: { ...baseTicketWhere, createdAt: { gte: weekAgo } } }),
  ]);

  const statusDistribution = await prisma.project.groupBy({
    by: ["status"],
    where: baseProjectWhere,
    _count: { status: true },
  });

  // SQLite parameterized raw query for ticket trend
  let ticketTrend;
  if (isRepresentative(session.user.role) && projectIds) {
    const projectIdList = projectIds.map(() => "?").join(",");
    ticketTrend = await prisma.$queryRawUnsafe(
      `SELECT date(Ticket.createdAt) as date, COUNT(*) as count
       FROM Ticket
       JOIN Project ON Ticket.projectId = Project.id
       WHERE Ticket.projectId IN (${projectIdList})
         AND Project.deleted = 0
         AND Ticket.createdBy = ?
         AND Ticket.createdAt >= datetime('now', '-7 days')
       GROUP BY date(Ticket.createdAt)
       ORDER BY date(Ticket.createdAt)`,
      ...projectIds, session.user.id
    );
  } else if (projectIds) {
    const projectIdList = projectIds.map(() => "?").join(",");
    ticketTrend = await prisma.$queryRawUnsafe(
      `SELECT date(Ticket.createdAt) as date, COUNT(*) as count
       FROM Ticket
       JOIN Project ON Ticket.projectId = Project.id
       WHERE Ticket.projectId IN (${projectIdList})
         AND Project.deleted = 0
         AND Ticket.createdAt >= datetime('now', '-7 days')
       GROUP BY date(Ticket.createdAt)
       ORDER BY date(Ticket.createdAt)`,
      ...projectIds
    );
  } else {
    // ADMIN: all non-deleted projects
    ticketTrend = await prisma.$queryRawUnsafe(
      `SELECT date(Ticket.createdAt) as date, COUNT(*) as count
       FROM Ticket
       JOIN Project ON Ticket.projectId = Project.id
       WHERE Project.deleted = 0
         AND Ticket.createdAt >= datetime('now', '-7 days')
       GROUP BY date(Ticket.createdAt)
       ORDER BY date(Ticket.createdAt)`
    );
  }

  return NextResponse.json({
    totalProjects,
    inProgressProjects,
    completedProjects,
    pendingTickets,
    weekProjects,
    weekTickets,
    statusDistribution,
    ticketTrend,
  });
}
