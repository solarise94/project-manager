import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserProjectIds } from "@/lib/permissions";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const projectIds = await getUserProjectIds(session.user.id);
  if (projectIds.length === 0) {
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

  const projectIdFilter = { in: projectIds };
  const baseProjectWhere = { id: projectIdFilter, deleted: false };

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
    prisma.ticket.count({ where: { projectId: projectIdFilter, status: { not: "CLOSED" } } }),
    prisma.project.count({ where: { id: projectIdFilter, createdAt: { gte: weekAgo } } }),
    prisma.ticket.count({ where: { projectId: projectIdFilter, createdAt: { gte: weekAgo } } }),
  ]);

  const statusDistribution = await prisma.project.groupBy({
    by: ["status"],
    where: { id: projectIdFilter },
    _count: { status: true },
  });

  // SQLite parameterized raw query for ticket trend (filtered by user's projects)
  const projectIdList = projectIds.map(() => "?").join(",");
  const ticketTrend = await prisma.$queryRawUnsafe(
    `SELECT date(createdAt) as date, COUNT(*) as count
     FROM Ticket
     WHERE projectId IN (${projectIdList})
       AND createdAt >= datetime('now', '-7 days')
     GROUP BY date(createdAt)
     ORDER BY date(createdAt)`,
    ...projectIds
  );

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
