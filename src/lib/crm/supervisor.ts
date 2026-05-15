import { prisma } from "@/lib/prisma";

export const SUPERVISOR_REASON_LABELS: Record<string, string> = {
  NORMAL: "常规复核",
  ORG_CONFLICT: "区域冲突",
  CUSTOMER_CONFLICT: "客户冲突",
  DUPLICATE_OVERRIDE: "重复强制新建",
  ORG_REQUEST: "单位主数据申请",
};

/**
 * Resolve supervisor users for a given submittedByUserId.
 * Walk: User → (by email) Representative → CrmRegionManagerRepresentative →
 * unarchived CrmRegionManager → User.
 * Fallback: all ADMIN users if no regional manager found.
 */
export async function resolveApplicationSupervisors(
  submittedByUserId: string,
): Promise<Array<{ id: string; email: string; name: string }>> {
  const submitter = await prisma.user.findUnique({
    where: { id: submittedByUserId },
    select: { email: true },
  });
  if (!submitter?.email) {
    return getAdminFallback();
  }

  const rep = await prisma.representative.findUnique({
    where: { email: submitter.email },
    select: { id: true },
  });
  if (!rep) {
    return getAdminFallback();
  }

  const links = await prisma.crmRegionManagerRepresentative.findMany({
    where: { representativeId: rep.id },
    select: { managerId: true },
  });
  const managerIds = links.map((l) => l.managerId);
  if (managerIds.length === 0) {
    return getAdminFallback();
  }

  const managers = await prisma.crmRegionManager.findMany({
    where: { id: { in: managerIds }, archived: false },
    select: { userId: true },
  });
  const userIds = managers.map((m) => m.userId);
  if (userIds.length === 0) {
    return getAdminFallback();
  }

  const supervisors = await prisma.user.findMany({
    where: { id: { in: userIds }, email: { not: "" } },
    select: { id: true, email: true, name: true },
  });

  const seen = new Set<string>();
  const deduped: Array<{ id: string; email: string; name: string }> = [];
  for (const s of supervisors) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      deduped.push({ id: s.id, email: s.email!, name: s.name });
    }
  }
  return deduped.length > 0 ? deduped : getAdminFallback();
}

/**
 * Resolve reviewers for a RepresentativeOrganization binding.
 * Takes representativeId directly — regional manager first, ADMIN fallback.
 */
export async function resolveBindingReviewers(
  representativeId: string,
): Promise<Array<{ id: string; email: string; name: string }>> {
  const links = await prisma.crmRegionManagerRepresentative.findMany({
    where: { representativeId },
    select: { managerId: true },
  });
  const managerIds = links.map((l) => l.managerId);

  if (managerIds.length > 0) {
    const managers = await prisma.crmRegionManager.findMany({
      where: { id: { in: managerIds }, archived: false },
      select: { userId: true },
    });
    const userIds = managers.map((m) => m.userId);
    if (userIds.length > 0) {
      const supervisors = await prisma.user.findMany({
        where: { id: { in: userIds }, email: { not: "" } },
        select: { id: true, email: true, name: true },
      });
      const seen = new Set<string>();
      const deduped: Array<{ id: string; email: string; name: string }> = [];
      for (const s of supervisors) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          deduped.push({ id: s.id, email: s.email!, name: s.name });
        }
      }
      if (deduped.length > 0) return deduped;
    }
  }

  return getAdminFallback();
}

async function getAdminFallback(): Promise<Array<{ id: string; email: string; name: string }>> {
  return prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Create in-app notifications for supervisors. Does NOT send email.
 * Email is cron-only via CrmApplicationSupervisorNotification.
 */
export async function notifyApplicationSupervisors(
  applicationId: string,
  reason: string,
): Promise<void> {
  const application = await prisma.crmCustomerApplication.findUnique({
    where: { id: applicationId },
    select: { name: true, organization: true, submittedByUserId: true },
  });
  if (!application) return;

  const supervisors = await resolveApplicationSupervisors(application.submittedByUserId);
  const reasonLabel = SUPERVISOR_REASON_LABELS[reason] || reason;

  for (const supervisor of supervisors) {
    try {
      await prisma.notification.create({
        data: {
          userId: supervisor.id,
          type: "CRM_SUPERVISOR_REVIEW",
          title: "客户申请待复核",
          content: `${application.name}（${application.organization || "-"}）提交了客户申请，原因：${reasonLabel}`,
          link: `/crm/customer-applications?view=review`,
          dedupeKey: `crm-supervisor-review:${applicationId}:${supervisor.id}`,
        },
      });
    } catch (e: unknown) {
      const isDup = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
      if (!isDup) console.error(`Failed to notify supervisor ${supervisor.id} for application ${applicationId}:`, e);
    }
  }
}

/**
 * Create in-app notifications for pending org binding review.
 */
export async function notifyBindingReviewers(
  bindingId: string,
  representativeId: string,
  orgName: string,
): Promise<void> {
  const reviewers = await resolveBindingReviewers(representativeId);

  for (const reviewer of reviewers) {
    try {
      await prisma.notification.create({
        data: {
          userId: reviewer.id,
          type: "CRM_ORG_BINDING_REVIEW",
          title: "单位绑定申请",
          content: `代表申请负责单位「${orgName}」，请审核`,
          link: `/admin/representative-organizations`,
          dedupeKey: `org-binding-review:${bindingId}:${reviewer.id}`,
        },
      });
    } catch (e: unknown) {
      const isDup = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
      if (!isDup) console.error(`Failed to notify binding reviewer ${reviewer.id} for binding ${bindingId}:`, e);
    }
  }
}
