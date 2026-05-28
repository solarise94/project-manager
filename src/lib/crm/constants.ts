export const CRM_STAGES = ["LEAD", "CONTACTED", "FOLLOWING", "ACTIVE", "BLOCKED", "LOST", "DORMANT"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const STAGE_LABELS: Record<string, string> = {
  LEAD: "线索",
  CONTACTED: "已触达",
  FOLLOWING: "跟进中",
  ACTIVE: "业务进行中",
  BLOCKED: "受阻",
  LOST: "流失",
  DORMANT: "休眠",
  // 兼容旧数据读取
  NEW: "新客户",
};

export const STAGE_COLORS: Record<string, string> = {
  LEAD: "bg-blue-100 text-blue-800",
  CONTACTED: "bg-cyan-100 text-cyan-800",
  FOLLOWING: "bg-yellow-100 text-yellow-800",
  ACTIVE: "bg-green-100 text-green-800",
  BLOCKED: "bg-red-100 text-red-800",
  LOST: "bg-gray-100 text-gray-800",
  DORMANT: "bg-slate-100 text-slate-600",
  // 兼容旧数据读取
  NEW: "bg-blue-100 text-blue-800",
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

export const CRM_DORMANT_THRESHOLD_DAYS = 90;
export const CRM_DORMANT_WARNING_DAYS = 60;
export const CRM_ACTIVE_COOLDOWN_DAYS = 30;
export const CRM_ACTIVE_WARNING_TO_DORMANT_DAYS = 30;

export const CRM_COMMUNICATION_TASK_SOURCE_TYPES = [
  "CRM_COMMUNICATION",
  "CRM_DORMANT_WARNING",
  "CRM_REACTIVATION",
  "CRM_ACTIVE_DOWNGRADE_WARNING",
] as const;
export type CrmCommunicationTaskSourceType = (typeof CRM_COMMUNICATION_TASK_SOURCE_TYPES)[number];

export const CRM_EFFECTIVE_INTERACTION_TYPES = [
  "CALL",
  "WECHAT",
  "EMAIL",
  "MEETING",
  "VISIT",
  "REFERRAL",
] as const;
export type CrmEffectiveInteractionType = (typeof CRM_EFFECTIVE_INTERACTION_TYPES)[number];

export const CRM_CHECKIN_STATUS = ["DRAFT", "COMPLETED"] as const;

export const ADDRESS_SOURCE_TYPES = ["MANUAL", "PROJECT_IMPORT", "EXTERNAL_ORDER_IMPORT", "VISIT_CHECKIN", "CUSTOMER_APPLICATION"] as const;

export const ADDRESS_SOURCE_LABELS: Record<string, string> = {
  MANUAL: "手动录入",
  PROJECT_IMPORT: "项目导入",
  EXTERNAL_ORDER_IMPORT: "外部订单导入",
  VISIT_CHECKIN: "拜访签到",
  CUSTOMER_APPLICATION: "客户申请",
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
  LEAD: "#3b82f6",
  CONTACTED: "#06b6d4",
  FOLLOWING: "#eab308",
  ACTIVE: "#22c55e",
  BLOCKED: "#ef4444",
  LOST: "#9ca3af",
  DORMANT: "#94a3b8",
  // 兼容旧数据读取
  NEW: "#3b82f6",
};

export const RELATION_TYPE_HEX_COLORS: Record<string, string> = {
  REFERRED: "#a855f7",
  COLLABORATES_WITH: "#3b82f6",
  REPORTS_TO: "#06b6d4",
  SAME_GROUP: "#22c55e",
  SAME_LAB: "#14b8a6",
  OTHER: "#9ca3af",
};

export const CRM_ASSIGNMENT_STATUS = ["UNASSIGNED", "ASSIGNED", "RECALL_CANDIDATE", "RECALLED"] as const;
export type CrmAssignmentStatus = (typeof CRM_ASSIGNMENT_STATUS)[number];

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "未分配",
  ASSIGNED: "已分配",
  RECALL_CANDIDATE: "待收回",
  RECALLED: "已收回",
};

export const ASSIGNMENT_STATUS_COLORS: Record<string, string> = {
  UNASSIGNED: "bg-gray-100 text-gray-600",
  ASSIGNED: "bg-green-100 text-green-700",
  RECALL_CANDIDATE: "bg-orange-100 text-orange-700",
  RECALLED: "bg-red-100 text-red-700",
};

export const ASSIGNMENT_ACTIONS = ["ASSIGN", "RECALL", "MARK_CANDIDATE", "REMIND"] as const;
export type AssignmentAction = (typeof ASSIGNMENT_ACTIONS)[number];

export const ASSIGNMENT_ACTION_LABELS: Record<string, string> = {
  ASSIGN: "分配",
  RECALL: "收回",
  MARK_CANDIDATE: "标记候选",
  REMIND: "提醒",
};

export const REFLOW_THRESHOLD_DAYS = 60;

export const CRM_PERSON_CATEGORIES = [
  "STUDENT",
  "POSTDOC",
  "RESEARCHER",
  "PI",
  "TECHNICIAN",
  "CLINICIAN",
  "ADMIN",
  "PROCUREMENT",
  "OTHER",
] as const;
export type CrmPersonCategory = (typeof CRM_PERSON_CATEGORIES)[number];
export const PERSON_CATEGORY_LABELS: Record<string, string> = {
  STUDENT: "学生",
  POSTDOC: "博士后",
  RESEARCHER: "研究员/科研人员",
  PI: "课题组负责人/PI",
  TECHNICIAN: "实验技术员",
  CLINICIAN: "临床医生",
  ADMIN: "行政管理",
  PROCUREMENT: "采购/财务/设备",
  OTHER: "其他",
};
export const PERSON_CATEGORY_COLORS: Record<string, string> = {
  STUDENT: "bg-blue-100 text-blue-800",
  POSTDOC: "bg-indigo-100 text-indigo-800",
  RESEARCHER: "bg-violet-100 text-violet-800",
  PI: "bg-amber-100 text-amber-800",
  TECHNICIAN: "bg-teal-100 text-teal-800",
  CLINICIAN: "bg-emerald-100 text-emerald-800",
  ADMIN: "bg-slate-100 text-slate-800",
  PROCUREMENT: "bg-orange-100 text-orange-800",
  OTHER: "bg-gray-100 text-gray-800",
};

export const CRM_GRADUATION_STATUSES = [
  "NOT_APPLICABLE",
  "ENROLLED",
  "GRADUATING_SOON",
  "GRADUATED",
  "UNKNOWN",
] as const;
export type CrmGraduationStatus = (typeof CRM_GRADUATION_STATUSES)[number];
export const GRADUATION_STATUS_LABELS: Record<string, string> = {
  NOT_APPLICABLE: "不适用",
  ENROLLED: "在读",
  GRADUATING_SOON: "即将毕业",
  GRADUATED: "已毕业",
  UNKNOWN: "未知",
};
export const GRADUATION_STATUS_COLORS: Record<string, string> = {
  NOT_APPLICABLE: "bg-gray-100 text-gray-800",
  ENROLLED: "bg-blue-100 text-blue-800",
  GRADUATING_SOON: "bg-amber-100 text-amber-800",
  GRADUATED: "bg-green-100 text-green-800",
  UNKNOWN: "bg-slate-100 text-slate-800",
};

export const CRM_SITE_TYPES = [
  "CAMPUS",
  "COLLEGE",
  "BUILDING",
  "OTHER",
] as const;
export type CrmSiteType = (typeof CRM_SITE_TYPES)[number];
export const SITE_TYPE_LABELS: Record<string, string> = {
  CAMPUS: "院区",
  COLLEGE: "学院/院系",
  BUILDING: "大楼",
  OTHER: "其他",
};

export const GRADUATION_LOOKAHEAD_DAYS = 90;
