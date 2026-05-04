// Order source types
export const ORDER_SOURCE = {
  MANUAL: "MANUAL",
  PINGOODMICE: "PINGOODMICE",
  OTHER_IMPORT: "OTHER_IMPORT",
} as const;
export type OrderSource = (typeof ORDER_SOURCE)[keyof typeof ORDER_SOURCE];

// Order category
export const ORDER_CATEGORY = {
  SERVICE: "SERVICE",
  PRODUCT: "PRODUCT",
  MIXED: "MIXED",
  UNKNOWN: "UNKNOWN",
} as const;
export type OrderCategory = (typeof ORDER_CATEGORY)[keyof typeof ORDER_CATEGORY];

// Order status
export const ORDER_STATUS = {
  DRAFT: "DRAFT",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  CLOSED: "CLOSED",
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

// Order delivery status
export const ORDER_DELIVERY_STATUS = {
  PENDING: "PENDING",
  PARTIAL: "PARTIAL",
  DELIVERED: "DELIVERED",
  WAIVED: "WAIVED",
} as const;
export type OrderDeliveryStatus = (typeof ORDER_DELIVERY_STATUS)[keyof typeof ORDER_DELIVERY_STATUS];

// Order finance treatment
export const ORDER_FINANCE_TREATMENT = {
  AUTO: "AUTO",
  STANDALONE: "STANDALONE",
  PROJECT_INCLUDED: "PROJECT_INCLUDED",
  EXCLUDED: "EXCLUDED",
} as const;
export type OrderFinanceTreatment = (typeof ORDER_FINANCE_TREATMENT)[keyof typeof ORDER_FINANCE_TREATMENT];

// Order project relation type
export const ORDER_PROJECT_RELATION_TYPE = {
  GENERATED: "GENERATED",
  LINKED: "LINKED",
  SPLIT: "SPLIT",
  SUPPLEMENT: "SUPPLEMENT",
} as const;
export type OrderProjectRelationType = (typeof ORDER_PROJECT_RELATION_TYPE)[keyof typeof ORDER_PROJECT_RELATION_TYPE];

// Customer match status
export const ORDER_MATCH_STATUS = {
  UNMATCHED: "UNMATCHED",
  AUTO_MATCHED: "AUTO_MATCHED",
  MANUAL_MATCHED: "MANUAL_MATCHED",
  CONFLICT: "CONFLICT",
} as const;
export type OrderMatchStatus = (typeof ORDER_MATCH_STATUS)[keyof typeof ORDER_MATCH_STATUS];

// Duplicate status (mirrors ExternalOrder for migration compatibility)
export const ORDER_DUPLICATE_STATUS = {
  UNREVIEWED: "UNREVIEWED",
  UNIQUE: "UNIQUE",
  DUPLICATE: "DUPLICATE",
  MERGED: "MERGED",
  IGNORED: "IGNORED",
} as const;
export type OrderDuplicateStatus = (typeof ORDER_DUPLICATE_STATUS)[keyof typeof ORDER_DUPLICATE_STATUS];

// Allowed status transitions
export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "CLOSED"],
  CANCELLED: ["DRAFT"], // ADMIN only
  CLOSED: ["CONFIRMED"], // ADMIN only
};

// Allowed delivery status transitions
export const ORDER_DELIVERY_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["PARTIAL", "DELIVERED", "WAIVED"],
  PARTIAL: ["DELIVERED", "WAIVED"],
  DELIVERED: ["WAIVED"],
  WAIVED: ["PENDING"], // ADMIN only
};

// Order No prefixes
export const ORDER_NO_PREFIX = {
  MANUAL: "SO",
  PINGOODMICE: "PO",
  OTHER_IMPORT: "IO",
} as const;

// Finance category to order category mapping
export const FINANCE_CATEGORY_MAP: Record<string, string> = {
  PRODUCT: ORDER_CATEGORY.PRODUCT,
  SERVICE: ORDER_CATEGORY.SERVICE,
};

// Default treatment auto-derivation rules
export function deriveDefaultTreatment(
  category: string,
  hasProjectLinks: boolean,
): string {
  if (category === ORDER_CATEGORY.PRODUCT) return ORDER_FINANCE_TREATMENT.STANDALONE;
  if (!hasProjectLinks) return ORDER_FINANCE_TREATMENT.STANDALONE;
  if (category === ORDER_CATEGORY.SERVICE) return ORDER_FINANCE_TREATMENT.PROJECT_INCLUDED;
  return ORDER_FINANCE_TREATMENT.AUTO;
}

// Migrate ExternalOrder to Order status and finance exclusion.
// mergedIntoId is the authoritative signal: a source order that was merged into
// another order must be excluded from finance even if duplicateStatus drifted.
export function mapExternalOrderStatus(params: {
  duplicateStatus: string;
  mergedIntoId: string | null;
}): { status: string; deleted: boolean; archived: boolean; financeTreatment: string } {
  const isMergedSource = !!params.mergedIntoId || params.duplicateStatus === "MERGED";
  if (isMergedSource) {
    return {
      status: ORDER_STATUS.CONFIRMED,
      deleted: true,
      archived: true,
      financeTreatment: ORDER_FINANCE_TREATMENT.EXCLUDED,
    };
  }
  return {
    status: ORDER_STATUS.CONFIRMED,
    deleted: false,
    archived: false,
    financeTreatment: ORDER_FINANCE_TREATMENT.AUTO,
  };
}
