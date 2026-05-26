import { prisma } from "@/lib/prisma";
import { canContributeProject, canReadProject } from "@/lib/permissions";
import { isDraftAIConfigured } from "@/lib/draft/providers";
import { runProjectAutoDraft } from "../draft-helpers";
import { AgentActionForbiddenError, AgentActionNotFoundError } from "../errors";
import { registerAgentAction } from "../registry";
import { ensureObject, objectSchema, readOptionalString, readRequiredString, stringSchema } from "../schemas";

type TicketTextDraftInput = {
  text: string;
  projectId: string;
  assigneeId?: string;
  reminderDate?: string;
};

type TicketProposalExecutionInput = {
  projectId: string;
  title: string;
  description: string;
  priority: string;
  assigneeId?: string | null;
  reminderDate?: string | null;
  draft?: unknown;
  warnings?: unknown[];
};

type TicketActionInput = TicketTextDraftInput | TicketProposalExecutionInput;

function createTicketFromTextInputSchema() {
  return objectSchema({
    text: stringSchema("原始文本输入"),
    projectId: stringSchema("项目 ID"),
    assigneeId: stringSchema("可选，指派用户 ID"),
    reminderDate: stringSchema("可选，提醒时间 ISO 字符串"),
  }, ["text", "projectId"]);
}

function createTicketFromTextOutputSchema() {
  return objectSchema({
    ticket: objectSchema({
      id: stringSchema(),
      projectId: stringSchema(),
      title: stringSchema(),
      status: stringSchema(),
      priority: stringSchema(),
    }),
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

export function registerTicketActions() {
  registerAgentAction({
    key: "tickets.create_from_text",
    title: "从文本创建工单",
    description: "先用现有 AI 草稿编排器提取工单字段，再走 proposal / confirm 创建工单。",
    domain: "tickets",
    riskLevel: "confirm",
    readOnly: false,
    inputSchema: createTicketFromTextInputSchema(),
    outputSchema: createTicketFromTextOutputSchema(),
    parseInput(raw): TicketActionInput {
      const input = ensureObject(raw);
      const projectId = readRequiredString(input, "projectId");
      const title = readOptionalString(input, "title");
      if (title) {
        return {
          projectId,
          title,
          description: readOptionalString(input, "description") || "",
          priority: readOptionalString(input, "priority") || "MEDIUM",
          assigneeId: readOptionalString(input, "assigneeId"),
          reminderDate: readOptionalString(input, "reminderDate"),
          draft: input.draft,
          warnings: Array.isArray(input.warnings) ? input.warnings : [],
        };
      }

      return {
        text: readRequiredString(input, "text"),
        projectId,
        assigneeId: readOptionalString(input, "assigneeId"),
        reminderDate: readOptionalString(input, "reminderDate"),
      };
    },
    async availability(actor) {
      return isDraftAIConfigured() && actor.role !== "REPRESENTATIVE";
    },
    async buildProposal(actor, input) {
      if (!("text" in input)) {
        throw new AgentActionForbiddenError("工单草稿输入无效");
      }
      const readable = await canReadProject(input.projectId, actor.userId, actor.role);
      const contributable = await canContributeProject(input.projectId, actor.userId, actor.role);
      if (!readable || !contributable) {
        throw new AgentActionForbiddenError();
      }

      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, name: true, deleted: true },
      });
      if (!project || project.deleted) {
        throw new AgentActionNotFoundError(input.projectId);
      }

      const drafted = await runProjectAutoDraft(actor, "ticket.create", input.text, input.projectId);
      const fields = drafted.draft.fields as Record<string, unknown>;
      const title = typeof fields.title === "string" && fields.title.trim()
        ? fields.title.trim()
        : "AI 工单草稿";
      const description = typeof fields.description === "string" ? fields.description.trim() : "";
      const priority = typeof fields.priority === "string" ? fields.priority : "MEDIUM";

      return {
        title: `创建工单：${title}`,
        summary: `将在项目「${project.name}」下创建工单「${title}」${description ? "，并附带描述草稿" : ""}。优先级为 ${priority}。`,
        target: { type: "project", id: project.id },
        proposalInput: {
          projectId: input.projectId,
          title,
          description,
          priority,
          assigneeId: input.assigneeId ?? null,
          reminderDate: input.reminderDate ?? null,
          draft: drafted.draft,
          warnings: drafted.warnings || [],
        },
      };
    },
    async execute(actor, input) {
      if (!("title" in input)) {
        throw new AgentActionForbiddenError("工单确认输入无效");
      }
      const contributable = await canContributeProject(input.projectId, actor.userId, actor.role);
      if (!contributable) {
        throw new AgentActionForbiddenError();
      }

      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, deleted: true },
      });
      if (!project || project.deleted) {
        throw new AgentActionNotFoundError(input.projectId);
      }

      const confirmedInput = input as TicketProposalExecutionInput;
      const title = input.title;
      const description = confirmedInput.description || "";
      const priority = confirmedInput.priority || "MEDIUM";

      const ticket = await prisma.ticket.create({
        data: {
          title,
          description,
          priority,
          projectId: confirmedInput.projectId,
          assigneeId: confirmedInput.assigneeId || null,
          createdBy: actor.userId,
          reminderDate: confirmedInput.reminderDate ? new Date(confirmedInput.reminderDate) : null,
          reminderSent: false,
        },
        include: {
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true, avatar: true } },
        },
      });

      await prisma.activityLog.create({
        data: {
          type: "TICKET_CREATED",
          content: `创建了工单 "${ticket.title}"`,
          metadata: JSON.stringify({ ticketId: ticket.id }),
          projectId: confirmedInput.projectId,
          userId: actor.userId,
        },
      });

      return {
        ticket: {
          id: ticket.id,
          projectId: ticket.projectId,
          title: ticket.title,
          status: ticket.status,
          priority: ticket.priority,
          assigneeId: ticket.assigneeId,
        },
        draft: confirmedInput.draft || null,
        warnings: Array.isArray(confirmedInput.warnings) ? confirmedInput.warnings : [],
      };
    },
    resolveTarget(_input, output) {
      return { type: "ticket", id: output.ticket.id };
    },
  });
}
