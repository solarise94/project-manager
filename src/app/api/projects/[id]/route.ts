import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectMember, assertProjectOwner, isProjectOwner } from "@/lib/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      },
      _count: {
        select: { tickets: true, comments: true, attachments: true },
      },
    },
  });

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Deleted projects: only ADMIN or owner can access
  if (project.deleted) {
    const isOwner = await isProjectOwner(id, session.user.id);
    if (!isOwner && session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    try {
      await assertProjectMember(id, session.user.id);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    await assertProjectMember(id, session.user.id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertProjectOwner(id, session.user.id);
  } catch {
    return NextResponse.json({ error: "Forbidden: owner only" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, description, orderNumber, organization, client, representative, status, progress, startDate, endDate, archived } = body;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (orderNumber !== undefined) data.orderNumber = orderNumber;
    if (organization !== undefined) data.organization = organization;
    if (client !== undefined) data.client = client;
    if (representative !== undefined) data.representative = representative;
    if (status !== undefined) data.status = status;
    if (progress !== undefined) data.progress = progress;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (archived !== undefined) data.archived = archived;

    const updated = await prisma.project.update({
      where: { id },
      data,
    });

    // Log archive toggle
    if (archived !== undefined && archived !== existing.archived) {
      await prisma.activityLog.create({
        data: {
          type: archived ? "PROJECT_ARCHIVED" : "PROJECT_UNARCHIVED",
          content: archived ? `归档了项目 "${existing.name}"` : `取消了项目 "${existing.name}" 的归档`,
          projectId: id,
          userId: session.user.id,
        },
      });
    }

    // Log status change
    if (status !== undefined && status !== existing.status) {
      await prisma.statusHistory.create({
        data: {
          projectId: id,
          oldStatus: existing.status,
          newStatus: status,
          createdBy: session.user.id,
        },
      });
      await prisma.activityLog.create({
        data: {
          type: "STATUS_CHANGED",
          content: `项目状态从 "${existing.status}" 变更为 "${status}"`,
          metadata: JSON.stringify({ oldStatus: existing.status, newStatus: status }),
          projectId: id,
          userId: session.user.id,
        },
      });

      const owner = await prisma.projectMember.findFirst({
        where: { projectId: id, role: "OWNER" },
        include: { user: { select: { id: true, email: true, name: true, emailOnStatusChange: true } } },
      });

      if (owner) {
        await prisma.notification.create({
          data: {
            userId: owner.user.id,
            title: "项目状态变更",
            content: `项目 "${existing.name}" 状态已从 "${existing.status}" 变更为 "${status}"`,
            type: "STATUS",
            link: `/projects/${id}`,
          },
        });
        if (owner.user.email && owner.user.emailOnStatusChange) {
          const { sendMail } = await import("@/lib/mail");
          await sendMail({
            to: owner.user.email,
            subject: `【SciManage】项目状态变更: ${existing.name}`,
            text: `您好 ${owner.user.name || ""}，\n\n项目 "${existing.name}" 状态已从 "${existing.status}" 变更为 "${status}"。\n\n---\nSciManage`,
            html: `<p>您好 <strong>${owner.user.name || ""}</strong>，</p>
<p>项目 <strong>"${existing.name}"</strong> 状态已从 <strong>"${existing.status}"</strong> 变更为 <strong>"${status}"</strong>。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
          }).catch(() => {});
        }
      }
    }

    // Log progress update
    if (progress !== undefined && progress !== existing.progress) {
      await prisma.activityLog.create({
        data: {
          type: "PROGRESS_UPDATED",
          content: `项目进度更新为 ${progress}%`,
          metadata: JSON.stringify({ oldProgress: existing.progress, newProgress: progress }),
          projectId: id,
          userId: session.user.id,
        },
      });
    }

    // Log general update (only if no specific change was logged)
    if (status === undefined && progress === undefined && archived === undefined) {
      await prisma.activityLog.create({
        data: {
          type: "PROJECT_UPDATED",
          content: `更新了项目信息`,
          projectId: id,
          userId: session.user.id,
        },
      });
    }

    return NextResponse.json({ project: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    await assertProjectOwner(id, session.user.id);
  } catch {
    return NextResponse.json({ error: "Forbidden: owner only" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { reason } = body;

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: "删除原因不能为空" }, { status: 400 });
    }

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.project.update({
      where: { id },
      data: {
        deleted: true,
        deletedAt: new Date(),
        deletedReason: reason.trim(),
      },
    });

    await prisma.activityLog.create({
      data: {
        type: "PROJECT_DELETED",
        content: `删除了项目 "${existing.name}"，原因：${reason.trim()}`,
        metadata: JSON.stringify({ reason: reason.trim() }),
        projectId: id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ project: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
