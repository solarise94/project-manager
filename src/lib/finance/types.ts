export interface FinanceSummary {
  totalOnlineOrderAmount: number;
  matchedOnlineOrderAmount: number;
  unmatchedOnlineOrderAmount: number;
  totalProjectBudgetAmount: number;
  projectLinkedOrderAmount: number;
  standaloneOnlineOrderAmount: number;
  effectiveBusinessAmount: number;
  projectInvoicedAmount: number;
  orderInvoicedAmount: number;
  totalReceiptAmount: number;
  pendingInvoiceCount: number;
  customerCount: number;
  projectCount: number;
  receiptCount: number;
  weekProgressReceivable: number;
  monthProgressReceivable: number;
  weekServiceDeposit: number;
  weekServiceFinal: number;
  weekProductReceivable: number;
  monthServiceDeposit: number;
  monthServiceFinal: number;
  monthProductReceivable: number;
  costAmount: number;
  profitAmount: number;
  profitRate: number | null;
  unmatchedOrderCount: number;
  unmatchedOrderAmount: number;
  uninvoicedOrderCount: number;
  uninvoicedOrderAmount: number;
  invoicedUnpaidOrderCount: number;
  invoicedUnpaidOrderAmount: number;
  advanceRefundPendingCount: number;
  advanceRefundPendingAmount: number;
}

export interface CustomerFinanceItem {
  id: string;
  name: string;
  customerCode: string;
  organization: string | null;
  onlineOrderCount: number;
  onlineOrderTotalAmount: number;
  projectLinkedOrderAmount: number;
  standaloneOnlineOrderAmount: number;
  projectCount: number;
  projectBudgetTotalAmount: number;
  effectiveBusinessAmount: number;
  receivableAmount: number;
  projectInvoicedAmount: number;
  orderInvoicedAmount: number;
  totalReceiptAmount: number;
  outstandingAmount: number;
}

export interface CustomerFinanceDetail {
  customer: {
    id: string;
    name: string;
    customerCode: string;
    organization: string | null;
    wechat: string | null;
    principal: string | null;
  };
  summary: {
    onlineOrderTotal: number;
    standaloneOnlineOrderAmount: number;
    projectLinkedOrderAmount: number;
    projectBudgetTotal: number;
    effectiveBusinessAmount: number;
    receivableAmount: number;
    projectInvoicedAmount: number;
    orderInvoicedAmount: number;
    totalReceiptAmount: number;
    outstandingAmount: number;
  };
  onlineOrders: Array<{
    id: string;
    orderNo: string;
    totalAmount: number;
    orderedAt: string | null;
    customerMatchStatus: string;
    source: string;
    category: string;
    financeTreatment: string;
    financeAmountOverride: number | null;
  }>;
  projects: Array<{
    id: string;
    name: string;
    budgetAmount: number | null;
    status: string;
    progress: number;
  }>;
  projectInvoices: Array<{
    id: string;
    totalAmount: number;
    status: string;
    invoiceType: string;
    createdAt: string;
  }>;
  orderInvoices: Array<{
    id: string;
    totalAmount: number;
    status: string;
    invoiceType: string;
    createdAt: string;
  }>;
  receipts: Array<{
    id: string;
    amount: number;
    receivedAt: string;
    source: string;
    remark: string | null;
  }>;
}

export interface MatchResult {
  orderId: string;
  externalOrderNo: string;
  status: "MATCHED" | "CONFLICT" | "UNMATCHED" | "MANUAL";
  score: number | null;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  reason: string | null;
  candidates?: Array<{ customerId: string; name: string; score: number }>;
}

export interface MatchScanResult {
  scanned: number;
  matched: number;
  conflicted: number;
  unmatched: number;
  details: MatchResult[];
}

export interface FinanceCustomerListResponse {
  customers: CustomerFinanceItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type MatchStatus = "UNMATCHED" | "AUTO_MATCHED" | "MANUAL_MATCHED" | "CONFLICT";

export function isProjectCompleted(project: { status: string; progress: number }): boolean {
  return project.status === "COMPLETED" || project.progress >= 100;
}

export function isProductProject(projectType: string | null | undefined): boolean {
  if (!projectType) return false;
  if (isProductProjectType(projectType)) return true;
  const t = projectType.toLowerCase();
  return t.includes("耗材") || t.includes("设备");
}

export function computeProjectReceivable(project: { budgetAmount?: number | null; projectType?: string | null; status: string; progress: number }): number {
  const budget = project.budgetAmount || 0;
  if (isProductProject(project.projectType)) return budget;
  if (isProjectCompleted(project)) return budget;
  return budget * 0.3;
}

export function computeOrderFinanceAmount(order: {
  paidAmount: number | null;
  financeAmountOverride: number | null;
}): number {
  if (order.financeAmountOverride != null) return order.financeAmountOverride;
  return order.paidAmount ?? 0;
}

export function getOrderEffectiveTreatment(order: {
  projectId: string | null;
  financeTreatment: string;
}): string {
  if (order.financeTreatment !== "AUTO") return order.financeTreatment;
  return order.projectId ? "PROJECT_INCLUDED" : "STANDALONE";
}

export function isOrderStandalone(order: {
  projectId: string | null;
  financeTreatment: string;
}): boolean {
  return getOrderEffectiveTreatment(order) === "STANDALONE";
}
import { isProductProjectType } from "@/lib/project-type";
