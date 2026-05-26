import { prisma } from "@/lib/prisma";
import {
  CRM_COMMUNICATION_TASK_SOURCE_TYPES,
  CRM_DORMANT_THRESHOLD_DAYS,
  CRM_DORMANT_WARNING_DAYS,
  CRM_EFFECTIVE_INTERACTION_TYPES,
} from "@/lib/crm/constants";
import { Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type OrderAggregate = {
  validOrderCount: number;
  validOrderAmount: number;
  lastOrderAt: Date | null;
  firstOrderAt: Date | null;
};

/**
 * Prisma SQLite $queryRaw 返回类型：
 * - COUNT(*) / SUM() → bigint（SQLite 整数）
 * - MAX(DateTime 列) → string（ISO 8601 或遗留格式）
 */
type OrderAggregateRow = {
  customerId: string | null;
  validOrderCount: bigint;
  validOrderAmount: bigint | null;
  lastOrderAt: string | null;
  firstOrderAt: string | null;
};

function normalizeNumber(value: bigint | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}

function normalizeDate(value: Date | string | number | bigint | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "bigint") return new Date(Number(value));
  if (typeof value === "number") return new Date(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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
  firstOrderAt: Date | null;
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

function isSameDateTime(left: Date | null, right: Date | null) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.getTime() === right.getTime();
}

async function getOrderAggregatesForCustomers(
  customerIds: string[],
  db: DbClient = prisma,
): Promise<Map<string, OrderAggregate>> {
  const uniqueIds = [...new Set(customerIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const rows = await db.$queryRaw<OrderAggregateRow[]>(Prisma.sql`
    SELECT
      "customerId" AS "customerId",
      COUNT(*) AS "validOrderCount",
      SUM(COALESCE("financeAmountOverride", "totalAmount", 0)) AS "validOrderAmount",
      MAX(COALESCE("orderedAt", "confirmedAt", "createdAt")) AS "lastOrderAt",
      MIN(COALESCE("orderedAt", "confirmedAt", "createdAt")) AS "firstOrderAt"
    FROM "Order"
    WHERE "customerId" IN (${Prisma.join(uniqueIds)})
      AND "deleted" = ${false}
      AND "archived" = ${false}
      AND "status" IN (${Prisma.join(["CONFIRMED", "CLOSED"])})
    GROUP BY "customerId"
  `);

  return new Map(
    rows
      .filter((row): row is OrderAggregateRow & { customerId: string } => Boolean(row.customerId))
      .map((row) => [
        row.customerId,
        {
          validOrderCount: normalizeNumber(row.validOrderCount),
          validOrderAmount: normalizeNumber(row.validOrderAmount),
          lastOrderAt: normalizeDate(row.lastOrderAt),
          firstOrderAt: normalizeDate(row.firstOrderAt),
        },
      ]),
  );
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
    firstOrderAt: orderAgg.firstOrderAt,
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

  const [orderAggMap, interactions, openTasks, doneTasks30d] = await Promise.all([
    getOrderAggregatesForCustomers(uniqueIds, db),
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
      firstOrderAt: null,
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
      firstOrderAt: orderAgg.firstOrderAt,
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
  const currentProfile = await db.crmCustomerProfile.findUnique({
    where: { id: summary.profileId },
    select: { lastOrderAt: true, nextFollowUpAt: true },
  });
  const changed = previousStage !== nextStage
    || !isSameDateTime(currentProfile?.lastOrderAt ?? null, summary.lastOrderAt)
    || !isSameDateTime(currentProfile?.nextFollowUpAt ?? null, nextFollowUpAt);

  if (!changed) {
    return {
      profileId: summary.profileId,
      customerId: summary.customerId,
      previousStage,
      nextStage,
      validOrderCount: summary.validOrderCount,
      lastOrderAt: summary.lastOrderAt,
      changed: false,
    };
  }

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

export async function syncCrmLifecycleForCustomersBestEffort(
  customerIds: Iterable<string>,
  context: string,
  db: DbClient = prisma,
): Promise<void> {
  const uniqueCustomerIds = [...new Set(Array.from(customerIds).filter(Boolean))];

  for (const customerId of uniqueCustomerIds) {
    try {
      await syncCrmLifecycleForCustomer(customerId, db);
    } catch (error) {
      console.error(`[CRM][LIFECYCLE] ${context} failed for customer ${customerId}:`, error);
    }
  }
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
  const lifecycleMap = await getCrmLifecycleSummariesForCustomers(
    profiles.map((profile) => profile.sourceCustomerId),
    db,
  );

  for (const profile of profiles) {
    const summary = lifecycleMap.get(profile.sourceCustomerId);
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
  return getOrderAggregatesForCustomers([customerId], db).then(
    (aggregates) => aggregates.get(customerId) ?? { validOrderCount: 0, validOrderAmount: 0, lastOrderAt: null },
  );
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
