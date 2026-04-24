import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectMember, isRepresentative } from "@/lib/permissions";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await req.json();
    const { status, priority, assigneeId, reminderDate } = body;

    const existing = await prisma.ticket.findUnique({
      where: { id },
      include: { project: { select: { deleted: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (existing.project?.deleted) {
      return NextResponse.json({ error: "项目已删除，无法修改工单" }, { status: 400 });
    }

    if (isRepresentative(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (session.user.role !== "ADMIN") {
      try {
        await assertProjectMember(existing.projectId, session.user.id);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
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

      // Notify project representative of ticket status change
      const project = await prisma.project.findUnique({
        where: { id: existing.projectId },
        select: { representativeId: true, name: true },
      });
      if (project?.representativeId) {
        const rep = await prisma.representative.findUnique({
          where: { id: project.representativeId, archived: false },
        });
        if (rep?.email) {
          const { notifyRepresentative } = await import("@/lib/representative-link");
          const result = await notifyRepresentative(rep.email, `/projects/${existing.projectId}`, [
            {
              subject: `【SciManage】工单状态变更: ${existing.title}`,
              text: `您好 ${rep.name || ""}，\n\n工单 "${existing.title}"（项目: ${project.name}）状态已更新为 "${status}"。\n\n---\nSciManage`,
              html: `<p>您好 <strong>${rep.name || ""}</strong>，</p>
<p>工单 <strong>"${existing.title}"</strong>（项目: ${project.name}）状态已更新为 <strong>"${status}"</strong>。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
            },
          ]);
          if (!result.ok) {
            console.error("Failed to notify representative of ticket status change", result.results);
          }
        }
      }
    }

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
  }
}
