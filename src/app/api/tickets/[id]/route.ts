import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectMember } from "@/lib/permissions";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await req.json();
    const { status, priority, assigneeId, reminderDate } = body;

    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
      await assertProjectMember(existing.projectId, session.user.id);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId;
    if (reminderDate !== undefined) {
      updateData.reminderDate = reminderDate ? new Date(reminderDate) : null;
      updateData.reminderSent = false;
    }

    const updated = await prisma.ticket.update({
      where: { id },
      data: updateData,
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
      },
    });

    if (status !== undefined && status !== existing.status) {
      await prisma.activityLog.create({
        data: {
          type: "TICKET_UPDATED",
          content: `工单 "${existing.title}" 状态更新为 "${status}"`,
          metadata: JSON.stringify({ oldStatus: existing.status, newStatus: status, ticketId: id }),
          projectId: existing.projectId,
          userId: session.user.id,
        },
      });
    }

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
  }
}
