import { registerPlugin } from "../registry";
import type { FormDraftPlugin, FormDraftResult } from "../types";
import { parseSmartFill } from "@/lib/smart-fill";

type OrderLineDraft = {
  itemName: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

function parseAmount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[¥￥,\s元]/g, "").trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function readLabeledValue(lines: string[], labels: string[]): string | undefined {
  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized) continue;
    const parts = normalized.split(/[:：\t]/);
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join(":").trim();
      if (value && labels.some((label) => key.includes(label))) return value;
    }
    for (const label of labels) {
      if (!normalized.startsWith(label)) continue;
      const value = normalized.slice(label.length).replace(/^[\s:：,，-]+/, "").trim();
      if (value) return value;
    }
  }
  return undefined;
}

function buildLine(itemName: string, spec: string, quantity: number, amount: number): OrderLineDraft {
  const safeQuantity = quantity > 0 ? quantity : 1;
  return {
    itemName,
    spec,
    unit: "项",
    quantity: safeQuantity,
    unitPrice: amount > 0 ? amount / safeQuantity : 0,
    amount: amount > 0 ? amount : 0,
  };
}

const orderSmartFill: FormDraftPlugin = {
  manifest: {
    key: "order.smart-fill",
    name: "订单智能填写",
    description: "从粘贴文本中解析订单标题、客户快照、金额和明细",
    capability: "form-draft",
    formKeys: ["order.create"],
  },
  async execute(input: string): Promise<FormDraftResult> {
    const text = input.trim();
    if (!text) throw new Error("请输入文本内容");

    const fields: Record<string, unknown> = {};
    const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);

    try {
      const projectLike = parseSmartFill(text);
      const title = projectLike.name || projectLike.projectContent || projectLike.orderNumber;
      const amount = projectLike.budgetAmount;
      const quantity = projectLike.quantity && projectLike.quantity > 0 ? projectLike.quantity : 1;

      if (title) fields.title = title;
      if (projectLike.description) fields.description = projectLike.description;
      if (projectLike.client) {
        fields.buyerNameSnapshot = projectLike.client;
        fields.customer = { name: projectLike.client, matched: false };
      }
      if (projectLike.organization) fields.buyerOrgNameSnapshot = projectLike.organization;
      if (projectLike.startDate) fields.orderedAt = projectLike.startDate;
      if (projectLike.projectType) fields.category = /商品|产品|货物/.test(projectLike.projectType) ? "PRODUCT" : "SERVICE";
      if (amount != null) fields.totalAmount = amount;

      const lineName = projectLike.projectContent || title || "订单服务";
      if (lineName) {
        fields.lines = [buildLine(lineName, projectLike.projectType || projectLike.brand || "", quantity, amount ?? 0)];
      }
    } catch {
      // Continue with loose label parsing below.
    }

    const title =
      readLabeledValue(lines, ["订单标题", "订单名称", "项目内容", "服务内容", "内容", "名称"]) ||
      lines[0];
    const buyerName = readLabeledValue(lines, ["客户", "客户姓名", "收件人", "姓名", "购买人"]);
    const buyerPhone = readLabeledValue(lines, ["电话", "手机号", "手机", "联系方式"]);
    const buyerWechat = readLabeledValue(lines, ["微信", "下单用户"]);
    const buyerOrg = readLabeledValue(lines, ["单位", "机构", "学校", "医院", "公司"]);
    const buyerAddress = readLabeledValue(lines, ["地址", "收货地址"]);
    const orderedAt = parseDate(readLabeledValue(lines, ["下单日期", "日期", "时间"]));
    const amount = parseAmount(readLabeledValue(lines, ["总金额", "金额", "价格", "费用", "合计"]));

    if (!fields.title && title) fields.title = title;
    if (!fields.buyerNameSnapshot && buyerName) {
      fields.buyerNameSnapshot = buyerName;
      fields.customer = { name: buyerName, matched: false };
    }
    if (!fields.buyerPhoneSnapshot && buyerPhone) fields.buyerPhoneSnapshot = buyerPhone;
    if (!fields.buyerWechatSnapshot && buyerWechat) fields.buyerWechatSnapshot = buyerWechat;
    if (!fields.buyerOrgNameSnapshot && buyerOrg) fields.buyerOrgNameSnapshot = buyerOrg;
    if (!fields.buyerAddressSnapshot && buyerAddress) fields.buyerAddressSnapshot = buyerAddress;
    if (!fields.orderedAt && orderedAt) fields.orderedAt = orderedAt;
    if (amount != null) fields.totalAmount = amount;
    if (!fields.category) fields.category = "SERVICE";
    if (!fields.lines) {
      const effectiveAmount = amount ?? (typeof fields.totalAmount === "number" ? fields.totalAmount : 0);
      fields.lines = [buildLine(String(fields.title || title || "订单服务"), "", 1, effectiveAmount)];
    }

    const warnings: string[] = [];
    if (!title) warnings.push("未能解析出订单标题");
    if (fields.totalAmount == null) warnings.push("未能解析出订单金额");

    return {
      summary: fields.title ? `解析到订单：${fields.title}` : "解析完成，部分字段可能缺失",
      warnings: warnings.length > 0 ? warnings : undefined,
      draft: { fields },
    };
  },
};

registerPlugin(orderSmartFill);
