import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative, canReadProject } from "@/lib/permissions";

type SourceType = "PROJECT_TICKET" | "TICKET_REPLY" | "PROJECT_COMMENT";

async function resolveSource(
  sourceType: SourceType,
  sourceId: string,
): Promise<{
  projectId: string | null;
  ticketId: string | null;
  commentId: string | null;
  title: string;
  url: string;
  representativeId: string | null;
  ticketProjectId: string | null;
} | null> {
  if (sourceType === "PROJECT_TICKET") {
    const ticket = await prisma.ticket.findUnique({
      where: { id: sourceId },
      select: {
        id: true, title: true, projectId: true,
        project: { select: { id: true, name: true, representativeId: true } },
      },
    });
    if (!ticket) return null;
    return {
      projectId: ticket.projectId,
      ticketId: ticket.id,
      commentId: null,
      title: `工单: ${ticket.title}`,
      url: `/projects/${ticket.projectId}?tab=tickets`,
      representativeId: ticket.project?.representativeId ?? null,
      ticketProjectId: ticket.projectId,
    };
  }

  if (sourceType === "TICKET_REPLY") {
    const reply = await prisma.ticketReply.findUnique({
      where: { id: sourceId },
      select: {
        id: true, content: true, ticketId: true,
        ticket: {
          select: {
            id: true, title: true, projectId: true,
            project: { select: { id: true, name: true, representativeId: true } },
          },
        },
      },
    });
    if (!reply) return null;
    const preview = (reply.content ?? "").slice(0, 80);
    return {
      projectId: reply.ticket.projectId,
      ticketId: reply.ticketId,
      commentId: null,
      title: `工单回复: ${reply.ticket.title} — ${preview}`,
      url: `/projects/${reply.ticket.projectId}?tab=tickets`,
      representativeId: reply.ticket.project?.representativeId ?? null,
      ticketProjectId: reply.ticket.projectId,
    };
  }

  if (sourceType === "PROJECT_COMMENT") {
    const comment = await prisma.comment.findUnique({
      where: { id: sourceId },
      select: {
        id: true, content: true,
        project: { select: { id: true, name: true, representativeId: true } },
      },
    });
    if (!comment) return null;
    const preview = (comment.content ?? "").slice(0, 80);
    return {
      projectId: comment.project.id,
      ticketId: null,
      commentId: comment.id,
      title: `项目评论: ${comment.project.name} — ${preview}`,
      url: `/projects/${comment.project.id}`,
      representativeId: comment.project.representativeId,
      ticketProjectId: null,
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { sourceType, sourceId, dueAt, note, notify } = body as {
    sourceType?: string;
    sourceId?: string;
    dueAt?: string;
    note?: string;
    notify?: boolean;
  };

  if (!sourceType || !sourceId) {
    return NextResponse.json({ error: "sourceType and sourceId are required" }, { status: 400 });
  }
  if (!["PROJECT_TICKET", "TICKET_REPLY", "PROJECT_COMMENT"].includes(sourceType)) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }

  // Resolve source
  const src = await resolveSource(sourceType as SourceType, sourceId);
  if (!src) {
    return NextResponse.json({ error: "来源不存在" }, { status: 404 });
  }

  // ── Access control: verify the user can read the source's project ──────
  if (src.projectId) {
    const canRead = await canReadProject(src.projectId, session.user.id, session.user.role);
    if (!canRead) {
      return NextResponse.json({ error: "无权访问该项目" }, { status: 403 });
    }
  }

  if (!src.representativeId) {
    return NextResponse.json(
      { error: "该项目未指定代表，请先在项目设置中绑定代表" },
      { status: 400 },
    );
  }

  // Map representative to User
  const rep = await prisma.representative.findUnique({
    where: { id: src.representativeId, archived: false },
    select: { email: true, name: true },
  });
  if (!rep) {
    return NextResponse.json(
      { error: "项目代表不存在或已归档" },
      { status: 400 },
    );
  }

  const salesUser = await prisma.user.findFirst({
    where: { email: rep.email, role: { in: ["REPRESENTATIVE", "REGIONAL_MANAGER"] } },
    select: { id: true },
  });

  if (!salesUser) {
    return NextResponse.json(
      { error: "该代表尚未登录过系统，无法分配任务。请先通知代表登录。" },
      { status: 400 },
    );
  }

  // Find the CRM profile for the project's customer
  const project = src.projectId
    ? await prisma.project.findUnique({
        where: { id: src.projectId },
        select: { customerId: true },
      })
    : null;

  if (!project?.customerId) {
    return NextResponse.json(
      { error: "该项目未关联客户，无法创建 CRM 跟进任务" },
      { status: 400 },
    );
  }

  const taskDueAt = dueAt ? new Date(dueAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const title = note ? `${src.title} — ${note}` : src.title;

  const sourceOpenKey = `push:${sourceType}:${sourceId}`;
  const customerId = project.customerId;

  // ── Atomic upsert via sourceOpenKey unique constraint ─────────────────
  // Retry across separate transactions so that if a competing task was
  // completed between attempts, the next transaction sees the freed key.
  class RetryPushError extends Error {
    constructor() { super("RETRY"); }
  }

  let result: { task: { id: string }; action: "created" | "updated"; profileId: string } | null = null;

  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        let profile = await tx.crmCustomerProfile.findUnique({
          where: { sourceCustomerId: customerId },
          select: { id: true },
        });

        if (!profile) {
          profile = await tx.crmCustomerProfile.create({
            data: {
              sourceCustomerId: customerId,
              ownerUserId: salesUser.id,
              stage: "NEW",
              importance: "NORMAL",
              lastFollowUpAt: new Date(),
            },
            select: { id: true },
          });
        }

        try {
          const created = await tx.crmFollowUpTask.create({
            data: {
              profileId: profile.id,
              ownerUserId: salesUser.id,
              title,
              dueAt: taskDueAt,
              status: "OPEN",
              sourceOpenKey,
              sourceType: sourceType as SourceType,
              sourceId,
              sourceProjectId: src.projectId,
              sourceTicketId: src.ticketId,
              sourceCommentId: src.commentId,
              sourceTitle: src.title,
              sourceUrl: src.url,
              createdByUserId: session.user.id,
            },
            select: { id: true },
          });
          return { task: created, action: "created" as const, profileId: profile.id };
        } catch (e) {
          if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
            const existing = await tx.crmFollowUpTask.findFirst({
              where: { sourceOpenKey, status: "OPEN" },
              select: { id: true },
            });
            if (existing) {
              const updated = await tx.crmFollowUpTask.update({
                where: { id: existing.id },
                data: { title, dueAt: taskDueAt, ownerUserId: salesUser.id },
                select: { id: true },
              });
              return { task: updated, action: "updated" as const, profileId: profile.id };
            }
            // Competing task was completed/cancelled — key freed. Throw to open a fresh transaction.
            throw new RetryPushError();
          }
          throw e;
        }
      });
    } catch (e) {
      if (e instanceof RetryPushError && attempt === 0) continue;
      throw e;
    }
  }

  if (!result) {
    return NextResponse.json({ error: "推送失败：并发冲突，请重试" }, { status: 409 });
  }

  // ── Side effects (outside transaction) ──────────────────────────────
  if (notify !== false) {
    await prisma.notification.create({
      data: {
        userId: salesUser.id,
        type: "CRM_FOLLOW_UP_REMINDER",
        title: `跟进任务: ${title}`,
        content: `截止: ${taskDueAt.toLocaleDateString("zh-CN")}\n${src.url}`,
        link: src.url,
      },
    }).catch(() => { /* non-critical */ });
  }

  if (src.projectId) {
    await prisma.activityLog.create({
      data: {
        type: "PROJECT_UPDATED",
        content: `${result.action === "created" ? "创建" : "更新"}代表跟进任务: ${title}`,
        metadata: JSON.stringify({
          action: "CRM_FOLLOW_UP_PUSH",
          followUpTaskId: result.task.id,
          sourceType,
          sourceId,
          action_type: result.action,
        }),
        projectId: src.projectId,
        userId: session.user.id,
      },
    }).catch(() => { /* non-critical */ });
  }

  return NextResponse.json({
    ok: true,
    taskId: result.task.id,
    action: result.action,
    message: result.action === "created" ? "跟进任务已创建" : "已有跟进任务已更新",
  });
}
