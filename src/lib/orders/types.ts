import type {
  OrderSource,
  OrderCategory,
  OrderStatus,
  OrderDeliveryStatus,
  OrderFinanceTreatment,
  OrderProjectRelationType,
  OrderMatchStatus,
  OrderDuplicateStatus,
} from "./constants";

// Core Order type matching Prisma model
export interface OrderRecord {
  id: string;
  orderNo: string;
  source: OrderSource;
  sourcePlatform: string | null;
  externalOrderNo: string | null;
  merchantOrderNo: string | null;
  legacyExternalOrderId: string | null;
  title: string;
  description: string | null;
  category: OrderCategory;
  status: OrderStatus;
  deliveryStatus: OrderDeliveryStatus;
  orderedAt: string | null;
  confirmedAt: string | null;
  deliveredAt: string | null;
  customerId: string | null;
  buyerNameSnapshot: string | null;
  buyerPhoneSnapshot: string | null;
  buyerWechatSnapshot: string | null;
  buyerOrgNameSnapshot: string | null;
  buyerAddressSnapshot: string | null;
  customerMatchStatus: OrderMatchStatus;
  customerMatchScore: number | null;
  customerMatchReason: string | null;
  totalAmount: number;
  financeAmountOverride: number | null;
  financeTreatment: OrderFinanceTreatment;
  financeNote: string | null;
  ownerUserId: string | null;
  representativeId: string | null;
  createdById: string;
  archived: boolean;
  deleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderLineRecord {
  id: string;
  orderId: string;
  itemName: string;
  spec: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  category: string;
  sortOrder: number;
  rawJson: string | null;
}

export interface OrderSourceRecordRecord {
  id: string;
  orderId: string | null;
  importBatchId: string | null;
  source: string;
  platform: string | null;
  externalOrderNo: string;
  merchantOrderNo: string | null;
  duplicateGroupId: string | null;
  duplicateStatus: OrderDuplicateStatus;
  rawJson: string | null;
  rawText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderProjectLinkRecord {
  id: string;
  orderId: string;
  projectId: string;
  relationType: OrderProjectRelationType;
  treatment: OrderFinanceTreatment;
  allocatedAmount: number | null;
  isPrimary: boolean;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderStatusHistoryRecord {
  id: string;
  orderId: string;
  oldStatus: string | null;
  newStatus: string | null;
  oldDeliveryStatus: string | null;
  newDeliveryStatus: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface OrderMergeRecord {
  id: string;
  sourceOrderId: string;
  targetOrderId: string;
  reason: string | null;
  createdById: string | null;
  createdAt: string;
}

// Order list item (denormalized for display)
export interface OrderListItem extends OrderRecord {
  customer?: { id: string; name: string } | null;
  representative?: { id: string; name: string } | null;
  projectLinks?: (OrderProjectLinkRecord & { project?: { id: string; name: string } | null })[];
  _count?: { lines: number; receipts: number };
}

// Order detail (full expansion)
export interface OrderDetail extends OrderRecord {
  customer?: { id: string; name: string } | null;
  representative?: { id: string; name: string } | null;
  lines?: OrderLineRecord[];
  sourceRecords?: OrderSourceRecordRecord[];
  projectLinks?: (OrderProjectLinkRecord & { project?: { id: string; name: string } | null })[];
  statusHistory?: OrderStatusHistoryRecord[];
  mergeSources?: (OrderMergeRecord & { sourceOrder?: { id: string; orderNo: string } | null })[];
  mergeTargets?: (OrderMergeRecord & { targetOrder?: { id: string; orderNo: string } | null })[];
  _count?: { lines: number; sourceRecords: number; projectLinks: number; receipts: number };
}

// Effective financial amount
export function getEffectiveOrderAmount(order: OrderRecord): number {
  return order.financeAmountOverride ?? order.totalAmount;
}

// Order list query params
export interface OrderListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  source?: string;
  status?: string;
  deliveryStatus?: string;
  category?: string;
  customerMatchStatus?: string;
  financeTreatment?: string;
  customerId?: string;
  projectId?: string;
  representativeId?: string;
}
