import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectMember, assertProjectOwner, isProjectOwner, isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";

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
      rep: {
        select: { id: true, name: true, email: true },
      },
      cust: {
        select: { id: true, name: true, customerCode: true, organization: true },
      },
      _count: {
        select: { tickets: true, comments: true, attachments: true },
      },
    },
  });

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Representatives can access their own associated non-deleted projects
  if (isRepresentative(session.user.role)) {
    if (project.deleted) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const repProjectIds = await getRepresentativeProjectIds(session.user.id);
    if (!repProjectIds.includes(id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const myTicketCount = await prisma.ticket.count({
      where: { projectId: id, createdBy: session.user.id },
    });
    const result = {
      ...project,
      _count: {
        tickets: myTicketCount,
        comments: 0,
        attachments: 0,
      },
    };
    return NextResponse.json({ project: result as typeof project });
  }

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

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden: representatives cannot modify projects" }, { status: 403 });
  }

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
    const { name, description, orderNumber, organization, client, representative, representativeId, customerId, status, progress, startDate, endDate, archived } = body;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (orderNumber !== undefined) data.orderNumber = orderNumber;
    if (organization !== undefined) data.organization = organization;
    if (client !== undefined) data.client = client;
    if (status !== undefined) data.status = status;
    if (progress !== undefined) data.progress = progress;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (archived !== undefined) data.archived = archived;

    // customerId drives client/organization snapshots — same pattern as representativeId
    if (customerId !== undefined) {
      if (customerId) {
        const cust = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!cust) {
          return NextResponse.json({ error: "指定的客户不存在" }, { status: 400 });
        }
        data.customerId = customerId;
        data.client = cust.name;
        // Always sync organization from customer master data when switching customer
        data.organization = cust.organization || null;
      } else {
        data.customerId = null;
        data.client = null;
      }
    }

    // representativeId drives the text snapshot — always sync from DB to prevent stale client overwrites
    if (representativeId !== undefined) {
      if (representativeId) {
        const rep = await prisma.representative.findUnique({ where: { id: representativeId } });
        if (!rep) {
          return NextResponse.json({ error: "指定的代表不存在" }, { status: 400 });
        }
        data.representativeId = representativeId;
        data.representative = rep.name;
      } else {
        data.representativeId = null;
        data.representative = null;
      }
    } else if (representative !== undefined) {
      // Only trust client text when representativeId is NOT being changed
      data.representative = representative;
    }

    const updated = await prisma.project.update({
      where: { id },
      data,
    });

    // Pre-fetch representative for batched notification (single token)
    const repForNotify = updated.representativeId
      ? await prisma.representative.findUnique({
          where: { id: updated.representativeId, archived: false },
        })
      : null;
    const repNotifications: Array<{ subject: string; text: string; html: string }> = [];

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
        include: { user: { select: { id: true, email: true, name: true, emailOnStatusChange: true, role: true } } },
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
        if (owner.user.email && owner.user.emailOnStatusChange && owner.user.role !== "REPRESENTATIVE") {
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

      // Queue representative notification
      if (repForNotify?.email) {
        repNotifications.push({
          subject: `【SciManage】项目状态变更: ${existing.name}`,
          text: `您好 ${repForNotify.name || ""}，\n\n项目 "${existing.name}" 状态已从 "${existing.status}" 变更为 "${status}"。\n\n---\nSciManage`,
          html: `<p>您好 <strong>${repForNotify.name || ""}</strong>，</p>
<p>项目 <strong>"${existing.name}"</strong> 状态已从 <strong>"${existing.status}"</strong> 变更为 <strong>"${status}"</strong>。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
        });
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

    // Log representative change
    if (representativeId !== undefined && representativeId !== existing.representativeId) {
      const newRep = representativeId
        ? await prisma.representative.findUnique({ where: { id: representativeId } })
        : null;
      const oldRep = existing.representativeId
        ? await prisma.representative.findUnique({ where: { id: existing.representativeId } })
        : null;
      await prisma.activityLog.create({
        data: {
          type: "REPRESENTATIVE_CHANGED",
          content: oldRep
            ? `将项目代表从 "${oldRep.name}" 变更为 "${newRep?.name || "无"}"`
            : `为项目设置了代表 "${newRep?.name || ""}"`,
          metadata: JSON.stringify({
            oldRepresentativeId: existing.representativeId,
            newRepresentativeId: representativeId || null,
            oldRepresentativeName: oldRep?.name || null,
            newRepresentativeName: newRep?.name || null,
          }),
          projectId: id,
          userId: session.user.id,
        },
      });

      // Queue new representative notification
      if (repForNotify?.email) {
        repNotifications.push({
          subject: `【SciManage】您已被指定为项目代表: ${existing.name}`,
          text: `您好 ${repForNotify.name || ""}，\n\n您已被指定为项目 "${existing.name}" 的代表。\n\n---\nSciManage`,
          html: `<p>您好 <strong>${repForNotify.name || ""}</strong>，</p>
<p>您已被指定为项目 <strong>"${existing.name}"</strong> 的代表。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
        });
      }
    }

    // Batch-send all representative notifications with a single token
    if (repNotifications.length > 0 && repForNotify?.email) {
      const { notifyRepresentative } = await import("@/lib/representative-link");
      const result = await notifyRepresentative(repForNotify.email, `/projects/${id}`, repNotifications);
      if (!result.ok) {
        console.error("Failed to notify representative", result.results);
      }
    }

    // Log general update (only if no specific change was logged)
    const hasSpecificChange =
      status !== undefined && status !== existing.status ||
      progress !== undefined && progress !== existing.progress ||
      archived !== undefined && archived !== existing.archived ||
      representativeId !== undefined && representativeId !== existing.representativeId;
    if (!hasSpecificChange) {
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

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden: representatives cannot delete projects" }, { status: 403 });
  }

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
