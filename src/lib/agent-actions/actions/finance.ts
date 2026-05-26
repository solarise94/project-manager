import { prisma } from "@/lib/prisma";
import { syncOrderInvoiceStatus } from "@/lib/external-order";
import { findBlockingInvoicesForOrder } from "@/lib/finance/order-invoices";
import { AgentActionForbiddenError, AgentActionInputError, AgentActionNotFoundError } from "../errors";
import { registerAgentAction } from "../registry";
import {
  arraySchema,
  ensureObject,
  numberSchema,
  objectSchema,
  readOptionalArray,
  readOptionalString,
  readRequiredString,
  stringSchema,
} from "../schemas";

interface InvoiceItemInput {
  itemName: string;
  spec?: string;
  unit?: string;
  quantity?: number | null;
  amount: number;
}

function invoiceItemSchema() {
  return objectSchema({
    itemName: stringSchema("项目名称"),
    spec: stringSchema("规格"),
    unit: stringSchema("单位"),
    quantity: numberSchema("数量"),
    amount: numberSchema("金额"),
  }, ["itemName", "amount"]);
}

function prepareInvoiceDraftInputSchema() {
  return objectSchema({
    orderId: stringSchema("主订单 ID"),
    coveredOrderIds: arraySchema(stringSchema(), "附带覆盖的订单 ID 列表"),
    contactName: stringSchema("联系人"),
    sellerProfileId: stringSchema("开票方档案 ID"),
    sellerName: stringSchema("开票方名称"),
    buyerOrganizationId: stringSchema("买方机构 ID"),
    buyerOrganizationName: stringSchema("买方公司名称"),
    buyerTaxId: stringSchema("买方税号"),
    invoiceType: stringSchema("NORMAL 或 SPECIAL"),
    contentSummary: stringSchema("开票内容摘要"),
    remark: stringSchema("备注"),
    taxIdFromLookup: { type: "boolean", description: "税号是否来自机构库" },
    items: arraySchema(invoiceItemSchema(), "开票行项目"),
  }, ["orderId", "buyerOrganizationName"]);
}

function prepareInvoiceDraftOutputSchema() {
  return objectSchema({
    invoice: objectSchema({
      id: stringSchema(),
      orderId: stringSchema(),
      buyerOrganizationName: stringSchema(),
      totalAmount: numberSchema(),
      status: stringSchema(),
    }),
    coveredOrderCount: numberSchema(),
  });
}

function parseInvoiceItems(raw: unknown): InvoiceItemInput[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new AgentActionInputError("items must be an array");
  }

  return raw.map((item, index) => {
    const record = ensureObject(item, `items[${index}]`);
    const itemName = readRequiredString(record, "itemName");
    const spec = readOptionalString(record, "spec");
    const unit = readOptionalString(record, "unit");
    const quantityValue = record.quantity;
    const amountValue = record.amount;
    const quantity = quantityValue == null || quantityValue === ""
      ? null
      : Number(quantityValue);
    const amount = Number(amountValue);
    if (quantity != null && !Number.isFinite(quantity)) {
      throw new AgentActionInputError(`items[${index}].quantity must be a number`);
    }
    if (!Number.isFinite(amount)) {
      throw new AgentActionInputError(`items[${index}].amount must be a number`);
    }

    return {
      itemName,
      spec,
      unit,
      quantity,
      amount,
    };
  });
}

export function registerFinanceActions() {
  registerAgentAction({
    key: "finance.prepare_invoice_draft",
    title: "准备订单开票草稿",
    description: "为订单创建待确认的开票申请草稿。",
    domain: "finance",
    riskLevel: "confirm",
    readOnly: false,
    inputSchema: prepareInvoiceDraftInputSchema(),
    outputSchema: prepareInvoiceDraftOutputSchema(),
    parseInput(raw) {
      const input = ensureObject(raw);
      return {
        orderId: readRequiredString(input, "orderId"),
        coveredOrderIds: (readOptionalArray(input, "coveredOrderIds") ?? []).map((value, index) => {
          if (typeof value !== "string" || !value.trim()) {
            throw new AgentActionInputError(`coveredOrderIds[${index}] must be a non-empty string`);
          }
          return value.trim();
        }),
        contactName: readOptionalString(input, "contactName"),
        sellerProfileId: readOptionalString(input, "sellerProfileId"),
        sellerName: readOptionalString(input, "sellerName"),
        buyerOrganizationId: readOptionalString(input, "buyerOrganizationId"),
        buyerOrganizationName: readRequiredString(input, "buyerOrganizationName"),
        buyerTaxId: readOptionalString(input, "buyerTaxId"),
        invoiceType: readOptionalString(input, "invoiceType"),
        contentSummary: readOptionalString(input, "contentSummary"),
        remark: readOptionalString(input, "remark"),
        taxIdFromLookup: input.taxIdFromLookup === true,
        items: parseInvoiceItems(input.items),
      };
    },
    async availability(actor) {
      return actor.role === "ADMIN";
    },
    async buildProposal(actor, input) {
      if (actor.role !== "ADMIN") {
        throw new AgentActionForbiddenError();
      }

      const order = await prisma.order.findUnique({
        where: { id: input.orderId, deleted: false },
        select: { id: true, orderNo: true, title: true },
      });
      if (!order) {
        throw new AgentActionNotFoundError(input.orderId);
      }

      const coveredIds = [input.orderId, ...input.coveredOrderIds].filter((value, index, all) => all.indexOf(value) === index);
      for (const orderId of coveredIds) {
        const blockers = await findBlockingInvoicesForOrder(orderId);
        if (blockers.length > 0) {
          throw new AgentActionForbiddenError(`订单 ${orderId.slice(-6)} 已存在未完成发票流程`);
        }
      }

      const totalAmount = input.items.reduce((sum, item) => sum + item.amount, 0);
      return {
        title: `创建发票草稿：${order.orderNo}`,
        summary: `将为订单「${order.orderNo} ${order.title}」创建发票草稿，购方为「${input.buyerOrganizationName}」，覆盖 ${coveredIds.length} 笔订单，金额 ${totalAmount.toFixed(2)}。`,
        target: { type: "order", id: order.id },
      };
    },
    async execute(actor, input) {
      if (actor.role !== "ADMIN") {
        throw new AgentActionForbiddenError();
      }

      const order = await prisma.order.findUnique({
        where: { id: input.orderId, deleted: false },
        select: { id: true, legacyExternalOrderId: true },
      });
      if (!order) {
        throw new AgentActionNotFoundError(input.orderId);
      }

      const coveredIds = [input.orderId, ...input.coveredOrderIds].filter((value, index, all) => all.indexOf(value) === index);
      for (const orderId of coveredIds) {
        const coveredOrder = await prisma.order.findUnique({
          where: { id: orderId, deleted: false },
          select: { id: true },
        });
        if (!coveredOrder) {
          throw new AgentActionInputError(`订单 ${orderId.slice(-6)} 不存在`);
        }

        const blockers = await findBlockingInvoicesForOrder(orderId);
        if (blockers.length > 0) {
          throw new AgentActionForbiddenError(`订单 ${orderId.slice(-6)} 已存在未完成发票流程`);
        }
      }

      let sellerSnapshot: Record<string, unknown> = {};
      if (input.sellerProfileId) {
        const profile = await prisma.billingProfile.findUnique({
          where: { id: input.sellerProfileId },
        });
        if (profile) {
          sellerSnapshot = {
            sellerProfileId: profile.id,
            sellerName: profile.name,
            sellerTaxId: profile.taxId || null,
            sellerBankName: profile.bankName || null,
            sellerBankAccount: profile.bankAccount || null,
            sellerAddress: profile.address || null,
            sellerPhone: profile.phone || null,
          };
        }
      }
      if (!sellerSnapshot.sellerName && input.sellerName) {
        sellerSnapshot = { ...sellerSnapshot, sellerName: input.sellerName };
      }

      const itemRows = input.items.filter((item) => item.itemName.trim());
      const totalAmount = itemRows.reduce((sum, item) => sum + item.amount, 0);

      const invoice = await prisma.$transaction(async (tx) => {
        const created = await tx.externalOrderInvoiceRequest.create({
          data: {
            orderId: input.orderId,
            externalOrderId: order.legacyExternalOrderId,
            contactName: input.contactName || null,
            ...sellerSnapshot,
            buyerOrganizationId: input.buyerOrganizationId || null,
            buyerOrganizationName: input.buyerOrganizationName,
            buyerTaxId: input.buyerTaxId || null,
            buyerTaxIdFromLookup: input.taxIdFromLookup,
            invoiceType: input.invoiceType === "SPECIAL" ? "SPECIAL" : "NORMAL",
            contentSummary: input.contentSummary || null,
            totalAmount,
            remark: input.remark || null,
            status: "DRAFT",
            createdById: actor.userId,
            items: itemRows.length > 0
              ? {
                  create: itemRows.map((item, index) => ({
                    itemName: item.itemName,
                    spec: item.spec || null,
                    unit: item.unit || null,
                    quantity: item.quantity ?? null,
                    amount: item.amount,
                    sortOrder: index,
                  })),
                }
              : undefined,
          },
        });

        for (const orderId of coveredIds) {
          await tx.orderInvoiceCoverage.create({
            data: {
              invoiceRequestId: created.id,
              orderId,
            },
          });
        }

        return created;
      });

      for (const orderId of coveredIds) {
        const currentOrder = await prisma.order.findUnique({
          where: { id: orderId },
          select: { legacyExternalOrderId: true },
        });
        if (currentOrder?.legacyExternalOrderId) {
          await syncOrderInvoiceStatus(prisma, currentOrder.legacyExternalOrderId, orderId);
        }
        await syncOrderInvoiceStatus(prisma, orderId, orderId);
      }

      return {
        invoice: {
          id: invoice.id,
          orderId: invoice.orderId ?? input.orderId,
          buyerOrganizationName: invoice.buyerOrganizationName,
          totalAmount: invoice.totalAmount,
          status: invoice.status,
        },
        coveredOrderCount: coveredIds.length,
      };
    },
    resolveTarget(_input, output) {
      return { type: "order_invoice_request", id: output.invoice.id };
    },
  });
}
