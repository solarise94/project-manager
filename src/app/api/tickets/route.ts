import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReadProject, canContributeProject, getReadableProjectIds } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const projectId = searchParams.get("projectId");

  // When projectId is explicitly provided, check access to that specific project
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ tickets: [] });

    const canRead = await canReadProject(projectId, session.user.id, session.user.role);
    if (!canRead) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const where: { projectId: string; status?: string } = { projectId };
    if (status) where.status = status;

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ tickets });
  }

  // No projectId: return tickets from all accessible non-deleted projects
  const isAdmin = session.user.role === "ADMIN";
  const ticketWhere: { projectId?: { in: string[] }; status?: string; project: { deleted: boolean } } = {
    project: { deleted: false },
  };
  if (!isAdmin) {
    const readableIds = await getReadableProjectIds(session.user.id, session.user.role);
    if (!readableIds || readableIds.length === 0) return NextResponse.json({ tickets: [] });
    ticketWhere.projectId = { in: readableIds };
  }
  if (status) ticketWhere.status = status;

  const tickets = await prisma.ticket.findMany({
    where: ticketWhere,
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tickets });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { title, description, priority, projectId, assigneeId, reminderDate } = body;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (project.deleted) return NextResponse.json({ error: "项目已删除，无法创建工单" }, { status: 400 });

    const canContribute = await canContributeProject(projectId, session.user.id, session.user.role);
    if (!canContribute) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        priority: priority || "MEDIUM",
        projectId,
        assigneeId: assigneeId || null,
        createdBy: session.user.id,
        reminderDate: reminderDate ? new Date(reminderDate) : null,
        reminderSent: false,
      },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
      },
    });

    await prisma.activityLog.create({
      data: {
        type: "TICKET_CREATED",
        content: `创建了工单 "${title}"`,
        metadata: JSON.stringify({ ticketId: ticket.id }),
        projectId,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 });
  }
}
