import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveCrmVisibleProfileIds, assertCrmProfileAccess, isRegionalManagerRole, isRepresentativeRole } from "@/lib/crm/permissions";
import { registerAgentAction } from "../registry";
import { AgentActionForbiddenError, AgentActionNotFoundError } from "../errors";
import { arraySchema, clampLimit, ensureObject, integerSchema, objectSchema, readOptionalInteger, readOptionalString, readRequiredString, stringSchema } from "../schemas";

function inputSchema() {
  return objectSchema({
    query: stringSchema("关键词，可匹配客户名、编号、机构、负责人"),
    stage: stringSchema("CRM 阶段"),
    limit: integerSchema("返回条数，默认 10，最大 30", { minimum: 1, maximum: 30 }),
  });
}

function outputSchema() {
  return objectSchema({
    items: {
      type: "array",
      items: objectSchema({
        profileId: stringSchema(),
        customerId: stringSchema(),
        customerName: stringSchema(),
        stage: stringSchema(),
        importance: stringSchema(),
      }),
    },
  });
}

function createFollowUpInputSchema() {
  return objectSchema({
    profileId: stringSchema("CRM profile ID"),
    ownerUserId: stringSchema("负责人用户 ID，销售本人会忽略该字段"),
    title: stringSchema("跟进任务标题"),
    dueAt: stringSchema("截止时间，ISO 时间字符串"),
  }, ["profileId", "title", "dueAt"]);
}

function createFollowUpOutputSchema() {
  return objectSchema({
    task: objectSchema({
      id: stringSchema(),
      profileId: stringSchema(),
      customerName: stringSchema(),
      ownerUserId: stringSchema(),
      title: stringSchema(),
      status: stringSchema(),
      dueAt: stringSchema(),
    }),
    notifications: arraySchema(stringSchema()),
  });
}

export function registerCrmActions() {
  registerAgentAction({
    key: "crm.search_customers",
    title: "搜索 CRM 客户",
    description: "搜索当前用户可见的 CRM 客户资料和客户基础信息。",
    domain: "crm",
    riskLevel: "safe",
    readOnly: true,
    inputSchema: inputSchema(),
    outputSchema: outputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return {
        query: readOptionalString(input, "query"),
        stage: readOptionalString(input, "stage"),
        limit: clampLimit(readOptionalInteger(input, "limit", { min: 1, max: 30 }), 10, 30),
      };
    },
    async availability() {
      return true;
    },
    async execute(actor, input) {
      const visibleProfileIds = await getEffectiveCrmVisibleProfileIds(actor.userId, actor.role);
      const andConditions: Prisma.CrmCustomerProfileWhereInput[] = [{ archived: false }];
      if (visibleProfileIds) {
        andConditions.push({ id: { in: [...visibleProfileIds] } });
      }

      if (input.stage) {
        andConditions.push({ stage: input.stage });
      }

      if (input.query) {
        andConditions.push({
          OR: [
            { sourceCustomer: { name: { contains: input.query } } },
            { sourceCustomer: { customerCode: { contains: input.query } } },
            { sourceCustomer: { organization: { contains: input.query } } },
            { sourceCustomer: { principal: { contains: input.query } } },
            { summary: { contains: input.query } },
          ],
        });
      }

      const profiles = await prisma.crmCustomerProfile.findMany({
        where: { AND: andConditions },
        take: input.limit,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          stage: true,
          importance: true,
          lastFollowUpAt: true,
          sourceCustomer: {
            select: {
              id: true,
              name: true,
              organization: true,
            },
          },
          ownerUser: { select: { name: true } },
          _count: { select: { followUpTasks: true, interactions: true } },
        },
      });

      return {
        items: profiles.map((profile) => ({
          profileId: profile.id,
          customerId: profile.sourceCustomer.id,
          customerName: profile.sourceCustomer.name,
          organization: profile.sourceCustomer.organization,
          stage: profile.stage,
          importance: profile.importance,
          ownerName: profile.ownerUser.name,
          lastInteractionAt: profile.lastFollowUpAt?.toISOString() ?? null,
          followUpCount: profile._count.followUpTasks,
          interactionCount: profile._count.interactions,
        })),
      };
    },
  });

  registerAgentAction({
    key: "crm.create_followup_task",
    title: "创建 CRM 跟进任务",
    description: "为指定 CRM 客户资料创建待确认的跟进任务。",
    domain: "crm",
    riskLevel: "confirm",
    readOnly: false,
    inputSchema: createFollowUpInputSchema(),
    outputSchema: createFollowUpOutputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return {
        profileId: readRequiredString(input, "profileId"),
        ownerUserId: readOptionalString(input, "ownerUserId"),
        title: readRequiredString(input, "title"),
        dueAt: readRequiredString(input, "dueAt"),
      };
    },
    async availability() {
      return true;
    },
    async buildProposal(actor, input) {
      const profile = await prisma.crmCustomerProfile.findUnique({
        where: { id: input.profileId },
        select: {
          id: true,
          ownerUserId: true,
          assignmentStatus: true,
          sourceCustomer: { select: { name: true } },
        },
      });
      if (!profile) {
        throw new AgentActionNotFoundError(input.profileId);
      }

      if (isRepresentativeRole(actor.role) || isRegionalManagerRole(actor.role)) {
        try {
          await assertCrmProfileAccess(input.profileId, actor.userId, actor.role);
        } catch {
          throw new AgentActionForbiddenError();
        }
      }

      const finalOwner = isRepresentativeRole(actor.role) ? actor.userId : (input.ownerUserId || actor.userId);
      return {
        title: `创建跟进任务：${input.title}`,
        summary: `客户「${profile.sourceCustomer.name}」将新增一条跟进任务，截止时间 ${new Date(input.dueAt).toLocaleString("zh-CN")}，负责人用户 ID 为 ${finalOwner}。`,
        target: { type: "crm_profile", id: profile.id },
      };
    },
    async execute(actor, input) {
      const profile = await prisma.crmCustomerProfile.findUnique({
        where: { id: input.profileId },
        select: {
          id: true,
          ownerUserId: true,
          assignmentStatus: true,
          sourceCustomer: { select: { id: true, name: true } },
        },
      });
      if (!profile) {
        throw new AgentActionNotFoundError(input.profileId);
      }

      if (isRepresentativeRole(actor.role) || isRegionalManagerRole(actor.role)) {
        try {
          await assertCrmProfileAccess(input.profileId, actor.userId, actor.role);
        } catch {
          throw new AgentActionForbiddenError();
        }
      }

      let finalOwner = input.ownerUserId || actor.userId;
      if (isRepresentativeRole(actor.role)) {
        finalOwner = actor.userId;
      } else if (isRegionalManagerRole(actor.role) && input.ownerUserId) {
        const { getRegionalManagerUserIds } = await import("@/lib/crm/permissions");
        const repUserIds = await getRegionalManagerUserIds(actor.userId);
        const allowedIds = repUserIds && repUserIds.length > 0 ? [actor.userId, ...repUserIds] : [actor.userId];
        if (!allowedIds.includes(input.ownerUserId)) {
          throw new AgentActionForbiddenError();
        }
      }

      const task = await prisma.$transaction(async (tx) => {
        const created = await tx.crmFollowUpTask.create({
          data: {
            profileId: input.profileId,
            ownerUserId: finalOwner,
            title: input.title,
            dueAt: new Date(input.dueAt),
            createdByUserId: actor.userId,
          },
        });

        const earliestOpen = await tx.crmFollowUpTask.findFirst({
          where: { profileId: input.profileId, status: "OPEN" },
          orderBy: { dueAt: "asc" },
        });
        await tx.crmCustomerProfile.update({
          where: { id: input.profileId },
          data: { nextFollowUpAt: earliestOpen?.dueAt ?? null },
        });

        return created;
      });

      const notifications: string[] = [];
      if (finalOwner !== actor.userId) {
        const dueDateStr = new Date(input.dueAt).toLocaleDateString("zh-CN");
        prisma.notification.create({
          data: {
            userId: finalOwner,
            title: "有新的跟进任务",
            content: `客户 ${profile.sourceCustomer.name} 有新的跟进任务: ${input.title}，截止 ${dueDateStr}`,
            type: "CRM_FOLLOW_UP",
            link: `/crm/customers/${profile.sourceCustomer.id}`,
          },
        }).catch(() => {});
        notifications.push(`已通知用户 ${finalOwner}`);
      }

      return {
        task: {
          id: task.id,
          profileId: task.profileId,
          customerName: profile.sourceCustomer.name,
          ownerUserId: task.ownerUserId,
          title: task.title,
          status: task.status,
          dueAt: task.dueAt.toISOString(),
        },
        notifications,
      };
    },
    resolveTarget(_input, output) {
      return { type: "crm_follow_up_task", id: output.task.id };
    },
  });
}
