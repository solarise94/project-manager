import { prisma } from "@/lib/prisma";
import {
  CRM_COMMUNICATION_TASK_SOURCE_TYPES,
  CRM_DORMANT_THRESHOLD_DAYS,
  CRM_DORMANT_WARNING_DAYS,
  CRM_EFFECTIVE_INTERACTION_TYPES,
} from "@/lib/crm/constants";
import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type OrderAggregate = {
  validOrderCount: number;
  validOrderAmount: number;
  lastOrderAt: Date | null;
};

type InteractionAggregate = {
  lastEffectiveInteractionAt: Date | null;
};

type CommunicationTaskAggregate = {
  nextCommunicationTaskAt: Date | null;
  openCommunicationTaskCount: number;
  overdueCommunicationTaskCount: number;
  dueCommunicationTaskCount30d: number;
  doneCommunicationTaskCount30d: number;
};

export type CrmLifecycleSummary = {
  customerId: string;
  profileId: string;
  stage: string;
  ownerUserId: string;
  assignedAt: Date | null;
  createdAt: Date;
  lastFollowUpAt: Date | null;
  validOrderCount: number;
  validOrderAmount: number;
  lastOrderAt: Date | null;
  isRepeatCustomer: boolean;
  lastEffectiveInteractionAt: Date | null;
  nextCommunicationTaskAt: Date | null;
  openCommunicationTaskCount: number;
  overdueCommunicationTaskCount: number;
  dueCommunicationTaskCount30d: number;
  doneCommunicationTaskCount30d: number;
  dormantRisk: boolean;
  dormantCandidate: boolean;
};

export type CrmLifecycleSyncResult = {
  profileId: string;
  customerId: string;
  previousStage: string;
  nextStage: string;
  validOrderCount: number;
  lastOrderAt: Date | null;
  changed: boolean;
};

const EFFECTIVE_INTERACTION_TYPE_SET = new Set<string>(CRM_EFFECTIVE_INTERACTION_TYPES);
const COMMUNICATION_TASK_SOURCE_TYPE_SET = new Set<string>(CRM_COMMUNICATION_TASK_SOURCE_TYPES);

function subtractDays(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function resolveOrderRefDate(order: {
  orderedAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
}) {
  return order.orderedAt ?? order.confirmedAt ?? order.createdAt;
}

export async function getCrmLifecycleSummaryByCustomerId(
  customerId: string,
  db: DbClient = prisma,
): Promise<CrmLifecycleSummary | null> {
  const profile = await db.crmCustomerProfile.findUnique({
    where: { sourceCustomerId: customerId },
    select: {
      id: true,
      sourceCustomerId: true,
      ownerUserId: true,
      stage: true,
      assignedAt: true,
      createdAt: true,
      lastFollowUpAt: true,
      archived: true,
      assignmentStatus: true,
    },
  });
  if (!profile || profile.archived) return null;

  const [orderAgg, interactionAgg, taskAgg] = await Promise.all([
    getOrderAggregate(customerId, db),
    getInteractionAggregate(profile.id, db),
    getCommunicationTaskAggregate(profile.id, db),
  ]);

  const dormantWarningDate = subtractDays(CRM_DORMANT_WARNING_DAYS);
  const dormantThresholdDate = subtractDays(CRM_DORMANT_THRESHOLD_DAYS);
  const dormantBaseAt = profile.lastFollowUpAt ?? profile.assignedAt ?? profile.createdAt;
  const dormantRisk = orderAgg.validOrderCount === 0
    && profile.assignmentStatus === "ASSIGNED"
    && ["NEW", "CONTACTED", "FOLLOWING", "DORMANT"].includes(profile.stage)
    && dormantBaseAt < dormantWarningDate;
  const dormantCandidate = orderAgg.validOrderCount === 0
    && profile.assignmentStatus === "ASSIGNED"
    && ["NEW", "CONTACTED", "FOLLOWING", "DORMANT"].includes(profile.stage)
    && dormantBaseAt < dormantThresholdDate;

  return {
    customerId: profile.sourceCustomerId,
    profileId: profile.id,
    stage: profile.stage,
    ownerUserId: profile.ownerUserId,
    assignedAt: profile.assignedAt,
    createdAt: profile.createdAt,
    lastFollowUpAt: profile.lastFollowUpAt,
    validOrderCount: orderAgg.validOrderCount,
    validOrderAmount: orderAgg.validOrderAmount,
    lastOrderAt: orderAgg.lastOrderAt,
    isRepeatCustomer: orderAgg.validOrderCount >= 2,
    lastEffectiveInteractionAt: interactionAgg.lastEffectiveInteractionAt,
    nextCommunicationTaskAt: taskAgg.nextCommunicationTaskAt,
    openCommunicationTaskCount: taskAgg.openCommunicationTaskCount,
    overdueCommunicationTaskCount: taskAgg.overdueCommunicationTaskCount,
    dueCommunicationTaskCount30d: taskAgg.dueCommunicationTaskCount30d,
    doneCommunicationTaskCount30d: taskAgg.doneCommunicationTaskCount30d,
    dormantRisk,
    dormantCandidate,
  };
}

export async function getCrmLifecycleSummariesForCustomers(
  customerIds: string[],
  db: DbClient = prisma,
): Promise<Map<string, CrmLifecycleSummary>> {
  const uniqueIds = [...new Set(customerIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const profiles = await db.crmCustomerProfile.findMany({
    where: {
      sourceCustomerId: { in: uniqueIds },
      archived: false,
    },
    select: {
      id: true,
      sourceCustomerId: true,
      ownerUserId: true,
      stage: true,
      assignedAt: true,
      createdAt: true,
      lastFollowUpAt: true,
      assignmentStatus: true,
    },
  });
  if (profiles.length === 0) return new Map();

  const profileIds = profiles.map((profile) => profile.id);
  const now = new Date();
  const d30 = subtractDays(30);
  const dormantWarningDate = subtractDays(CRM_DORMANT_WARNING_DAYS);
  const dormantThresholdDate = subtractDays(CRM_DORMANT_THRESHOLD_DAYS);

  const [orders, interactions, openTasks, doneTasks30d] = await Promise.all([
    db.order.findMany({
      where: {
        customerId: { in: uniqueIds },
        deleted: false,
        archived: false,
        status: { in: ["CONFIRMED", "CLOSED"] },
      },
      select: {
        customerId: true,
        orderedAt: true,
        confirmedAt: true,
        createdAt: true,
        totalAmount: true,
        financeAmountOverride: true,
      },
    }),
    db.crmInteraction.findMany({
      where: {
        profileId: { in: profileIds },
        type: { in: CRM_EFFECTIVE_INTERACTION_TYPES as unknown as string[] },
      },
      select: {
        profileId: true,
        happenedAt: true,
      },
      orderBy: { happenedAt: "desc" },
    }),
    db.crmFollowUpTask.findMany({
      where: {
        profileId: { in: profileIds },
        status: "OPEN",
        sourceType: { in: CRM_COMMUNICATION_TASK_SOURCE_TYPES as unknown as string[] },
      },
      select: {
        profileId: true,
        dueAt: true,
      },
      orderBy: { dueAt: "asc" },
    }),
    db.crmFollowUpTask.findMany({
      where: {
        profileId: { in: profileIds },
        status: "DONE",
        sourceType: { in: CRM_COMMUNICATION_TASK_SOURCE_TYPES as unknown as string[] },
        completedAt: { gte: d30 },
      },
      select: {
        profileId: true,
      },
    }),
  ]);

  const orderAggMap = new Map<string, OrderAggregate>();
  for (const order of orders) {
    if (!order.customerId) continue;
    const current = orderAggMap.get(order.customerId) ?? {
      validOrderCount: 0,
      validOrderAmount: 0,
      lastOrderAt: null,
    };
    current.validOrderCount += 1;
    current.validOrderAmount += order.financeAmountOverride ?? order.totalAmount ?? 0;
    const refDate = resolveOrderRefDate(order);
    if (!current.lastOrderAt || refDate > current.lastOrderAt) current.lastOrderAt = refDate;
    orderAggMap.set(order.customerId, current);
  }

  const interactionMap = new Map<string, Date>();
  for (const interaction of interactions) {
    if (!interactionMap.has(interaction.profileId)) {
      interactionMap.set(interaction.profileId, interaction.happenedAt);
    }
  }

  const taskAggMap = new Map<string, CommunicationTaskAggregate>();
  for (const task of openTasks) {
    const current = taskAggMap.get(task.profileId) ?? {
      nextCommunicationTaskAt: null,
      openCommunicationTaskCount: 0,
      overdueCommunicationTaskCount: 0,
      dueCommunicationTaskCount30d: 0,
      doneCommunicationTaskCount30d: 0,
    };
    current.openCommunicationTaskCount += 1;
    if (!current.nextCommunicationTaskAt || task.dueAt < current.nextCommunicationTaskAt) {
      current.nextCommunicationTaskAt = task.dueAt;
    }
    if (task.dueAt < now) current.overdueCommunicationTaskCount += 1;
    if (task.dueAt >= d30 && task.dueAt <= now) current.dueCommunicationTaskCount30d += 1;
    taskAggMap.set(task.profileId, current);
  }
  for (const task of doneTasks30d) {
    const current = taskAggMap.get(task.profileId) ?? {
      nextCommunicationTaskAt: null,
      openCommunicationTaskCount: 0,
      overdueCommunicationTaskCount: 0,
      dueCommunicationTaskCount30d: 0,
      doneCommunicationTaskCount30d: 0,
    };
    current.doneCommunicationTaskCount30d += 1;
    taskAggMap.set(task.profileId, current);
  }

  const result = new Map<string, CrmLifecycleSummary>();
  for (const profile of profiles) {
    const orderAgg = orderAggMap.get(profile.sourceCustomerId) ?? {
      validOrderCount: 0,
      validOrderAmount: 0,
      lastOrderAt: null,
    };
    const taskAgg = taskAggMap.get(profile.id) ?? {
      nextCommunicationTaskAt: null,
      openCommunicationTaskCount: 0,
      overdueCommunicationTaskCount: 0,
      dueCommunicationTaskCount30d: 0,
      doneCommunicationTaskCount30d: 0,
    };
    const dormantBaseAt = profile.lastFollowUpAt ?? profile.assignedAt ?? profile.createdAt;
    result.set(profile.sourceCustomerId, {
      customerId: profile.sourceCustomerId,
      profileId: profile.id,
      stage: profile.stage,
      ownerUserId: profile.ownerUserId,
      assignedAt: profile.assignedAt,
      createdAt: profile.createdAt,
      lastFollowUpAt: profile.lastFollowUpAt,
      validOrderCount: orderAgg.validOrderCount,
      validOrderAmount: orderAgg.validOrderAmount,
      lastOrderAt: orderAgg.lastOrderAt,
      isRepeatCustomer: orderAgg.validOrderCount >= 2,
      lastEffectiveInteractionAt: interactionMap.get(profile.id) ?? null,
      nextCommunicationTaskAt: taskAgg.nextCommunicationTaskAt,
      openCommunicationTaskCount: taskAgg.openCommunicationTaskCount,
      overdueCommunicationTaskCount: taskAgg.overdueCommunicationTaskCount,
      dueCommunicationTaskCount30d: taskAgg.dueCommunicationTaskCount30d,
      doneCommunicationTaskCount30d: taskAgg.doneCommunicationTaskCount30d,
      dormantRisk: orderAgg.validOrderCount === 0
        && profile.assignmentStatus === "ASSIGNED"
        && ["NEW", "CONTACTED", "FOLLOWING", "DORMANT"].includes(profile.stage)
        && dormantBaseAt < dormantWarningDate,
      dormantCandidate: orderAgg.validOrderCount === 0
        && profile.assignmentStatus === "ASSIGNED"
        && ["NEW", "CONTACTED", "FOLLOWING", "DORMANT"].includes(profile.stage)
        && dormantBaseAt < dormantThresholdDate,
    });
  }

  return result;
}

export async function syncCrmLifecycleForCustomer(
  customerId: string,
  db: DbClient = prisma,
): Promise<CrmLifecycleSyncResult | null> {
  const summary = await getCrmLifecycleSummaryByCustomerId(customerId, db);
  if (!summary) return null;

  const previousStage = summary.stage;
  let nextStage = previousStage;

  if (summary.validOrderCount > 0) {
    nextStage = "ACTIVE";
  } else if (summary.dormantCandidate && ["NEW", "CONTACTED", "FOLLOWING", "DORMANT"].includes(previousStage)) {
    nextStage = "DORMANT";
  }

  const nextFollowUpAt = summary.nextCommunicationTaskAt;
  const changed = previousStage !== nextStage || summary.lastOrderAt !== null;

  await db.crmCustomerProfile.update({
    where: { id: summary.profileId },
    data: {
      stage: nextStage,
      lastOrderAt: summary.lastOrderAt,
      nextFollowUpAt,
    },
  });

  return {
    profileId: summary.profileId,
    customerId: summary.customerId,
    previousStage,
    nextStage,
    validOrderCount: summary.validOrderCount,
    lastOrderAt: summary.lastOrderAt,
    changed,
  };
}

export async function syncCrmLifecycleAfterInteraction(
  profileId: string,
  params: { happenedAt: Date; nextActionAt?: Date | null; actorUserId?: string | null },
  db: DbClient = prisma,
): Promise<void> {
  const profile = await db.crmCustomerProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      sourceCustomerId: true,
      stage: true,
      ownerUserId: true,
      assignmentStatus: true,
    },
  });
  if (!profile) return;

  let nextStage = profile.stage;
  if (profile.stage === "NEW" || profile.stage === "DORMANT") {
    nextStage = params.nextActionAt ? "FOLLOWING" : "CONTACTED";
  } else if (profile.stage === "CONTACTED" && params.nextActionAt) {
    nextStage = "FOLLOWING";
  }

  const taskData = params.nextActionAt
    ? {
        profileId,
        ownerUserId: profile.ownerUserId,
        title: "沟通后续跟进",
        dueAt: params.nextActionAt,
        createdByUserId: params.actorUserId || profile.ownerUserId,
        sourceType: "CRM_COMMUNICATION",
        sourceId: `${profileId}:${params.happenedAt.toISOString()}`,
        sourceOpenKey: `crm-communication:${profileId}:${params.happenedAt.toISOString()}`,
      }
    : null;

  if (taskData) {
    await db.crmFollowUpTask.upsert({
      where: { sourceOpenKey: taskData.sourceOpenKey },
      update: {
        dueAt: taskData.dueAt,
        title: taskData.title,
        ownerUserId: taskData.ownerUserId,
      },
      create: taskData,
    });
  }

  const nextCommunicationTask = await db.crmFollowUpTask.findFirst({
    where: {
      profileId,
      status: "OPEN",
      sourceType: { in: CRM_COMMUNICATION_TASK_SOURCE_TYPES as unknown as string[] },
    },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });

  await db.crmCustomerProfile.update({
    where: { id: profileId },
    data: {
      stage: ["BLOCKED", "LOST", "ACTIVE"].includes(profile.stage) ? profile.stage : nextStage,
      lastFollowUpAt: params.happenedAt,
      nextFollowUpAt: nextCommunicationTask?.dueAt ?? params.nextActionAt ?? null,
    },
  });

  await syncCrmLifecycleForCustomer(profile.sourceCustomerId, db);
}

export async function scanDormantCrmProfiles(
  params?: { dormantDays?: number; warningDays?: number; dryRun?: boolean; actorUserId?: string | null },
  db: DbClient = prisma,
): Promise<{ scannedCount: number; warnedCount: number; dormantCount: number }> {
  const dormantDays = params?.dormantDays ?? CRM_DORMANT_THRESHOLD_DAYS;
  const warningDays = params?.warningDays ?? CRM_DORMANT_WARNING_DAYS;
  const dryRun = params?.dryRun ?? false;
  const now = new Date();
  const dormantThresholdDate = new Date(now.getTime() - dormantDays * 24 * 60 * 60 * 1000);
  const warningThresholdDate = new Date(now.getTime() - warningDays * 24 * 60 * 60 * 1000);

  const profiles = await db.crmCustomerProfile.findMany({
    where: {
      archived: false,
      assignmentStatus: "ASSIGNED",
    },
    select: {
      id: true,
      sourceCustomerId: true,
      ownerUserId: true,
      stage: true,
      assignedAt: true,
      createdAt: true,
      lastFollowUpAt: true,
    },
  });

  let warnedCount = 0;
  let dormantCount = 0;
  for (const profile of profiles) {
    const summary = await getCrmLifecycleSummaryByCustomerId(profile.sourceCustomerId, db);
    if (!summary) continue;
    const baseAt = profile.lastFollowUpAt ?? profile.assignedAt ?? profile.createdAt;
    if (summary.validOrderCount > 0) continue;
    if (!["NEW", "CONTACTED", "FOLLOWING", "DORMANT"].includes(profile.stage)) continue;

    if (baseAt < dormantThresholdDate) {
      dormantCount += 1;
      if (!dryRun) {
        await db.crmCustomerProfile.update({
          where: { id: profile.id },
          data: { stage: "DORMANT", nextFollowUpAt: summary.nextCommunicationTaskAt },
        });
      }
      continue;
    }

    if (baseAt < warningThresholdDate) {
      warnedCount += 1;
      if (!dryRun) {
        await db.crmFollowUpTask.upsert({
          where: { sourceOpenKey: `crm-dormant-warning:${profile.id}` },
          update: {
            dueAt: now,
            title: "休眠预警跟进",
            ownerUserId: profile.ownerUserId,
            status: "OPEN",
          },
          create: {
            profileId: profile.id,
            ownerUserId: profile.ownerUserId,
            title: "休眠预警跟进",
            dueAt: now,
            sourceType: "CRM_DORMANT_WARNING",
            sourceId: profile.id,
            sourceOpenKey: `crm-dormant-warning:${profile.id}`,
            createdByUserId: params?.actorUserId || profile.ownerUserId,
          },
        });
      }
    }
  }

  return {
    scannedCount: profiles.length,
    warnedCount,
    dormantCount,
  };
}

export async function getOrderAggregate(
  customerId: string,
  db: DbClient = prisma,
): Promise<OrderAggregate> {
  const orders = await db.order.findMany({
    where: {
      customerId,
      deleted: false,
      archived: false,
      status: { in: ["CONFIRMED", "CLOSED"] },
    },
    select: {
      orderedAt: true,
      confirmedAt: true,
      createdAt: true,
      totalAmount: true,
      financeAmountOverride: true,
    },
  });

  let lastOrderAt: Date | null = null;
  let validOrderAmount = 0;
  for (const order of orders) {
    validOrderAmount += order.financeAmountOverride ?? order.totalAmount ?? 0;
    const refDate = resolveOrderRefDate(order);
    if (!lastOrderAt || refDate > lastOrderAt) lastOrderAt = refDate;
  }

  return {
    validOrderCount: orders.length,
    validOrderAmount,
    lastOrderAt,
  };
}

async function getInteractionAggregate(profileId: string, db: DbClient): Promise<InteractionAggregate> {
  const interaction = await db.crmInteraction.findFirst({
    where: {
      profileId,
      type: { in: CRM_EFFECTIVE_INTERACTION_TYPES as unknown as string[] },
    },
    orderBy: { happenedAt: "desc" },
    select: { happenedAt: true },
  });
  return {
    lastEffectiveInteractionAt: interaction?.happenedAt ?? null,
  };
}

async function getCommunicationTaskAggregate(profileId: string, db: DbClient): Promise<CommunicationTaskAggregate> {
  const now = new Date();
  const d30 = subtractDays(30);
  const [openTasks, doneCount30d] = await Promise.all([
    db.crmFollowUpTask.findMany({
      where: {
        profileId,
        status: "OPEN",
        sourceType: { in: CRM_COMMUNICATION_TASK_SOURCE_TYPES as unknown as string[] },
      },
      select: { dueAt: true },
      orderBy: { dueAt: "asc" },
    }),
    db.crmFollowUpTask.count({
      where: {
        profileId,
        status: "DONE",
        sourceType: { in: CRM_COMMUNICATION_TASK_SOURCE_TYPES as unknown as string[] },
        completedAt: { gte: d30 },
      },
    }),
  ]);

  let overdueCommunicationTaskCount = 0;
  let dueCommunicationTaskCount30d = 0;
  for (const task of openTasks) {
    if (task.dueAt < now) overdueCommunicationTaskCount += 1;
    if (task.dueAt >= d30 && task.dueAt <= now) dueCommunicationTaskCount30d += 1;
  }

  return {
    nextCommunicationTaskAt: openTasks[0]?.dueAt ?? null,
    openCommunicationTaskCount: openTasks.length,
    overdueCommunicationTaskCount,
    dueCommunicationTaskCount30d,
    doneCommunicationTaskCount30d: doneCount30d,
  };
}

export function isEffectiveInteractionType(type: string) {
  return EFFECTIVE_INTERACTION_TYPE_SET.has(type);
}

export function isCommunicationTaskSourceType(sourceType: string | null | undefined) {
  return !!sourceType && COMMUNICATION_TASK_SOURCE_TYPE_SET.has(sourceType);
}
