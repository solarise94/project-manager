import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectMember, getUserProjectIds } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const projectId = searchParams.get("projectId");

  const userProjectIds = await getUserProjectIds(session.user.id);
  if (userProjectIds.length === 0) return NextResponse.json({ tickets: [] });

  const where: { projectId: { in: string[] } | string; status?: string; project?: { deleted: boolean } } = {
    projectId: projectId && userProjectIds.includes(projectId) ? projectId : { in: userProjectIds },
    project: { deleted: false },
  };
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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { title, description, priority, projectId, assigneeId, reminderDate } = body;

    try {
      await assertProjectMember(projectId, session.user.id);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        priority: priority || "MEDIUM",
        projectId,
        assigneeId: assigneeId || null,
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
