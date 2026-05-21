import { prisma } from "@/lib/prisma";
import { isProductProject } from "./types";
import { collectByChunks } from "./query-chunk";

// ─── Date helpers ──────────────────────────────────────────────

function getWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(now); start.setDate(now.getDate() - diff); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ─── Project date resolution ──────────────────────────────────

export function getProjectStartDate(project: {
  startDate: Date | string | null;
  createdAt: Date | string;
}): Date {
  if (project.startDate) return new Date(project.startDate);
  return new Date(project.createdAt);
}

export function getProjectCompletionDate(project: {
  id: string;
  endDate: Date | string | null;
  status: string;
}): Date | null {
  return project.endDate ? new Date(project.endDate) : null;
}

export async function resolveProjectCompletionDate(project: {
  id: string;
  endDate: Date | string | null;
  status: string;
  statusHistory?: Array<{ newStatus: string; createdAt: Date | string }>;
}): Promise<Date | null> {
  if (project.statusHistory) {
    const completed = project.statusHistory.find((h) => h.newStatus === "COMPLETED");
    if (completed) return new Date(completed.createdAt);
  } else if (project.status === "COMPLETED") {
    const sh = await prisma.statusHistory.findFirst({
      where: { projectId: project.id, newStatus: "COMPLETED" },
      orderBy: { createdAt: "desc" },
    });
    if (sh) return new Date(sh.createdAt);
  }
  if (project.endDate) return new Date(project.endDate);
  return null;
}

// ─── Order date resolution (unified Order model) ──────────────

export function getOrderDate(order: {
  orderedAt: Date | string | null;
  confirmedAt: Date | string | null;
  createdAt: Date | string;
}): Date {
  if (order.orderedAt) return new Date(order.orderedAt);
  if (order.confirmedAt) return new Date(order.confirmedAt);
  return new Date(order.createdAt);
}

// ─── Order finance helpers (unified Order model) ───────────────

export type FinanceCategory = "UNKNOWN" | "PRODUCT" | "SERVICE";
export type FinanceTreatment = "AUTO" | "STANDALONE" | "PROJECT_INCLUDED" | "EXCLUDED";

export function computeOrderFinanceAmount(order: {
  totalAmount: number;
  financeAmountOverride: number | null;
}): number {
  if (order.financeAmountOverride != null) return order.financeAmountOverride;
  return order.totalAmount ?? 0;
}

/**
 * Derive effective finance treatment for an order.
 * When financeTreatment is AUTO, fall back to whether the order has any
 * OrderProjectLink, so that orders bound to projects auto-include.
 */
export function getOrderEffectiveTreatment(
  financeTreatment: string,
  hasProjectLinks: boolean,
): FinanceTreatment {
  if (financeTreatment !== "AUTO") return financeTreatment as FinanceTreatment;
  return hasProjectLinks ? "PROJECT_INCLUDED" : "STANDALONE";
}

export function isOrderStandalone(financeTreatment: string, hasProjectLinks: boolean): boolean {
  return getOrderEffectiveTreatment(financeTreatment, hasProjectLinks) === "STANDALONE";
}

export function isOrderProjectLinked(financeTreatment: string, hasProjectLinks: boolean): boolean {
  return getOrderEffectiveTreatment(financeTreatment, hasProjectLinks) === "PROJECT_INCLUDED";
}

// ─── Progress receivable computation ───────────────────────────

export interface ProgressReceivableResult {
  total: number;
  serviceDeposit: number;
  serviceFinal: number;
  productReceivable: number;
}

export function computeProjectProgressReceivable(
  project: {
    budgetAmount: number | null;
    projectType: string | null;
    startDate: Date | string | null;
    createdAt: Date | string;
    completionDate: Date | null;
  },
  periodStart: Date,
  periodEnd: Date,
): ProgressReceivableResult {
  const budget = project.budgetAmount ?? 0;
  const startDate = getProjectStartDate(project);
  const startedInPeriod = startDate >= periodStart && startDate <= periodEnd;
  const completedInPeriod = project.completionDate
    ? project.completionDate >= periodStart && project.completionDate <= periodEnd
    : false;

  let serviceDeposit = 0;
  let serviceFinal = 0;
  let productReceivable = 0;

  if (isProductProject(project.projectType)) {
    if (startedInPeriod) productReceivable = budget;
  } else {
    if (startedInPeriod && completedInPeriod) {
      serviceDeposit = budget * 0.3;
      serviceFinal = budget * 0.7;
    } else if (startedInPeriod) {
      serviceDeposit = budget * 0.3;
    } else if (completedInPeriod) {
      serviceFinal = budget * 0.7;
    }
  }

  return { total: serviceDeposit + serviceFinal + productReceivable, serviceDeposit, serviceFinal, productReceivable };
}

export function computeStandaloneOrderReceivable(
  order: {
    totalAmount: number;
    financeAmountOverride: number | null;
    category: string;
    financeTreatment: string;
    hasProjectLinks: boolean;
    orderedAt: Date | string | null;
    confirmedAt: Date | string | null;
    createdAt: Date | string;
  },
  periodStart: Date,
  periodEnd: Date,
): number {
  const treatment = getOrderEffectiveTreatment(order.financeTreatment, order.hasProjectLinks);
  if (treatment === "PROJECT_INCLUDED" || treatment === "EXCLUDED") return 0;

  const orderDate = getOrderDate(order);
  if (orderDate < periodStart || orderDate > periodEnd) return 0;

  const amount = computeOrderFinanceAmount(order);
  if (order.category === "PRODUCT") return amount;
  return amount * 0.3;
}

export async function computeAllProgressReceivables(
  projects: Array<{
    id: string;
    budgetAmount: number | null;
    projectType: string | null;
    startDate: Date | string | null;
    createdAt: Date | string;
    endDate: Date | string | null;
    status: string;
  }>,
  orders: Array<{
    totalAmount: number;
    financeAmountOverride: number | null;
    category: string;
    financeTreatment: string;
    hasProjectLinks: boolean;
    orderedAt: Date | string | null;
    confirmedAt: Date | string | null;
    createdAt: Date | string;
  }>,
  scopedOrderIds?: string[],
  scopedProjectIds?: string[],
): Promise<{
  weekProject: ProgressReceivableResult;
  monthProject: ProgressReceivableResult;
  weekOrder: number;
  monthOrder: number;
}> {
  const week = getWeekRange();
  const month = getMonthRange();

  let weekProject: ProgressReceivableResult = { total: 0, serviceDeposit: 0, serviceFinal: 0, productReceivable: 0 };
  let monthProject: ProgressReceivableResult = { total: 0, serviceDeposit: 0, serviceFinal: 0, productReceivable: 0 };

  for (const p of projects) {
    const completionDate = await resolveProjectCompletionDate(p);
    const wp = computeProjectProgressReceivable({ ...p, completionDate }, week.start, week.end);
    const mp = computeProjectProgressReceivable({ ...p, completionDate }, month.start, month.end);
    weekProject = {
      total: weekProject.total + wp.total,
      serviceDeposit: weekProject.serviceDeposit + wp.serviceDeposit,
      serviceFinal: weekProject.serviceFinal + wp.serviceFinal,
      productReceivable: weekProject.productReceivable + wp.productReceivable,
    };
    monthProject = {
      total: monthProject.total + mp.total,
      serviceDeposit: monthProject.serviceDeposit + mp.serviceDeposit,
      serviceFinal: monthProject.serviceFinal + mp.serviceFinal,
      productReceivable: monthProject.productReceivable + mp.productReceivable,
    };
  }

  let weekOrder = 0;
  let monthOrder = 0;
  for (const o of orders) {
    weekOrder += computeStandaloneOrderReceivable(o, week.start, week.end);
    monthOrder += computeStandaloneOrderReceivable(o, month.start, month.end);
  }

  // Add revision adjustments for the periods
  const [weekAdjustment, monthAdjustment] = await Promise.all([
    getProgressAdjustmentsForDateRange(week.start, week.end, scopedOrderIds, scopedProjectIds),
    getProgressAdjustmentsForDateRange(month.start, month.end, scopedOrderIds, scopedProjectIds),
  ]);
  weekOrder += weekAdjustment;
  monthOrder += monthAdjustment;

  return { weekProject, monthProject, weekOrder, monthOrder };
}

type ProgressAdjustmentRow = {
  id: string;
  orderId: string | null;
  projectId: string | null;
  customerId: string | null;
  amount: number;
  category: string;
  reason: string | null;
  periodKey: string;
  sourceId: string;
  sourceType: string;
  occurredAt: Date;
};

async function fetchProgressAdjustmentsByScope(
  where: Record<string, unknown>,
  scopedOrderIds?: string[],
  scopedProjectIds?: string[],
): Promise<ProgressAdjustmentRow[]> {
  if (scopedOrderIds !== undefined || scopedProjectIds !== undefined) {
    if ((scopedOrderIds?.length ?? 0) === 0 && (scopedProjectIds?.length ?? 0) === 0) {
      return [];
    }

    const seen = new Set<string>();
    const result: ProgressAdjustmentRow[] = [];
    const pushUnique = (rows: ProgressAdjustmentRow[]) => {
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        result.push(row);
      }
    };

    if (scopedOrderIds?.length) {
      const orderRows = await collectByChunks(scopedOrderIds, (chunk) =>
        prisma.progressReceivableAdjustment.findMany({
          where: { ...where, orderId: { in: chunk } },
          select: {
            id: true,
            orderId: true,
            projectId: true,
            customerId: true,
            amount: true,
            category: true,
            reason: true,
            periodKey: true,
            sourceId: true,
            sourceType: true,
            occurredAt: true,
          },
          orderBy: { occurredAt: "desc" },
        })
      );
      pushUnique(orderRows);
    }

    if (scopedProjectIds?.length) {
      const projectRows = await collectByChunks(scopedProjectIds, (chunk) =>
        prisma.progressReceivableAdjustment.findMany({
          where: { ...where, projectId: { in: chunk } },
          select: {
            id: true,
            orderId: true,
            projectId: true,
            customerId: true,
            amount: true,
            category: true,
            reason: true,
            periodKey: true,
            sourceId: true,
            sourceType: true,
            occurredAt: true,
          },
          orderBy: { occurredAt: "desc" },
        })
      );
      pushUnique(projectRows);
    }

    result.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return result;
  }

  return prisma.progressReceivableAdjustment.findMany({
    where,
    select: {
      id: true,
      orderId: true,
      projectId: true,
      customerId: true,
      amount: true,
      category: true,
      reason: true,
      periodKey: true,
      sourceId: true,
      sourceType: true,
      occurredAt: true,
    },
    orderBy: { occurredAt: "desc" },
  });
}

// ─── Revision adjustment helpers ──────────────────────────────────

export async function getProgressAdjustmentsForDateRange(
  start: Date,
  end: Date,
  scopedOrderIds?: string[],
  scopedProjectIds?: string[],
): Promise<number> {
  const where: Record<string, unknown> = { occurredAt: { gte: start, lte: end } };
  const adjustments = await fetchProgressAdjustmentsByScope(where, scopedOrderIds, scopedProjectIds);
  return adjustments.reduce((sum, item) => sum + item.amount, 0);
}

export async function getProgressAdjustmentsForPeriodWithDetails(
  periodKey: string,
  scopedOrderIds?: string[],
  scopedProjectIds?: string[],
): Promise<ProgressAdjustmentRow[]> {
  return fetchProgressAdjustmentsByScope({ periodKey }, scopedOrderIds, scopedProjectIds);
}

export async function getProgressAdjustmentsForDateRangeWithDetails(
  start: Date,
  end: Date,
  scopedOrderIds?: string[],
  scopedProjectIds?: string[],
): Promise<ProgressAdjustmentRow[]> {
  return fetchProgressAdjustmentsByScope({ occurredAt: { gte: start, lte: end } }, scopedOrderIds, scopedProjectIds);
}
