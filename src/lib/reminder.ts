import { prisma } from "./prisma";
import { sendMailInBackground } from "./mail";

export async function checkAndSendReminders() {
  const now = new Date();
  const nowMs = now.getTime();

  // SQLite stores Prisma DateTime values as integer milliseconds here.
  // Use numeric comparisons, not ISO strings, or future reminders will match early.
  // Recover stuck PROCESSING records (locked > 10 min ago)
  const stuckCutoff = new Date(now.getTime() - 10 * 60 * 1000);
  const recovered = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE Ticket
       SET reminderStatus = 'PENDING',
           reminderLockedAt = NULL,
           reminderError = 'Recovered from stuck PROCESSING'
     WHERE reminderStatus = 'PROCESSING'
       AND reminderLockedAt IS NOT NULL
       AND reminderLockedAt <= ?
     RETURNING id`,
    stuckCutoff.getTime(),
  );
  if (recovered.length > 0) {
    console.log(`[REMINDER][TICKET] Recovered ${recovered.length} stuck PROCESSING records`);
  }

  // Atomically lock candidates: PENDING/FAILED → PROCESSING
  const locked = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE Ticket
       SET reminderStatus = 'PROCESSING',
           reminderLockedAt = ?
     WHERE reminderDate IS NOT NULL
       AND reminderDate <= ?
       AND reminderStatus IN ('PENDING', 'FAILED')
       AND status != 'CLOSED'
       AND id IN (
         SELECT id FROM Ticket
         WHERE reminderDate IS NOT NULL
           AND reminderDate <= ?
           AND reminderStatus IN ('PENDING', 'FAILED')
           AND status != 'CLOSED'
         LIMIT 200
       )
     RETURNING id`,
    nowMs,
    nowMs,
    nowMs,
  );

  if (locked.length === 0) {
    console.log("[REMINDER][TICKET] No pending ticket reminders");
    return { processed: 0, failed: 0 };
  }

  const lockedIds = locked.map((r) => r.id);

  const tickets = await prisma.ticket.findMany({
    where: { id: { in: lockedIds } },
    include: {
      project: { select: { name: true, id: true } },
    },
  });

  let processed = 0;
  let failed = 0;

  for (const ticket of tickets) {
    try {
      if (!ticket.createdBy) {
        console.log(`[REMINDER][TICKET] Ticket ${ticket.id} has no createdBy, cannot deliver notification`);
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            reminderStatus: "FAILED",
            reminderError: "Ticket has no createdBy",
          },
        });
        failed++;
        continue;
      }

      const creator = await prisma.user.findUnique({
        where: { id: ticket.createdBy },
        select: { id: true, email: true, name: true, emailOnReminder: true },
      });

      if (!creator?.id) {
        console.log(`[REMINDER][TICKET] Creator ${ticket.createdBy} not found for ticket ${ticket.id}`);
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            reminderStatus: "FAILED",
            reminderError: `Creator user ${ticket.createdBy} not found`,
          },
        });
        failed++;
        continue;
      }

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

      console.log(`[REMINDER][TICKET] Notification created for ticket ${ticket.id} -> user ${creator.id}`);

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

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          reminderStatus: "SENT",
          reminderSentAt: new Date(),
          reminderSent: true,
        },
      });
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.error(`[REMINDER][TICKET] Failed for ticket ${ticket.id}:`, msg);
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          reminderStatus: "FAILED",
          reminderError: msg.slice(0, 500),
        },
      }).catch(() => {});
      failed++;
    }
  }

  console.log(`[REMINDER][TICKET] Scan complete: processed=${processed} failed=${failed}`);
  return { processed, failed };
}

export async function checkAndSendCrmFollowUpReminders() {
  const now = new Date();
  const nowMs = now.getTime();
  const soon = new Date(now.getTime() + 30 * 60 * 1000);
  const soonMs = soon.getTime();

  // Same SQLite DateTime rule as ticket reminders: compare against integer ms.
  // Recover stuck PROCESSING records (locked > 10 min ago)
  const stuckCutoff = new Date(now.getTime() - 10 * 60 * 1000);
  const recovered = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE CrmFollowUpTask
       SET reminderStatus = 'PENDING',
           reminderLockedAt = NULL,
           reminderError = 'Recovered from stuck PROCESSING'
     WHERE reminderStatus = 'PROCESSING'
       AND reminderLockedAt IS NOT NULL
       AND reminderLockedAt <= ?
     RETURNING id`,
    stuckCutoff.getTime(),
  );
  if (recovered.length > 0) {
    console.log(`[REMINDER][CRM] Recovered ${recovered.length} stuck PROCESSING records`);
  }

  // Atomically lock candidates: PENDING/FAILED → PROCESSING
  const locked = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE CrmFollowUpTask
       SET reminderStatus = 'PROCESSING',
           reminderLockedAt = ?
     WHERE status = 'OPEN'
       AND dueAt <= ?
       AND reminderStatus IN ('PENDING', 'FAILED')
       AND id IN (
         SELECT id FROM CrmFollowUpTask
         WHERE status = 'OPEN'
           AND dueAt <= ?
           AND reminderStatus IN ('PENDING', 'FAILED')
         LIMIT 200
       )
     RETURNING id`,
    nowMs,
    soonMs,
    soonMs,
  );

  if (locked.length === 0) {
    console.log("[REMINDER][CRM] No pending CRM follow-up reminders");
    return { processed: 0, failed: 0 };
  }

  const lockedIds = locked.map((r) => r.id);

  const tasks = await prisma.crmFollowUpTask.findMany({
    where: { id: { in: lockedIds } },
    include: {
      ownerUser: { select: { id: true, name: true, email: true, emailOnReminder: true } },
      profile: {
        select: {
          sourceCustomer: { select: { name: true } },
        },
      },
    },
  });

  let processed = 0;
  let failed = 0;

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

      console.log(`[REMINDER][CRM] Notification created for task ${task.id} -> user ${user.id}`);

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
        data: {
          reminderStatus: "SENT",
          reminderSentAt: new Date(),
          reminderSent: true,
        },
      });
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.error(`[REMINDER][CRM] Failed for task ${task.id}:`, msg);
      await prisma.crmFollowUpTask.update({
        where: { id: task.id },
        data: {
          reminderStatus: "FAILED",
          reminderError: msg.slice(0, 500),
        },
      }).catch(() => {});
      failed++;
    }
  }

  console.log(`[REMINDER][CRM] Scan complete: processed=${processed} failed=${failed}`);
  return { processed, failed };
}

export async function runAllReminders() {
  const start = Date.now();
  console.log("[REMINDER] Starting reminder scan...");

  const [ticketResult, crmResult] = await Promise.all([
    checkAndSendReminders(),
    checkAndSendCrmFollowUpReminders(),
  ]);

  const durationMs = Date.now() - start;
  console.log(`[REMINDER] Scan finished: tickets=${ticketResult.processed}/${ticketResult.processed + ticketResult.failed} crm=${crmResult.processed}/${crmResult.processed + crmResult.failed} durationMs=${durationMs}`);

  return {
    ticketProcessed: ticketResult.processed,
    crmProcessed: crmResult.processed,
    ticketFailed: ticketResult.failed,
    crmFailed: crmResult.failed,
    durationMs,
  };
}
