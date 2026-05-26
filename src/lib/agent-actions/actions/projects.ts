import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canReadProject, getReadableProjectIds } from "@/lib/permissions";
import { getCustomerOrganizationName } from "@/lib/customer-organization";
import { isDraftAIConfigured } from "@/lib/draft/providers";
import { runProjectAutoDraft } from "../draft-helpers";
import { AgentActionForbiddenError, AgentActionNotFoundError } from "../errors";
import { registerAgentAction } from "../registry";
import { clampLimit, ensureObject, integerSchema, objectSchema, readOptionalInteger, readOptionalString, readRequiredString, stringSchema } from "../schemas";

function projectSearchInputSchema() {
  return objectSchema({
    query: stringSchema("关键词，可匹配项目名、描述、客户名、代表"),
    status: stringSchema("项目状态"),
    limit: integerSchema("返回条数，默认 10，最大 30", { minimum: 1, maximum: 30 }),
  });
}

function projectSearchOutputSchema() {
  return objectSchema({
    items: {
      type: "array",
      items: objectSchema({
        id: stringSchema(),
        name: stringSchema(),
        status: stringSchema(),
        customerName: stringSchema(),
        representative: stringSchema(),
        updatedAt: stringSchema(),
      }),
    },
  });
}

function projectSummaryInputSchema() {
  return objectSchema({
    projectId: stringSchema("项目 ID"),
  }, ["projectId"]);
}

function projectSummaryOutputSchema() {
  return objectSchema({
    project: objectSchema({
      id: stringSchema(),
      name: stringSchema(),
      status: stringSchema(),
      customerName: stringSchema(),
      representative: stringSchema(),
      updatedAt: stringSchema(),
    }),
    counts: objectSchema({
      tickets: integerSchema(),
      comments: integerSchema(),
      attachments: integerSchema(),
      linkedOrders: integerSchema(),
      members: integerSchema(),
    }),
    recentTickets: {
      type: "array",
      items: objectSchema({
        id: stringSchema(),
        title: stringSchema(),
        status: stringSchema(),
        updatedAt: stringSchema(),
      }),
    },
  });
}

function projectDraftInputSchema() {
  return objectSchema({
    text: stringSchema("原始文本输入"),
    projectId: stringSchema("可选，已有项目 ID"),
    formMode: stringSchema("create 或 edit"),
  }, ["text"]);
}

function projectDraftOutputSchema() {
  return objectSchema({
    formKey: stringSchema(),
    summary: stringSchema(),
    draft: {
      type: "object",
      additionalProperties: true,
    },
    warnings: {
      type: "array",
      items: stringSchema(),
    },
  });
}

export function registerProjectActions() {
  registerAgentAction({
    key: "projects.search",
    title: "搜索项目",
    description: "按关键词和状态搜索当前用户可见的项目。",
    domain: "projects",
    riskLevel: "safe",
    readOnly: true,
    inputSchema: projectSearchInputSchema(),
    outputSchema: projectSearchOutputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return {
        query: readOptionalString(input, "query"),
        status: readOptionalString(input, "status"),
        limit: clampLimit(readOptionalInteger(input, "limit", { min: 1, max: 30 }), 10, 30),
      };
    },
    async availability() {
      return true;
    },
    async execute(actor, input) {
      const isAdmin = actor.role === "ADMIN";
      const readableIds = isAdmin ? null : await getReadableProjectIds(actor.userId, actor.role);
      if (!isAdmin && (!readableIds || readableIds.length === 0)) {
        return { items: [] };
      }

      const andConditions: Prisma.ProjectWhereInput[] = [{ deleted: false }];
      if (readableIds) {
        andConditions.push({ id: { in: readableIds } });
      }
      if (input.status) {
        andConditions.push({ status: input.status });
      }
      if (input.query) {
        andConditions.push({
          OR: [
            { name: { contains: input.query } },
            { description: { contains: input.query } },
            { client: { contains: input.query } },
            { organization: { contains: input.query } },
            { representative: { contains: input.query } },
            { cust: { is: { name: { contains: input.query } } } },
          ],
        });
      }

      const projects = await prisma.project.findMany({
        where: { AND: andConditions },
        take: input.limit,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          representative: true,
          updatedAt: true,
          cust: {
            select: {
              name: true,
              organization: true,
              org: { select: { canonicalName: true } },
            },
          },
        },
      });

      return {
        items: projects.map((project) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          customerName: project.cust?.name ?? null,
          representative: project.representative ?? null,
          updatedAt: project.updatedAt.toISOString(),
          customerOrganization: project.cust
            ? getCustomerOrganizationName({ organization: project.cust.organization, org: project.cust.org })
            : null,
        })),
      };
    },
  });

  registerAgentAction({
    key: "projects.get_summary",
    title: "查看项目摘要",
    description: "读取单个项目的概览、数量统计和最近工单。",
    domain: "projects",
    riskLevel: "safe",
    readOnly: true,
    inputSchema: projectSummaryInputSchema(),
    outputSchema: projectSummaryOutputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return { projectId: readRequiredString(input, "projectId") };
    },
    async availability() {
      return true;
    },
    async execute(actor, input) {
      const readable = await canReadProject(input.projectId, actor.userId, actor.role);
      if (!readable) {
        throw new AgentActionForbiddenError();
      }

      const limitedSalesView = actor.role === "REPRESENTATIVE";

      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: {
          id: true,
          name: true,
          status: true,
          representative: true,
          updatedAt: true,
          client: true,
          cust: {
            select: {
              name: true,
              organization: true,
              org: { select: { canonicalName: true } },
            },
          },
          _count: {
            select: {
              tickets: true,
              comments: true,
              attachments: true,
              members: true,
              orderLinks: true,
            },
          },
          tickets: {
            take: 5,
            orderBy: { updatedAt: "desc" },
            select: { id: true, title: true, status: true, updatedAt: true },
          },
        },
      });

      if (!project) {
        throw new AgentActionNotFoundError(input.projectId);
      }

      return {
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          customerName: project.cust?.name ?? project.client ?? null,
          representative: project.representative ?? null,
          updatedAt: project.updatedAt.toISOString(),
          customerOrganization: project.cust
            ? getCustomerOrganizationName({ organization: project.cust.organization, org: project.cust.org })
            : null,
        },
        counts: {
          tickets: limitedSalesView ? 0 : project._count.tickets,
          comments: limitedSalesView ? 0 : project._count.comments,
          attachments: limitedSalesView ? 0 : project._count.attachments,
          linkedOrders: project._count.orderLinks,
          members: project._count.members,
        },
        recentTickets: limitedSalesView
          ? []
          : project.tickets.map((ticket) => ({
              id: ticket.id,
              title: ticket.title,
              status: ticket.status,
              updatedAt: ticket.updatedAt.toISOString(),
            })),
      };
    },
  });

  registerAgentAction({
    key: "projects.draft_from_text",
    title: "从文本生成项目草稿",
    description: "调用现有 AI 草稿编排器，从文本提取项目字段草稿。",
    domain: "projects",
    riskLevel: "safe",
    readOnly: true,
    inputSchema: projectDraftInputSchema(),
    outputSchema: projectDraftOutputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return {
        text: readRequiredString(input, "text"),
        projectId: readOptionalString(input, "projectId"),
        formMode: readOptionalString(input, "formMode"),
      };
    },
    async availability() {
      return isDraftAIConfigured();
    },
    async execute(actor, input) {
      const formKey = input.formMode === "edit" || input.projectId
        ? "project.edit"
        : "project.create";
      const drafted = await runProjectAutoDraft(actor, formKey, input.text, input.projectId);
      return {
        formKey,
        summary: drafted.summary || "已生成项目草稿",
        draft: drafted.draft,
        warnings: drafted.warnings || [],
      };
    },
  });
}
