import type { FormSchema } from "./types";

export const projectCreateSchema: FormSchema = {
  formKey: "project.create",
  fields: [
    { key: "name", label: "项目名称", type: "string", required: true },
    { key: "description", label: "项目描述", type: "string" },
    { key: "orderNumber", label: "订单号", type: "string" },
    {
      key: "organization",
      label: "单位",
      type: "string",
      searchable: true,
      entityType: "organization",
    },
    { key: "client", label: "客户", type: "string", entityType: "customer" },
    { key: "representative", label: "代表", type: "string" },
    {
      key: "status",
      label: "状态",
      type: "enum",
      normalizer: "status",
      enumValues: {
        NOT_STARTED: "未开始",
        IN_PROGRESS: "进行中",
        COMPLETED: "已完成",
        ON_HOLD: "暂停",
      },
    },
    { key: "startDate", label: "开始日期", type: "date", normalizer: "date" },
    { key: "endDate", label: "结束日期", type: "date", normalizer: "date" },
  ],
};

// Edit uses the same schema
export const projectEditSchema: FormSchema = {
  ...projectCreateSchema,
  formKey: "project.edit",
};
