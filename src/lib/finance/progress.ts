import { prisma } from "@/lib/prisma";
import { isProductProject } from "./types";

// ─── Date helpers ──────────────────────────────────────────────

function getWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday start
  const start = new Date(now);
  start.setDate(now.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
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
  // Will be resolved async via statusHistory
  return project.endDate ? new Date(project.endDate) : null;
}

export async function resolveProjectCompletionDate(project: {
  id: string;
  endDate: Date | string | null;
  status: string;
  statusHistory?: Array<{ newStatus: string; createdAt: Date | string }>;
}): Promise<Date | null> {
  // Check statusHistory for COMPLETED transition
  if (project.statusHistory) {
    const completed = project.statusHistory.find((h) => h.newStatus === "COMPLETED");
    if (completed) return new Date(completed.createdAt);
  } else if (project.status === "COMPLETED") {
    // Query statusHistory
    const sh = await prisma.statusHistory.findFirst({
      where: { projectId: project.id, newStatus: "COMPLETED" },
      orderBy: { createdAt: "desc" },
    });
    if (sh) return new Date(sh.createdAt);
  }
  // Fallback to endDate
  if (project.endDate) return new Date(project.endDate);
  return null;
}

// ─── Order date resolution ─────────────────────────────────────

export function getOrderDate(order: {
  orderAt: Date | string | null;
  paidAt: Date | string | null;
  createdAt: Date | string;
}): Date {
  if (order.orderAt) return new Date(order.orderAt);
  if (order.paidAt) return new Date(order.paidAt);
  return new Date(order.createdAt);
}

// ─── Order finance helpers ─────────────────────────────────────

export type FinanceCategory = "UNKNOWN" | "PRODUCT" | "SERVICE";
export type FinanceTreatment = "AUTO" | "STANDALONE" | "PROJECT_INCLUDED" | "EXCLUDED";

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
}): FinanceTreatment {
  if (order.financeTreatment !== "AUTO") return order.financeTreatment as FinanceTreatment;
  return order.projectId ? "PROJECT_INCLUDED" : "STANDALONE";
}

export function isOrderStandalone(order: {
  projectId: string | null;
  financeTreatment: string;
}): boolean {
  const treatment = getOrderEffectiveTreatment(order);
  return treatment === "STANDALONE";
}

export function isOrderProjectLinked(order: {
  projectId: string | null;
  financeTreatment: string;
}): boolean {
  const treatment = getOrderEffectiveTreatment(order);
  return treatment === "PROJECT_INCLUDED" && !!order.projectId;
}

// ─── Progress receivable computation ───────────────────────────

export interface ProgressReceivableResult {
  total: number;
  serviceDeposit: number;   // 30% on start
  serviceFinal: number;     // 70% on completion
  productReceivable: number; // 100% on start
}

export function computeProjectProgressReceivable(
  project: {
    budgetAmount: number | null;
    projectType: string | null;
    startDate: Date | string | null;
    createdAt: Date | string;
    completionDate: Date | null; // pre-resolved
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
    // Service project
    if (startedInPeriod && completedInPeriod) {
      serviceDeposit = budget * 0.3;
      serviceFinal = budget * 0.7;
    } else if (startedInPeriod) {
      serviceDeposit = budget * 0.3;
    } else if (completedInPeriod) {
      serviceFinal = budget * 0.7;
    }
  }

  return {
    total: serviceDeposit + serviceFinal + productReceivable,
    serviceDeposit,
    serviceFinal,
    productReceivable,
  };
}

export function computeStandaloneOrderReceivable(
  order: {
    paidAmount: number | null;
    financeAmountOverride: number | null;
    financeCategory: string;
    financeTreatment: string;
    projectId: string | null;
    orderAt: Date | string | null;
    paidAt: Date | string | null;
    createdAt: Date | string;
  },
  periodStart: Date,
  periodEnd: Date,
): number {
  const treatment = getOrderEffectiveTreatment(order);
  if (treatment === "PROJECT_INCLUDED" || treatment === "EXCLUDED") return 0;

  const orderDate = getOrderDate(order);
  if (orderDate < periodStart || orderDate > periodEnd) return 0;

  const amount = computeOrderFinanceAmount(order);
  const category = order.financeCategory;

  if (category === "PRODUCT") return amount;
  // SERVICE or UNKNOWN treated as service
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
    paidAmount: number | null;
    financeAmountOverride: number | null;
    financeCategory: string;
    financeTreatment: string;
    projectId: string | null;
    orderAt: Date | string | null;
    paidAt: Date | string | null;
    createdAt: Date | string;
  }>,
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

  return { weekProject, monthProject, weekOrder, monthOrder };
}
