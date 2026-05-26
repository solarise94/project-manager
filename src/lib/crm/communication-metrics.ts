import { prisma } from "@/lib/prisma";
import { CRM_COMMUNICATION_TASK_SOURCE_TYPES, CRM_EFFECTIVE_INTERACTION_TYPES } from "@/lib/crm/constants";
import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CrmCommunicationMetrics = {
  assignedCustomerCount: number;
  dueCommunicationTaskCount: number;
  doneCommunicationTaskCount: number;
  overdueCommunicationTaskCount: number;
  communicatedCustomerCount: number;
  communicationTaskCompletionRate: number;
  communicationCoverageRate: number;
};

export async function getCrmCommunicationMetrics(
  params: {
    ownerUserIds?: string[];
    profileIds?: string[];
    from: Date;
    to: Date;
  },
  db: DbClient = prisma,
): Promise<CrmCommunicationMetrics> {
  const ownerUserIds = params.ownerUserIds?.filter(Boolean) ?? [];
  const profileIds = params.profileIds?.filter(Boolean) ?? [];

  const profileWhere: Prisma.CrmCustomerProfileWhereInput = {};
  if (ownerUserIds.length > 0) profileWhere.ownerUserId = { in: ownerUserIds };
  if (profileIds.length > 0) profileWhere.id = { in: profileIds };
  profileWhere.archived = false;
  profileWhere.assignmentStatus = "ASSIGNED";

  const profiles = await db.crmCustomerProfile.findMany({
    where: profileWhere,
    select: { id: true },
  });
  const scopedProfileIds = profiles.map((profile) => profile.id);
  if (scopedProfileIds.length === 0) {
    return {
      assignedCustomerCount: 0,
      dueCommunicationTaskCount: 0,
      doneCommunicationTaskCount: 0,
      overdueCommunicationTaskCount: 0,
      communicatedCustomerCount: 0,
      communicationTaskCompletionRate: 0,
      communicationCoverageRate: 0,
    };
  }

  const now = new Date();
  const [dueCommunicationTaskCount, doneCommunicationTaskCount, overdueCommunicationTaskCount, communicatedInteractions] = await Promise.all([
    db.crmFollowUpTask.count({
      where: {
        profileId: { in: scopedProfileIds },
        sourceType: { in: CRM_COMMUNICATION_TASK_SOURCE_TYPES as unknown as string[] },
        status: { in: ["OPEN", "DONE", "EXPIRED"] },
        dueAt: { gte: params.from, lt: params.to },
      },
    }),
    db.crmFollowUpTask.count({
      where: {
        profileId: { in: scopedProfileIds },
        sourceType: { in: CRM_COMMUNICATION_TASK_SOURCE_TYPES as unknown as string[] },
        status: "DONE",
        completedAt: { gte: params.from, lt: params.to },
      },
    }),
    db.crmFollowUpTask.count({
      where: {
        profileId: { in: scopedProfileIds },
        sourceType: { in: CRM_COMMUNICATION_TASK_SOURCE_TYPES as unknown as string[] },
        status: "OPEN",
        dueAt: { lt: now },
      },
    }),
    db.crmInteraction.findMany({
      where: {
        profileId: { in: scopedProfileIds },
        type: { in: CRM_EFFECTIVE_INTERACTION_TYPES as unknown as string[] },
        happenedAt: { gte: params.from, lt: params.to },
      },
      select: { profileId: true },
      distinct: ["profileId"],
    }),
  ]);

  const communicatedCustomerCount = communicatedInteractions.length;
  return {
    assignedCustomerCount: scopedProfileIds.length,
    dueCommunicationTaskCount,
    doneCommunicationTaskCount,
    overdueCommunicationTaskCount,
    communicatedCustomerCount,
    communicationTaskCompletionRate: dueCommunicationTaskCount > 0
      ? doneCommunicationTaskCount / dueCommunicationTaskCount
      : 0,
    communicationCoverageRate: scopedProfileIds.length > 0
      ? communicatedCustomerCount / scopedProfileIds.length
      : 0,
  };
}

