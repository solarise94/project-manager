import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOrderAccessBlocked, getOrderScopeWhere } from "@/lib/orders/permissions";
import { getInvoicesForOrder } from "@/lib/finance/order-invoices";
import { computeOrderFinanceAmount } from "@/lib/finance/progress";
import { linkOrderToProject, OrderProjectCustomerConflictError } from "@/lib/orders/link-project";
import { AgentActionForbiddenError, AgentActionNotFoundError } from "../errors";
import { registerAgentAction } from "../registry";
import { booleanSchema, clampLimit, ensureObject, integerSchema, numberSchema, objectSchema, readOptionalBoolean, readOptionalInteger, readOptionalNumber, readOptionalString, readRequiredString, stringSchema } from "../schemas";

function searchInputSchema() {
  return objectSchema({
    query: stringSchema("关键词，可匹配订单号、标题、客户快照"),
    status: stringSchema("订单状态"),
    source: stringSchema("订单来源"),
    customerId: stringSchema("客户 ID"),
    limit: integerSchema("返回条数，默认 10，最大 30", { minimum: 1, maximum: 30 }),
  });
}

function searchOutputSchema() {
  return objectSchema({
    items: {
      type: "array",
      items: objectSchema({
        id: stringSchema(),
        orderNo: stringSchema(),
        title: stringSchema(),
        status: stringSchema(),
        source: stringSchema(),
      }),
    },
  });
}

function financeSnapshotInputSchema() {
  return objectSchema({
    orderId: stringSchema("订单 ID"),
  }, ["orderId"]);
}

function financeSnapshotOutputSchema() {
  return objectSchema({
    order: objectSchema({
      id: stringSchema(),
      orderNo: stringSchema(),
      title: stringSchema(),
      status: stringSchema(),
      totalAmount: stringSchema(),
    }),
    finance: objectSchema({
      financeAmount: stringSchema(),
      invoicedAmount: stringSchema(),
      receiptAmount: stringSchema(),
      costAmount: stringSchema(),
      outstandingAmount: stringSchema(),
    }),
    invoiceStatus: stringSchema(),
    projectLinks: {
      type: "array",
      items: objectSchema({
        projectId: stringSchema(),
        projectName: stringSchema(),
        treatment: stringSchema(),
      }),
    },
  });
}

function linkToProjectInputSchema() {
  return objectSchema({
    orderId: stringSchema("订单 ID"),
    projectId: stringSchema("项目 ID"),
    treatment: stringSchema("PROJECT_INCLUDED 或 STANDALONE"),
    allocatedAmount: numberSchema("分摊金额"),
    isPrimary: booleanSchema("是否主关联"),
    note: stringSchema("备注"),
  }, ["orderId", "projectId"]);
}

function linkToProjectOutputSchema() {
  return objectSchema({
    link: objectSchema({
      id: stringSchema(),
      orderId: stringSchema(),
      projectId: stringSchema(),
      treatment: stringSchema(),
    }),
    notifications: objectSchema({
      representativeAssigned: stringSchema(),
    }),
  });
}

async function assertOrderReadable(orderId: string, userId: string, role: string) {
  if (role === "ADMIN") return;
  const scope = await getOrderScopeWhere(userId, role);
  const found = await prisma.order.findFirst({
    where: {
      AND: [
        scope ?? {},
        { id: orderId, deleted: false },
      ],
    },
    select: { id: true },
  });
  if (!found) {
    throw new AgentActionNotFoundError(orderId);
  }
}

export function registerOrderActions() {
  registerAgentAction({
    key: "orders.search",
    title: "搜索订单",
    description: "按关键词和条件搜索当前用户可见的订单。",
    domain: "orders",
    riskLevel: "safe",
    readOnly: true,
    inputSchema: searchInputSchema(),
    outputSchema: searchOutputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return {
        query: readOptionalString(input, "query"),
        status: readOptionalString(input, "status"),
        source: readOptionalString(input, "source"),
        customerId: readOptionalString(input, "customerId"),
        limit: clampLimit(readOptionalInteger(input, "limit", { min: 1, max: 30 }), 10, 30),
      };
    },
    async availability(actor) {
      return !isOrderAccessBlocked(actor.role);
    },
    async execute(actor, input) {
      const scopeWhere = await getOrderScopeWhere(actor.userId, actor.role);
      const andConditions: Prisma.OrderWhereInput[] = [{ deleted: false }];
      if (scopeWhere) andConditions.push(scopeWhere as Prisma.OrderWhereInput);
      if (input.query) {
        andConditions.push({
          OR: [
            { orderNo: { contains: input.query } },
            { externalOrderNo: { contains: input.query } },
            { title: { contains: input.query } },
            { buyerNameSnapshot: { contains: input.query } },
            { buyerPhoneSnapshot: { contains: input.query } },
            { buyerOrgNameSnapshot: { contains: input.query } },
          ],
        });
      }
      if (input.status) andConditions.push({ status: input.status });
      if (input.source) andConditions.push({ source: input.source });
      if (input.customerId) andConditions.push({ customerId: input.customerId });

      const orders = await prisma.order.findMany({
        where: { AND: andConditions },
        take: input.limit,
        orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          orderNo: true,
          externalOrderNo: true,
          title: true,
          status: true,
          source: true,
          totalAmount: true,
          financeAmountOverride: true,
          buyerNameSnapshot: true,
          buyerOrgNameSnapshot: true,
          customer: { select: { id: true, name: true } },
          projectLinks: { select: { id: true } },
          updatedAt: true,
        },
      });

      return {
        items: orders.map((order) => ({
          id: order.id,
          orderNo: order.orderNo,
          externalOrderNo: order.externalOrderNo,
          title: order.title,
          status: order.status,
          source: order.source,
          totalAmount: order.totalAmount,
          financeAmount: computeOrderFinanceAmount({
            totalAmount: order.totalAmount,
            financeAmountOverride: order.financeAmountOverride,
          }),
          buyerNameSnapshot: order.buyerNameSnapshot,
          buyerOrgNameSnapshot: order.buyerOrgNameSnapshot,
          customerId: order.customer?.id ?? null,
          customerName: order.customer?.name ?? null,
          projectLinkCount: order.projectLinks.length,
          updatedAt: order.updatedAt.toISOString(),
        })),
      };
    },
  });

  registerAgentAction({
    key: "orders.get_finance_snapshot",
    title: "查看订单财务摘要",
    description: "读取订单金额、开票、回款、成本和项目分摊摘要。",
    domain: "orders",
    riskLevel: "safe",
    readOnly: true,
    inputSchema: financeSnapshotInputSchema(),
    outputSchema: financeSnapshotOutputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return {
        orderId: readRequiredString(input, "orderId"),
      };
    },
    async availability(actor) {
      return !isOrderAccessBlocked(actor.role);
    },
    async execute(actor, input) {
      if (isOrderAccessBlocked(actor.role)) {
        throw new AgentActionForbiddenError();
      }

      await assertOrderReadable(input.orderId, actor.userId, actor.role);

      const order = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          orderNo: true,
          title: true,
          status: true,
          totalAmount: true,
          financeAmountOverride: true,
          receipts: { where: { deleted: false }, select: { amount: true } },
          financeCosts: { select: { amount: true } },
          projectLinks: {
            select: {
              treatment: true,
              allocatedAmount: true,
              project: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!order) {
        throw new AgentActionNotFoundError(input.orderId);
      }

      const invoices = await getInvoicesForOrder(input.orderId);
      const financeAmount = computeOrderFinanceAmount({
        totalAmount: order.totalAmount,
        financeAmountOverride: order.financeAmountOverride,
      });
      const invoicedAmount = invoices
        .filter((invoice) => invoice.status !== "CANCELLED")
        .reduce((sum, invoice) => sum + invoice.totalAmount, 0);
      const receiptAmount = order.receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
      const costAmount = order.financeCosts.reduce((sum, cost) => sum + cost.amount, 0);

      return {
        order: {
          id: order.id,
          orderNo: order.orderNo,
          title: order.title,
          status: order.status,
          totalAmount: order.totalAmount,
          financeAmount,
        },
        finance: {
          financeAmount,
          invoicedAmount,
          receiptAmount,
          costAmount,
          outstandingAmount: Math.max(invoicedAmount - receiptAmount, 0),
        },
        invoiceStatus: invoices.length === 0
          ? "NONE"
          : invoices.some((invoice) => invoice.status === "ISSUED")
            ? "ISSUED"
            : invoices.some((invoice) => invoice.status === "REQUESTED")
              ? "REQUESTED"
              : invoices[0].status,
        projectLinks: order.projectLinks.map((link) => ({
          projectId: link.project.id,
          projectName: link.project.name,
          allocatedAmount: link.allocatedAmount,
          treatment: link.treatment,
        })),
        invoices: invoices.map((invoice) => ({
          id: invoice.id,
          status: invoice.status,
          totalAmount: invoice.totalAmount,
          actualInvoiceNo: invoice.actualInvoiceNo,
        })),
      };
    },
  });

  registerAgentAction({
    key: "orders.link_to_project",
    title: "绑定订单到项目",
    description: "把订单与项目建立关联，并复用现有客户冲突与 CRM 同步逻辑。",
    domain: "orders",
    riskLevel: "confirm",
    readOnly: false,
    inputSchema: linkToProjectInputSchema(),
    outputSchema: linkToProjectOutputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return {
        orderId: readRequiredString(input, "orderId"),
        projectId: readRequiredString(input, "projectId"),
        treatment: readOptionalString(input, "treatment"),
        allocatedAmount: readOptionalNumber(input, "allocatedAmount", { min: 0 }),
        isPrimary: readOptionalBoolean(input, "isPrimary"),
        note: readOptionalString(input, "note"),
      };
    },
    async availability(actor) {
      return actor.role === "ADMIN";
    },
    async buildProposal(actor, input) {
      if (actor.role !== "ADMIN") {
        throw new AgentActionForbiddenError();
      }

      const [order, project, existing] = await Promise.all([
        prisma.order.findUnique({
          where: { id: input.orderId },
          select: { id: true, orderNo: true, title: true },
        }),
        prisma.project.findUnique({
          where: { id: input.projectId },
          select: { id: true, name: true },
        }),
        prisma.orderProjectLink.findUnique({
          where: {
            orderId_projectId: {
              orderId: input.orderId,
              projectId: input.projectId,
            },
          },
        }),
      ]);
      if (!order) throw new AgentActionNotFoundError(input.orderId);
      if (!project) throw new AgentActionNotFoundError(input.projectId);
      if (existing) {
        throw new AgentActionForbiddenError("Link already exists");
      }

      return {
        title: `绑定订单 ${order.orderNo} 到项目`,
        summary: `订单「${order.orderNo} ${order.title}」将绑定到项目「${project.name}」。处理方式为 ${input.treatment || "PROJECT_INCLUDED"}。`,
        target: { type: "order", id: order.id },
      };
    },
    async execute(actor, input) {
      if (actor.role !== "ADMIN") {
        throw new AgentActionForbiddenError();
      }

      const [order, project, existing] = await Promise.all([
        prisma.order.findUnique({
          where: { id: input.orderId },
          select: { id: true, customerId: true },
        }),
        prisma.project.findUnique({
          where: { id: input.projectId },
          select: { id: true },
        }),
        prisma.orderProjectLink.findUnique({
          where: {
            orderId_projectId: {
              orderId: input.orderId,
              projectId: input.projectId,
            },
          },
        }),
      ]);
      if (!order) throw new AgentActionNotFoundError(input.orderId);
      if (!project) throw new AgentActionNotFoundError(input.projectId);
      if (existing) {
        throw new AgentActionForbiddenError("Link already exists");
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          const linkResult = await linkOrderToProject(
            tx,
            input.orderId,
            input.projectId,
            actor.userId,
            {
              treatment: input.treatment,
              allocatedAmount: input.allocatedAmount,
              isPrimary: input.isPrimary,
              note: input.note,
            },
            order.customerId,
          );
          if (linkResult.orderUpdateData) {
            await tx.order.update({
              where: { id: input.orderId },
              data: linkResult.orderUpdateData,
            });
          }
          return linkResult;
        });

        if (result.repAssignedToProject) {
          const { notifyRepresentativeById } = await import("@/lib/representative-link");
          const { buildRepAssignedNotifications } = await import("@/lib/notification-helpers");
          notifyRepresentativeById(
            result.repAssignedToProject.representativeId,
            result.repAssignedToProject.representativeEmail,
            `/projects/${result.repAssignedToProject.projectId}`,
            buildRepAssignedNotifications(
              result.repAssignedToProject.representativeName,
              result.repAssignedToProject.projectName,
            ),
          ).catch(() => {});
        }

        return {
          link: {
            id: result.link.id,
            orderId: result.link.orderId,
            projectId: result.link.projectId,
            treatment: result.link.treatment,
            allocatedAmount: result.link.allocatedAmount,
            isPrimary: result.link.isPrimary,
          },
          notifications: {
            representativeAssigned: result.repAssignedToProject
              ? result.repAssignedToProject.representativeId
              : null,
          },
        };
      } catch (error) {
        if (error instanceof OrderProjectCustomerConflictError) {
          throw new AgentActionForbiddenError("订单客户与项目客户不一致");
        }
        throw error;
      }
    },
    resolveTarget(_input, output) {
      return { type: "order_project_link", id: output.link.id };
    },
  });
}
