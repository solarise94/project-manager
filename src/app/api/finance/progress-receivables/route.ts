import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceProjectScopeWhere, getFinanceCustomerScopeWhere } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";
import { isProductProject } from "@/lib/finance/types";
import { getProjectStartDate, getOrderDate, getOrderEffectiveTreatment, computeOrderFinanceAmount, resolveProjectCompletionDate } from "@/lib/finance/progress";
import { getProjectTypeLabel } from "@/lib/project-type";

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(now); start.setDate(now.getDate() - diff); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return { start, end };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = req.nextUrl;
  const period = url.searchParams.get("period") || "week";
  const range = period === "month" ? getMonthRange() : getWeekRange();

  const projectWhere: Record<string, unknown> = { deleted: false };
  if (session.user.role !== "ADMIN") {
    const projScope = await getFinanceProjectScopeWhere(session.user.id, session.user.role);
    if (projScope) projectWhere.id = projScope.id;
  }

  const customerScope = session.user.role !== "ADMIN"
    ? await getFinanceCustomerScopeWhere(session.user.id, session.user.role)
    : null;

  const allProjects = await prisma.project.findMany({
    where: projectWhere,
    select: {
      id: true, name: true, budgetAmount: true, projectType: true,
      startDate: true, createdAt: true, endDate: true, status: true,
      cust: { select: { id: true, name: true } },
    },
  });

  // Order scope: customerScope OR projectScope→linked orders
  const orderOrConditions: Record<string, unknown>[] = [];
  if (customerScope) orderOrConditions.push({ customerId: { in: customerScope.id.in } });
  if (session.user.role !== "ADMIN") {
    const projScope = await getFinanceProjectScopeWhere(session.user.id, session.user.role);
    if (projScope) {
      const projectOrders = await prisma.orderProjectLink.findMany({
        where: { projectId: { in: projScope.id.in } },
        select: { orderId: true },
        distinct: ["orderId"],
      });
      if (projectOrders.length > 0) orderOrConditions.push({ id: { in: projectOrders.map((l) => l.orderId) } });
    }
  }
  const orderWhere: Record<string, unknown> = { deleted: false };
  if (orderOrConditions.length === 1) Object.assign(orderWhere, orderOrConditions[0]);
  else if (orderOrConditions.length > 1) orderWhere.OR = orderOrConditions;

  const allOrders = await prisma.order.findMany({
    where: orderWhere,
    select: {
      id: true, orderNo: true, totalAmount: true,
      category: true, financeTreatment: true, financeAmountOverride: true,
      orderedAt: true, confirmedAt: true, createdAt: true,
      customer: { select: { id: true, name: true } },
    },
  });

  // Pre-fetch project links for AUTO resolution
  const orderIds = allOrders.map((o) => o.id);
  const linkMap = new Map<string, boolean>();
  if (orderIds.length > 0) {
    const links = await prisma.orderProjectLink.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true },
      distinct: ["orderId"],
    });
    for (const l of links) linkMap.set(l.orderId, true);
  }

  const projectItems: Array<Record<string, unknown>> = [];
  const orderItems: Array<Record<string, unknown>> = [];

  let totalServiceDeposit = 0;
  let totalServiceFinal = 0;
  let totalProductReceivable = 0;

  for (const p of allProjects) {
    const budget = p.budgetAmount ?? 0;
    const startDate = getProjectStartDate(p);
    const completionDate = await resolveProjectCompletionDate(p);
    const startedIn = startDate >= range.start && startDate <= range.end;
    const completedIn = completionDate ? completionDate >= range.start && completionDate <= range.end : false;
    const isProduct = isProductProject(p.projectType);

    if (isProduct) {
      if (startedIn) {
        totalProductReceivable += budget;
        projectItems.push({
          projectId: p.id, projectName: p.name, customerName: p.cust?.name || "",
          projectType: getProjectTypeLabel(p.projectType),
          eventType: "PRODUCT_START", eventDate: startDate.toISOString(),
          budgetAmount: budget, receivableAmount: budget, rate: 1,
        });
      }
    } else {
      if (startedIn) {
        totalServiceDeposit += budget * 0.3;
        projectItems.push({
          projectId: p.id, projectName: p.name, customerName: p.cust?.name || "",
          projectType: getProjectTypeLabel(p.projectType),
          eventType: "SERVICE_START", eventDate: startDate.toISOString(),
          budgetAmount: budget, receivableAmount: budget * 0.3, rate: 0.3,
        });
      }
      if (completedIn) {
        totalServiceFinal += budget * 0.7;
        projectItems.push({
          projectId: p.id, projectName: p.name, customerName: p.cust?.name || "",
          projectType: getProjectTypeLabel(p.projectType),
          eventType: "SERVICE_COMPLETED", eventDate: (completionDate || new Date()).toISOString(),
          budgetAmount: budget, receivableAmount: budget * 0.7, rate: 0.7,
        });
      }
    }
  }

  let orderDepositTotal = 0;
  let orderProductTotal = 0;

  for (const o of allOrders) {
    const treatment = getOrderEffectiveTreatment(o.financeTreatment, linkMap.has(o.id));
    if (treatment !== "STANDALONE") continue;
    const orderDate = getOrderDate(o);
    if (orderDate < range.start || orderDate > range.end) continue;
    const amount = computeOrderFinanceAmount(o);
    const cat = o.category;
    if (cat === "PRODUCT") {
      orderProductTotal += amount;
      orderItems.push({
        orderId: o.id, orderNo: o.orderNo,
        customerName: o.customer?.name || "",
        financeCategory: cat,
        eventType: "PRODUCT_ORDER", eventDate: orderDate.toISOString(),
        amount, receivableAmount: amount, rate: 1,
      });
    } else {
      orderDepositTotal += amount * 0.3;
      orderItems.push({
        orderId: o.id, orderNo: o.orderNo,
        customerName: o.customer?.name || "",
        financeCategory: cat,
        eventType: "SERVICE_ORDER_DEPOSIT", eventDate: orderDate.toISOString(),
        amount, receivableAmount: amount * 0.3, rate: 0.3,
      });
    }
  }

  return NextResponse.json({
    period,
    total: totalServiceDeposit + totalServiceFinal + totalProductReceivable + orderDepositTotal + orderProductTotal,
    serviceDeposit: totalServiceDeposit,
    serviceFinal: totalServiceFinal,
    productReceivable: totalProductReceivable,
    projectItems,
    orderItems,
  });
}
