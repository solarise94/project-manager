import { prisma } from "./prisma";
import { sendMailInBackground } from "./mail";

export async function checkAndSendReminders() {
  const now = new Date();

  // Find all tickets with reminderDate that has already passed and not yet sent
  const tickets = await prisma.ticket.findMany({
    where: {
      reminderDate: {
        lte: now,
      },
      reminderSent: false,
      status: {
        not: "CLOSED",
      },
    },
    include: {
      project: { select: { name: true, id: true } },
    },
  });

  for (const ticket of tickets) {
    try {
      // Find the creator from activity log (first TICKET_CREATED for this ticket)
      const activity = await prisma.activityLog.findFirst({
        where: {
          type: "TICKET_CREATED",
          projectId: ticket.projectId,
          metadata: {
            contains: ticket.id,
          },
        },
        include: {
          user: { select: { email: true, name: true, id: true, emailOnReminder: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      const creator = activity?.user;

      // Create in-app notification first
      if (creator?.id) {
        const shouldEmail = !!(creator.email && creator.emailOnReminder);
        const notification = await prisma.notification.create({
          data: {
            userId: creator.id,
            title: `工单提醒: ${ticket.title}`,
            content: `工单 "${ticket.title}"（项目: ${ticket.project.name}）即将到达提醒时间，请关注处理进度。`,
            type: "REMINDER",
            link: `/projects/${ticket.projectId}`,
            emailStatus: shouldEmail ? "pending" : null,
          },
        });
        if (shouldEmail) {
          sendMailInBackground({
            to: creator.email!,
            subject: `[SciManage] 工单提醒: ${ticket.title}`,
            text: `您好，\n\n您创建的工单 "${ticket.title}"（项目: ${ticket.project.name}）即将到达提醒时间，请关注处理进度。\n\n---\nSciManage 科研项目管理平台`,
            html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #2563eb;">SciManage 工单提醒</h2>
        <p>您好，</p>
        <p>您创建的工单 <strong>"${ticket.title}"</strong> 即将到达提醒时间。</p>
        <p>所属项目: <strong>${ticket.project.name}</strong></p>
        <p>请关注处理进度。</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #64748b; font-size: 12px;">SciManage 科研项目管理平台</p>
      </div>
    `,
          }, notification.id);
        }
      }

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { reminderSent: true },
      });
    } catch (err) {
      console.error("Failed to send reminder for ticket", ticket.id, err);
    }
  }

  return tickets.length;
}

export async function checkAndSendCrmFollowUpReminders() {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 60 * 1000);

  const tasks = await prisma.crmFollowUpTask.findMany({
    where: {
      status: "OPEN",
      reminderSent: false,
      dueAt: { lte: soon },
    },
    include: {
      ownerUser: { select: { id: true, name: true, email: true, emailOnReminder: true } },
      profile: {
        select: {
          sourceCustomer: { select: { name: true } },
        },
      },
    },
  });

  for (const task of tasks) {
    try {
      const user = task.ownerUser;
      const customerName = task.profile.sourceCustomer.name;
      const shouldEmail = !!(user.email && user.emailOnReminder);

      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          title: `CRM 跟进提醒: ${task.title}`,
          content: `客户「${customerName}」的跟进任务「${task.title}」即将到期，请及时处理。`,
          type: "CRM_FOLLOW_UP_REMINDER",
          link: `/crm/follow-ups`,
          emailStatus: shouldEmail ? "pending" : null,
        },
      });

      if (shouldEmail) {
        sendMailInBackground({
          to: user.email!,
          subject: `[SciManage] CRM 跟进提醒: ${task.title}`,
          text: `您好，\n\n客户「${customerName}」的跟进任务「${task.title}」即将到期，请及时处理。\n\n---\nSciManage 科研项目管理平台`,
          html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #2563eb;">SciManage CRM 跟进提醒</h2>
        <p>您好，</p>
        <p>客户 <strong>「${customerName}」</strong> 的跟进任务 <strong>「${task.title}」</strong> 即将到期。</p>
        <p>请及时处理。</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #64748b; font-size: 12px;">SciManage 科研项目管理平台</p>
      </div>
    `,
        }, notification.id);
      }

      await prisma.crmFollowUpTask.update({
        where: { id: task.id },
        data: { reminderSent: true },
      });
    } catch (err) {
      console.error("Failed to send CRM follow-up reminder for task", task.id, err);
    }
  }

  return tasks.length;
}

let intervalId: NodeJS.Timeout | null = null;

export function startReminderScheduler(intervalMinutes = 5) {
  if (intervalId) return;
  console.log(`Starting reminder scheduler (every ${intervalMinutes} minutes)`);
  checkAndSendReminders().catch(console.error);
  checkAndSendCrmFollowUpReminders().catch(console.error);
  intervalId = setInterval(() => {
    checkAndSendReminders().catch(console.error);
    checkAndSendCrmFollowUpReminders().catch(console.error);
  }, intervalMinutes * 60 * 1000);
}

export function stopReminderScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// Global flag to prevent multiple schedulers in dev mode
const GLOBAL_KEY = "__scimanage_reminder_scheduler_started__";

export function ensureSchedulerStarted() {
  if (typeof globalThis !== "undefined") {
    const g = globalThis as Record<string, unknown>;
    if (!g[GLOBAL_KEY]) {
      g[GLOBAL_KEY] = true;
      startReminderScheduler(5);
    }
  }
}
