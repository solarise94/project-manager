export const CRM_STAGES = ["NEW", "CONTACTED", "FOLLOWING", "ACTIVE", "BLOCKED", "LOST", "DORMANT"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const STAGE_LABELS: Record<string, string> = {
  NEW: "新客户",
  CONTACTED: "已联系",
  FOLLOWING: "跟进中",
  ACTIVE: "活跃",
  BLOCKED: "受阻",
  LOST: "流失",
  DORMANT: "休眠",
};

export const STAGE_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-800",
  CONTACTED: "bg-cyan-100 text-cyan-800",
  FOLLOWING: "bg-yellow-100 text-yellow-800",
  ACTIVE: "bg-green-100 text-green-800",
  BLOCKED: "bg-red-100 text-red-800",
  LOST: "bg-gray-100 text-gray-800",
  DORMANT: "bg-slate-100 text-slate-600",
};

export const CRM_IMPORTANCE = ["LOW", "NORMAL", "HIGH", "KEY"] as const;
export type CrmImportance = (typeof CRM_IMPORTANCE)[number];

export const IMPORTANCE_LABELS: Record<string, string> = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "重要",
  KEY: "关键",
};

export const IMPORTANCE_COLORS: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-600",
  NORMAL: "bg-blue-100 text-blue-700",
  HIGH: "bg-orange-100 text-orange-700",
  KEY: "bg-red-100 text-red-700",
};

export const CRM_INTERACTION_TYPES = ["CALL", "WECHAT", "EMAIL", "MEETING", "VISIT", "REFERRAL", "NOTE"] as const;
export type CrmInteractionType = (typeof CRM_INTERACTION_TYPES)[number];

export const INTERACTION_TYPE_LABELS: Record<string, string> = {
  CALL: "电话",
  WECHAT: "微信",
  EMAIL: "邮件",
  MEETING: "会议",
  VISIT: "拜访",
  REFERRAL: "转介绍",
  NOTE: "备注",
};

export const CRM_FOLLOW_UP_STATUS = ["OPEN", "DONE", "CANCELLED", "EXPIRED"] as const;
export type CrmFollowUpStatus = (typeof CRM_FOLLOW_UP_STATUS)[number];

export const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  OPEN: "待处理",
  DONE: "已完成",
  CANCELLED: "已取消",
  EXPIRED: "已过期",
};

export const FOLLOW_UP_STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-yellow-100 text-yellow-800",
  DONE: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
  EXPIRED: "bg-red-100 text-red-700",
};

export const CRM_CHECKIN_STATUS = ["DRAFT", "COMPLETED"] as const;

export const ADDRESS_SOURCE_TYPES = ["MANUAL", "PROJECT_IMPORT", "EXTERNAL_ORDER_IMPORT", "VISIT_CHECKIN"] as const;

export const ADDRESS_SOURCE_LABELS: Record<string, string> = {
  MANUAL: "手动录入",
  PROJECT_IMPORT: "项目导入",
  EXTERNAL_ORDER_IMPORT: "外部订单导入",
  VISIT_CHECKIN: "拜访签到",
};

export const CRM_RELATION_TYPES = ["REFERRED", "COLLABORATES_WITH", "REPORTS_TO", "SAME_GROUP", "SAME_LAB", "OTHER"] as const;
export type CrmRelationType = (typeof CRM_RELATION_TYPES)[number];

export const SYMMETRIC_RELATION_TYPES = new Set(["COLLABORATES_WITH", "SAME_GROUP", "SAME_LAB", "OTHER"]);

export const RELATION_TYPE_LABELS: Record<string, string> = {
  REFERRED: "介绍",
  COLLABORATES_WITH: "协作",
  REPORTS_TO: "汇报",
  SAME_GROUP: "同课题组",
  SAME_LAB: "同实验室",
  OTHER: "其他",
};

export const RELATION_TYPE_COLORS: Record<string, string> = {
  REFERRED: "bg-purple-100 text-purple-800",
  COLLABORATES_WITH: "bg-blue-100 text-blue-700",
  REPORTS_TO: "bg-cyan-100 text-cyan-800",
  SAME_GROUP: "bg-green-100 text-green-700",
  SAME_LAB: "bg-teal-100 text-teal-700",
  OTHER: "bg-gray-100 text-gray-600",
};

export const CRM_RELATION_STRENGTHS = ["STRONG", "NORMAL", "WEAK"] as const;

export const RELATION_STRENGTH_LABELS: Record<string, string> = {
  STRONG: "强",
  NORMAL: "一般",
  WEAK: "弱",
};

export const STAGE_HEX_COLORS: Record<string, string> = {
  NEW: "#3b82f6",
  CONTACTED: "#06b6d4",
  FOLLOWING: "#eab308",
  ACTIVE: "#22c55e",
  BLOCKED: "#ef4444",
  LOST: "#9ca3af",
  DORMANT: "#94a3b8",
};

export const RELATION_TYPE_HEX_COLORS: Record<string, string> = {
  REFERRED: "#a855f7",
  COLLABORATES_WITH: "#3b82f6",
  REPORTS_TO: "#06b6d4",
  SAME_GROUP: "#22c55e",
  SAME_LAB: "#14b8a6",
  OTHER: "#9ca3af",
};
