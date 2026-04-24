import { registerPlugin } from "../registry";
import type { FormDraftPlugin, FormDraftResult } from "../types";
import { parseSmartFill } from "@/lib/smart-fill";

const projectSmartFill: FormDraftPlugin = {
  manifest: {
    key: "project.smart-fill",
    name: "智能填写",
    description: "从粘贴的表格文本中解析项目信息，生成表单草稿",
    capability: "form-draft",
    formKeys: ["project.create", "project.edit"],
  },
  async execute(input: string): Promise<FormDraftResult> {
    const result = parseSmartFill(input);
    const fields: Record<string, unknown> = {};
    const warnings: string[] = [];

    if (result.name) fields.name = result.name;
    if (result.description) fields.description = result.description;
    if (result.orderNumber) fields.orderNumber = result.orderNumber;
    if (result.organization) fields.organization = result.organization;
    if (result.client) fields.client = result.client;
    if (result.representative) fields.representative = result.representative;
    if (result.status) fields.status = result.status;
    if (result.startDate) fields.startDate = result.startDate;
    if (result.endDate) fields.endDate = result.endDate;

    if (!result.name) warnings.push("未能解析出项目名称");
    if (!result.orderNumber) warnings.push("未能解析出订单号");

    return {
      summary: result.name ? `解析到项目：${result.name}` : "解析完成，部分字段可能缺失",
      warnings: warnings.length > 0 ? warnings : undefined,
      draft: { fields },
    };
  },
};

registerPlugin(projectSmartFill);
