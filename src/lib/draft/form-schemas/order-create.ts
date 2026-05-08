import type { FormSchema } from "./types";

export const orderCreateSchema: FormSchema = {
  formKey: "order.create",
  fields: [
    { key: "title", label: "订单标题", type: "string", required: true },
    { key: "description", label: "描述", type: "string" },
    {
      key: "category",
      label: "分类",
      type: "enum",
      enumValues: { "SERVICE": "服务", "PRODUCT": "商品", "MIXED": "混合" },
    },
    {
      key: "customer",
      label: "客户",
      type: "string",
      entityType: "customer",
      searchable: true,
    },
    { key: "buyerNameSnapshot", label: "收件人", type: "string" },
    { key: "buyerPhoneSnapshot", label: "电话", type: "string" },
    { key: "buyerWechatSnapshot", label: "微信", type: "string" },
    { key: "buyerOrgNameSnapshot", label: "单位", type: "string" },
    { key: "buyerAddressSnapshot", label: "地址", type: "string" },
    { key: "orderedAt", label: "下单日期", type: "date", normalizer: "date" },
    { key: "lines", label: "明细项", type: "string" },
    { key: "totalAmount", label: "总金额", type: "number" },
    {
      key: "financeTreatment",
      label: "计入口径",
      type: "enum",
      enumValues: { "AUTO": "自动", "STANDALONE": "独立计入", "PROJECT_INCLUDED": "并入项目", "EXCLUDED": "排除" },
    },
  ],
};
