import { prisma } from "./prisma";
import { sendReminderEmail } from "./mail";

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
          user: { select: { email: true, name: true, id: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      const creator = activity?.user;
      if (creator?.email) {
        await sendReminderEmail({
          to: creator.email,
          ticketTitle: ticket.title,
          projectName: ticket.project.name,
        });
      }

      // Create in-app notification
      if (creator?.id) {
        await prisma.notification.create({
          data: {
            userId: creator.id,
            title: `工单提醒: ${ticket.title}`,
            content: `工单 "${ticket.title}"（项目: ${ticket.project.name}）即将到达提醒时间，请关注处理进度。`,
            type: "REMINDER",
            link: `/projects/${ticket.projectId}`,
          },
        });
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

let intervalId: NodeJS.Timeout | null = null;

export function startReminderScheduler(intervalMinutes = 5) {
  if (intervalId) return;
  console.log(`Starting reminder scheduler (every ${intervalMinutes} minutes)`);
  checkAndSendReminders().catch(console.error);
  intervalId = setInterval(() => {
    checkAndSendReminders().catch(console.error);
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
