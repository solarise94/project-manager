import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectMember } from "@/lib/permissions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.ticket.findUnique({
    where: { id },
    include: { project: { select: { deleted: true } } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  if (existing.project?.deleted) {
    return NextResponse.json({ error: "项目已删除" }, { status: 400 });
  }

  try {
    await assertProjectMember(existing.projectId, session.user.id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const replies = await prisma.ticketReply.findMany({
    where: { ticketId: id },
    include: {
      author: {
        select: { id: true, name: true, avatar: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ replies });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.ticket.findUnique({
    where: { id },
    include: { project: { select: { deleted: true } } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  if (existing.project?.deleted) {
    return NextResponse.json({ error: "项目已删除，无法回复工单" }, { status: 400 });
  }

  try {
    await assertProjectMember(existing.projectId, session.user.id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { content } = body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  const reply = await prisma.ticketReply.create({
    data: {
      content: content.trim(),
      ticketId: id,
      authorId: session.user.id,
    },
    include: {
      author: {
        select: { id: true, name: true, avatar: true },
      },
    },
  });

  await prisma.activityLog.create({
    data: {
      type: "TICKET_UPDATED",
      content: `回复了工单 "${existing.title}"`,
      metadata: JSON.stringify({ ticketId: id }),
      projectId: existing.projectId,
      userId: session.user.id,
    },
  });

  return NextResponse.json({ reply }, { status: 201 });
}
