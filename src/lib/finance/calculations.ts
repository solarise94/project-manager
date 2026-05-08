import { prisma } from "@/lib/prisma";
import type {
  FinanceSummary,
  CustomerFinanceItem,
  CustomerFinanceDetail,
  FinanceCustomerListResponse,
} from "./types";
import { computeProjectReceivable } from "./types";
import { computeOrderFinanceAmount, getOrderEffectiveTreatment, computeAllProgressReceivables } from "./progress";
import { computeBatchProjectRevenue } from "./ledger";
import type { Prisma } from "@prisma/client";

/** Build a mapping of orderId → hasProjectLinks for efficient treatment derivation. */
async function buildOrderProjectLinkMap(orderIds: string[]): Promise<Map<string, boolean>> {
  if (orderIds.length === 0) return new Map();
  const links = await prisma.orderProjectLink.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  const map = new Map<string, boolean>();
  for (const l of links) map.set(l.orderId, true);
  return map;
}

export async function getFinanceSummary(
  customerScope: { id: { in: string[] } } | null,
  projectScope: { id: { in: string[] } } | null
): Promise<FinanceSummary> {
  const customerWhere = customerScope
    ? { deleted: false, id: customerScope.id }
    : { deleted: false };

  const projectWhere: Prisma.ProjectWhereInput = {
    deleted: false,
    ...(projectScope ? { id: projectScope.id } : {}),
  };

  const receiptScopeWhere: Record<string, unknown> = {};
  if (customerScope || projectScope) {
    const receiptOr: Record<string, unknown>[] = [];
    if (customerScope) receiptOr.push({ customerId: { in: customerScope.id.in } });
    if (projectScope) receiptOr.push({ projectId: { in: projectScope.id.in } });
    if (receiptOr.length > 0) (receiptScopeWhere as Record<string, unknown>).OR = receiptOr;
  }

  // ── Orders: scope by customer + project-linked ──
  const orderOrConditions: Record<string, unknown>[] = [];
  if (customerScope) {
    orderOrConditions.push({ customerId: { in: customerScope.id.in } });
  }
  if (projectScope) {
    // In-scope projects → linked order ids
    const projectOrders = await prisma.orderProjectLink.findMany({
      where: { projectId: { in: projectScope.id.in } },
      select: { orderId: true },
      distinct: ["orderId"],
    });
    if (projectOrders.length > 0) {
      orderOrConditions.push({ id: { in: projectOrders.map((l) => l.orderId) } });
    }
  }

  const orderWhere: Record<string, unknown> = { deleted: false };
  if (orderOrConditions.length === 1) {
    Object.assign(orderWhere, orderOrConditions[0]);
  } else if (orderOrConditions.length > 1) {
    orderWhere.OR = orderOrConditions;
  }
  // No scope → all orders (ADMIN)

  const allOrders = await prisma.order.findMany({
    where: orderWhere,
    select: {
      id: true, totalAmount: true, financeAmountOverride: true,
      category: true, financeTreatment: true,
      orderedAt: true, confirmedAt: true, createdAt: true,
      customerId: true,
    },
  });

  // Build project-link map for AUTO resolution
  const orderIds = allOrders.map((o) => o.id);
  const linkMap = await buildOrderProjectLinkMap(orderIds);

  let standaloneOrderAmount = 0;
  let projectLinkedOrderAmount = 0;
  let matchedOnline = 0;
  let unmatchedOnline = 0;

  for (const o of allOrders) {
    const amt = computeOrderFinanceAmount(o);
    if (o.customerId) matchedOnline += amt;
    else unmatchedOnline += amt;

    const treatment = getOrderEffectiveTreatment(o.financeTreatment, linkMap.has(o.id));
    if (treatment === "PROJECT_INCLUDED") projectLinkedOrderAmount += amt;
    else if (treatment === "STANDALONE") standaloneOrderAmount += amt;
  }

  const [
    projectAgg,
    projectInvoiceAgg,
    orderInvoiceAgg,
    receiptAgg,
    pendingInvoiceCount,
    customerCount,
    projectCount,
    receiptCount,
    costAgg,
    allProjectsForProgress,
  ] = await Promise.all([
    prisma.project.aggregate({
      _sum: { budgetAmount: true },
      where: projectWhere,
    }),
    prisma.projectInvoice.aggregate({
      _sum: { totalAmount: true },
      where: { status: { not: "CANCELLED" }, project: projectWhere },
    }),
    prisma.externalOrderInvoiceRequest.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: { not: "CANCELLED" },
        OR: [
          { externalOrder: customerScope
            ? { customerId: { in: customerScope.id.in }, mergedIntoId: null }
            : { mergedIntoId: null } },
          ...(customerScope ? [{ order: { customerId: { in: customerScope.id.in } } }] : [{}]),
          ...(customerScope ? [{ orderCoverage: { some: { order: { customerId: { in: customerScope.id.in } } } } }] : [{}]),
        ],
      },
    }),
    prisma.financeReceipt.aggregate({
      _sum: { amount: true },
      where: receiptScopeWhere,
    }),
    prisma.projectInvoice.count({
      where: { status: { in: ["DRAFT", "REQUESTED"] }, project: projectWhere },
    }),
    prisma.customer.count({ where: customerWhere }),
    prisma.project.count({ where: projectWhere }),
    prisma.financeReceipt.count({ where: receiptScopeWhere }),
    prisma.financeCost.aggregate({
      _sum: { amount: true },
      where: (customerScope || projectScope)
        ? {
            OR: [
              ...(customerScope ? [{ customerId: { in: customerScope.id.in } }] : []),
              ...(projectScope ? [{ projectId: { in: projectScope.id.in } }] : []),
              ...(projectScope ? [{
                order: { projectLinks: { some: { projectId: { in: projectScope.id.in } } } },
              }] : []),
            ],
          }
        : {},
    }),
    prisma.project.findMany({
      where: projectWhere,
      select: {
        id: true, budgetAmount: true, projectType: true,
        startDate: true, createdAt: true, endDate: true, status: true,
      },
    }),
  ]);

  const projectBudgetTotal = projectAgg._sum.budgetAmount || 0;
  const projectRevenue = await computeBatchProjectRevenue(allProjectsForProgress);
  const effectiveBusinessAmount = projectRevenue + standaloneOrderAmount;

  const progressStandaloneOrders = allOrders
    .filter((o) => getOrderEffectiveTreatment(o.financeTreatment, linkMap.has(o.id)) === "STANDALONE")
    .map((o) => ({ ...o, hasProjectLinks: linkMap.has(o.id) }));
  const progress = await computeAllProgressReceivables(allProjectsForProgress, progressStandaloneOrders);

  let unmatchedOnlineOrderAmount = 0;
  if (!customerScope && !projectScope) {
    const trueUnmatched = await prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { deleted: false, customerId: null },
    });
    unmatchedOnlineOrderAmount = trueUnmatched._sum.totalAmount || 0;
  }

  const costAmount = costAgg._sum.amount || 0;
  const receiptAmount = receiptAgg._sum.amount || 0;
  const profitAmount = receiptAmount - costAmount;
  const profitRate = receiptAmount > 0 ? profitAmount / receiptAmount : null;

  return {
    totalOnlineOrderAmount: matchedOnline + unmatchedOnline + (customerScope || projectScope ? 0 : unmatchedOnlineOrderAmount - unmatchedOnline),
    matchedOnlineOrderAmount: matchedOnline,
    unmatchedOnlineOrderAmount,
    totalProjectBudgetAmount: projectBudgetTotal,
    projectLinkedOrderAmount,
    standaloneOnlineOrderAmount: standaloneOrderAmount,
    effectiveBusinessAmount,
    projectInvoicedAmount: projectInvoiceAgg._sum.totalAmount || 0,
    orderInvoicedAmount: orderInvoiceAgg._sum.totalAmount || 0,
    totalReceiptAmount: receiptAgg._sum.amount || 0,
    pendingInvoiceCount,
    customerCount,
    projectCount,
    receiptCount,
    weekProgressReceivable: progress.weekProject.total + progress.weekOrder,
    monthProgressReceivable: progress.monthProject.total + progress.monthOrder,
    weekServiceDeposit: progress.weekProject.serviceDeposit,
    weekServiceFinal: progress.weekProject.serviceFinal,
    weekProductReceivable: progress.weekProject.productReceivable,
    monthServiceDeposit: progress.monthProject.serviceDeposit,
    monthServiceFinal: progress.monthProject.serviceFinal,
    monthProductReceivable: progress.monthProject.productReceivable,
    costAmount,
    profitAmount,
    profitRate,
  };
}

export async function getCustomerFinanceList(
  customerScope: { id: { in: string[] } } | null,
  page: number,
  pageSize: number,
  search?: string
): Promise<FinanceCustomerListResponse> {
  const where: Prisma.CustomerWhereInput = {
    deleted: false,
    ...(customerScope ? { id: customerScope.id } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search } },
        { customerCode: { contains: search } },
        { organization: { contains: search } },
      ],
    } : {}),
  };

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: {
        id: true, name: true, customerCode: true, organization: true,
        orders: {
          where: { deleted: false },
          select: {
            id: true, totalAmount: true, financeAmountOverride: true,
            financeTreatment: true, customerId: true,
          },
        },
        projects: {
          where: { deleted: false },
          select: {
            id: true, budgetAmount: true, projectType: true,
            status: true, progress: true,
            invoices: {
              where: { status: { not: "CANCELLED" } },
              select: { totalAmount: true },
            },
          },
        },
        receipts: { select: { amount: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
    }),
    prisma.customer.count({ where }),
  ]);

  // Collect all order ids across customers for bulk link lookup
  const allOrderIds = customers.flatMap((c) => c.orders.map((o) => o.id));
  const linkMap = await buildOrderProjectLinkMap(allOrderIds);

  const items: CustomerFinanceItem[] = await Promise.all(
    customers.map(async (cust) => {
      let standaloneOrderAmount = 0;
      let projectLinkedOrderAmount = 0;
      let onlineOrderTotal = 0;

      for (const o of cust.orders) {
        const amt = computeOrderFinanceAmount(o);
        onlineOrderTotal += amt;
        const treatment = getOrderEffectiveTreatment(o.financeTreatment, linkMap.has(o.id));
        if (treatment === "PROJECT_INCLUDED") projectLinkedOrderAmount += amt;
        else if (treatment === "STANDALONE") standaloneOrderAmount += amt;
      }

      const custOrderIds = cust.orders.map((o) => o.id);
      const orderInvoices = await prisma.externalOrderInvoiceRequest.aggregate({
        _sum: { totalAmount: true },
        where: {
          status: { not: "CANCELLED" },
          OR: [
            { externalOrder: { customerId: cust.id, mergedIntoId: null } },
            ...(custOrderIds.length > 0 ? [{ orderId: { in: custOrderIds } }] : []),
            ...(custOrderIds.length > 0 ? [{ orderCoverage: { some: { orderId: { in: custOrderIds } } } }] : []),
          ],
        },
      });

      const projectBudgetTotal = cust.projects.reduce((sum, p) => sum + (p.budgetAmount || 0), 0);
      const projectInvoiced = cust.projects.reduce((sum, p) => sum + p.invoices.reduce((s, i) => s + i.totalAmount, 0), 0);
      const totalReceipt = cust.receipts.reduce((sum, r) => sum + r.amount, 0);

      const projectReceivable = cust.projects.reduce((sum, p) => sum + computeProjectReceivable(p), 0);
      const receivableAmount = projectReceivable + standaloneOrderAmount;
      const projectRevenue = await computeBatchProjectRevenue(cust.projects);
      const effectiveBusinessAmount = projectRevenue + standaloneOrderAmount;

      return {
        id: cust.id, name: cust.name, customerCode: cust.customerCode, organization: cust.organization,
        onlineOrderCount: cust.orders.length,
        onlineOrderTotalAmount: onlineOrderTotal,
        projectLinkedOrderAmount,
        standaloneOnlineOrderAmount: standaloneOrderAmount,
        projectCount: cust.projects.length,
        projectBudgetTotalAmount: projectBudgetTotal,
        effectiveBusinessAmount,
        receivableAmount,
        projectInvoicedAmount: projectInvoiced,
        orderInvoicedAmount: orderInvoices._sum.totalAmount || 0,
        totalReceiptAmount: totalReceipt,
        outstandingAmount: receivableAmount - totalReceipt,
      };
    })
  );

  return { customers: items, total, page, pageSize };
}

export async function getCustomerFinanceDetail(
  customerId: string
): Promise<CustomerFinanceDetail | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId, deleted: false },
    select: {
      id: true, name: true, customerCode: true, organization: true,
      wechat: true, principal: true,
      orders: {
        where: { deleted: false },
        select: {
          id: true, orderNo: true, totalAmount: true,
          orderedAt: true, customerMatchStatus: true,
          source: true, category: true, financeTreatment: true,
          financeAmountOverride: true,
        },
        orderBy: { orderedAt: "desc" },
      },
      projects: {
        where: { deleted: false },
        select: {
          id: true, name: true, budgetAmount: true, projectType: true,
          status: true, progress: true,
          invoices: {
            where: { status: { not: "CANCELLED" } },
            select: { id: true, totalAmount: true, status: true, invoiceType: true, createdAt: true },
          },
        },
      },
      receipts: {
        select: { id: true, amount: true, receivedAt: true, source: true, remark: true },
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  if (!customer) return null;

  const orderIds = customer.orders.map((o) => o.id);
  const linkMap = await buildOrderProjectLinkMap(orderIds);

  const orderInvoices = await prisma.externalOrderInvoiceRequest.findMany({
    where: {
      status: { not: "CANCELLED" },
      OR: [
        { externalOrder: { customerId, mergedIntoId: null } },
        ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } }] : []),
        ...(orderIds.length > 0 ? [{ orderCoverage: { some: { orderId: { in: orderIds } } } }] : []),
      ],
    },
    select: { id: true, totalAmount: true, status: true, invoiceType: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  let standaloneOrderAmount = 0;
  let projectLinkedOrderAmount = 0;
  let onlineOrderTotal = 0;

  for (const o of customer.orders) {
    const amt = computeOrderFinanceAmount(o);
    onlineOrderTotal += amt;
    const treatment = getOrderEffectiveTreatment(o.financeTreatment, linkMap.has(o.id));
    if (treatment === "PROJECT_INCLUDED") projectLinkedOrderAmount += amt;
    else if (treatment === "STANDALONE") standaloneOrderAmount += amt;
  }

  const projectBudgetTotal = customer.projects.reduce((sum, p) => sum + (p.budgetAmount || 0), 0);
  const projectInvoiced = customer.projects.reduce((sum, p) => sum + p.invoices.reduce((s, i) => s + i.totalAmount, 0), 0);
  const orderInvoiced = orderInvoices.reduce((sum, i) => sum + i.totalAmount, 0);
  const totalReceipt = customer.receipts.reduce((sum, r) => sum + r.amount, 0);

  const projectReceivable = customer.projects.reduce((sum, p) => sum + computeProjectReceivable(p), 0);
  const receivableAmount = projectReceivable + standaloneOrderAmount;
  const projectRevenue = await computeBatchProjectRevenue(customer.projects);
  const effectiveBusinessAmount = projectRevenue + standaloneOrderAmount;

  return {
    customer: {
      id: customer.id, name: customer.name, customerCode: customer.customerCode,
      organization: customer.organization, wechat: customer.wechat, principal: customer.principal,
    },
    summary: {
      onlineOrderTotal,
      standaloneOnlineOrderAmount: standaloneOrderAmount,
      projectLinkedOrderAmount,
      projectBudgetTotal,
      effectiveBusinessAmount,
      receivableAmount,
      projectInvoicedAmount: projectInvoiced,
      orderInvoicedAmount: orderInvoiced,
      totalReceiptAmount: totalReceipt,
      outstandingAmount: receivableAmount - totalReceipt,
    },
    onlineOrders: customer.orders.map((o) => ({
      id: o.id, orderNo: o.orderNo, totalAmount: o.totalAmount,
      orderedAt: o.orderedAt?.toISOString() ?? null, customerMatchStatus: o.customerMatchStatus,
      source: o.source, category: o.category, financeTreatment: o.financeTreatment,
      financeAmountOverride: o.financeAmountOverride,
    })),
    projects: customer.projects.map((p) => ({
      id: p.id, name: p.name, budgetAmount: p.budgetAmount, status: p.status, progress: p.progress,
    })),
    projectInvoices: customer.projects.flatMap((p) => p.invoices).map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    orderInvoices: orderInvoices.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    receipts: customer.receipts.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString() })),
  };
}
