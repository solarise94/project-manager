import { prisma } from "@/lib/prisma";
import type {
  FinanceSummary,
  CustomerFinanceItem,
  CustomerFinanceDetail,
  FinanceCustomerListResponse,
} from "./types";
import { computeProjectReceivable, computeOrderFinanceAmount, getOrderEffectiveTreatment } from "./types";
import { computeAllProgressReceivables } from "./progress";
import type { Prisma } from "@prisma/client";

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

  const orderCustomerFilter = customerScope
    ? { customerId: { in: customerScope.id.in } }
    : {};

  const receiptScopeWhere: Record<string, unknown> = {};
  if (customerScope || projectScope) {
    const receiptOr: Record<string, unknown>[] = [];
    if (customerScope) receiptOr.push({ customerId: { in: customerScope.id.in } });
    if (projectScope) receiptOr.push({ projectId: { in: projectScope.id.in } });
    if (receiptOr.length > 0) (receiptScopeWhere as Record<string, unknown>).OR = receiptOr;
  }

  const allOrders = await prisma.externalOrder.findMany({
    where: { mergedIntoId: null, ...orderCustomerFilter },
    select: {
      id: true, paidAmount: true, financeAmountOverride: true,
      financeCategory: true, financeTreatment: true, projectId: true,
      orderAt: true, paidAt: true, createdAt: true,
      customerId: true,
    },
  });

  let standaloneOrderAmount = 0;
  let projectLinkedOrderAmount = 0;
  let matchedOnline = 0;
  let unmatchedOnline = 0;

  for (const o of allOrders) {
    const amt = computeOrderFinanceAmount(o);
    if (o.customerId) matchedOnline += amt;
    else unmatchedOnline += amt;

    const treatment = getOrderEffectiveTreatment(o);
    if (treatment === "PROJECT_INCLUDED") {
      projectLinkedOrderAmount += amt;
    } else if (treatment === "STANDALONE") {
      standaloneOrderAmount += amt;
    }
    // EXCLUDED: not counted anywhere
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
      where: { status: { not: "CANCELLED" }, externalOrder: { mergedIntoId: null, ...orderCustomerFilter } },
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
    prisma.project.findMany({
      where: projectWhere,
      select: {
        id: true, budgetAmount: true, projectType: true,
        startDate: true, createdAt: true, endDate: true, status: true,
      },
    }),
  ]);

  const projectBudgetTotal = projectAgg._sum.budgetAmount || 0;
  const effectiveBusinessAmount = projectBudgetTotal + standaloneOrderAmount;

  // Progress receivables
  const progressStandaloneOrders = allOrders.filter(
    (o) => getOrderEffectiveTreatment(o) === "STANDALONE"
  );
  const progress = await computeAllProgressReceivables(allProjectsForProgress, progressStandaloneOrders);

  // Admin: true unmatched query
  let unmatchedOnlineOrderAmount = 0;
  if (!customerScope) {
    const trueUnmatched = await prisma.externalOrder.aggregate({
      _sum: { paidAmount: true },
      where: { mergedIntoId: null, customerId: null },
    });
    unmatchedOnlineOrderAmount = trueUnmatched._sum.paidAmount || 0;
  }

  return {
    totalOnlineOrderAmount: matchedOnline + unmatchedOnline + (customerScope ? 0 : unmatchedOnlineOrderAmount - unmatchedOnline),
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
        id: true,
        name: true,
        customerCode: true,
        organization: true,
        externalOrders: {
          where: { mergedIntoId: null },
          select: {
            paidAmount: true,
            financeAmountOverride: true,
            financeTreatment: true,
            projectId: true,
            customerId: true,
          },
        },
        projects: {
          where: { deleted: false },
          select: {
            id: true,
            budgetAmount: true,
            projectType: true,
            status: true,
            progress: true,
            invoices: {
              where: { status: { not: "CANCELLED" } },
              select: { totalAmount: true },
            },
          },
        },
        receipts: {
          select: { amount: true },
        },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
    }),
    prisma.customer.count({ where }),
  ]);

  const items: CustomerFinanceItem[] = await Promise.all(
    customers.map(async (cust) => {
      let standaloneOrderAmount = 0;
      let projectLinkedOrderAmount = 0;
      let onlineOrderTotal = 0;

      for (const o of cust.externalOrders) {
        const amt = computeOrderFinanceAmount(o);
        onlineOrderTotal += amt;
        const treatment = getOrderEffectiveTreatment(o);
        if (treatment === "PROJECT_INCLUDED") {
          projectLinkedOrderAmount += amt;
        } else if (treatment === "STANDALONE") {
          standaloneOrderAmount += amt;
        }
      }

      const orderInvoices = await prisma.externalOrderInvoiceRequest.aggregate({
        _sum: { totalAmount: true },
        where: {
          status: { not: "CANCELLED" },
          externalOrder: { customerId: cust.id, mergedIntoId: null },
        },
      });

      const projectBudgetTotal = cust.projects.reduce((sum, p) => sum + (p.budgetAmount || 0), 0);
      const projectInvoiced = cust.projects.reduce(
        (sum, p) => sum + p.invoices.reduce((s, i) => s + i.totalAmount, 0), 0
      );
      const totalReceipt = cust.receipts.reduce((sum, r) => sum + r.amount, 0);

      const projectReceivable = cust.projects.reduce((sum, p) => sum + computeProjectReceivable(p), 0);
      const receivableAmount = projectReceivable + standaloneOrderAmount;
      const effectiveBusinessAmount = projectBudgetTotal + standaloneOrderAmount;

      return {
        id: cust.id,
        name: cust.name,
        customerCode: cust.customerCode,
        organization: cust.organization,
        onlineOrderCount: cust.externalOrders.length,
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
      id: true,
      name: true,
      customerCode: true,
      organization: true,
      wechat: true,
      principal: true,
      externalOrders: {
        where: { mergedIntoId: null },
        select: {
          id: true,
          externalOrderNo: true,
          paidAmount: true,
          orderAt: true,
          customerMatchStatus: true,
          platform: true,
          projectId: true,
          financeCategory: true,
          financeTreatment: true,
          financeAmountOverride: true,
        },
        orderBy: { orderAt: "desc" },
      },
      projects: {
        where: { deleted: false },
        select: {
          id: true,
          name: true,
          budgetAmount: true,
          projectType: true,
          status: true,
          progress: true,
          invoices: {
            where: { status: { not: "CANCELLED" } },
            select: {
              id: true,
              totalAmount: true,
              status: true,
              invoiceType: true,
              createdAt: true,
            },
          },
        },
      },
      receipts: {
        select: {
          id: true,
          amount: true,
          receivedAt: true,
          source: true,
          remark: true,
        },
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  if (!customer) return null;

  const orderInvoices = await prisma.externalOrderInvoiceRequest.findMany({
    where: {
      status: { not: "CANCELLED" },
      externalOrder: { customerId, mergedIntoId: null },
    },
    select: {
      id: true, totalAmount: true, status: true, invoiceType: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  let standaloneOrderAmount = 0;
  let projectLinkedOrderAmount = 0;
  let onlineOrderTotal = 0;

  for (const o of customer.externalOrders) {
    const amt = computeOrderFinanceAmount(o);
    onlineOrderTotal += amt;
    const treatment = getOrderEffectiveTreatment(o);
    if (treatment === "PROJECT_INCLUDED") projectLinkedOrderAmount += amt;
    else if (treatment === "STANDALONE") standaloneOrderAmount += amt;
  }

  const projectBudgetTotal = customer.projects.reduce((sum, p) => sum + (p.budgetAmount || 0), 0);
  const projectInvoiced = customer.projects.reduce(
    (sum, p) => sum + p.invoices.reduce((s, i) => s + i.totalAmount, 0), 0
  );
  const orderInvoiced = orderInvoices.reduce((sum, i) => sum + i.totalAmount, 0);
  const totalReceipt = customer.receipts.reduce((sum, r) => sum + r.amount, 0);

  const projectReceivable = customer.projects.reduce((sum, p) => sum + computeProjectReceivable(p), 0);
  const receivableAmount = projectReceivable + standaloneOrderAmount;
  const effectiveBusinessAmount = projectBudgetTotal + standaloneOrderAmount;

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
    onlineOrders: customer.externalOrders.map((o) => ({
      id: o.id, externalOrderNo: o.externalOrderNo, paidAmount: o.paidAmount,
      orderAt: o.orderAt?.toISOString() ?? null, customerMatchStatus: o.customerMatchStatus,
      platform: o.platform, projectId: o.projectId,
      financeCategory: o.financeCategory, financeTreatment: o.financeTreatment,
      financeAmountOverride: o.financeAmountOverride,
    })),
    projects: customer.projects.map((p) => ({
      id: p.id, name: p.name, budgetAmount: p.budgetAmount,
      status: p.status, progress: p.progress,
    })),
    projectInvoices: customer.projects
      .flatMap((p) => p.invoices)
      .map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    orderInvoices: orderInvoices.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    receipts: customer.receipts.map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString() })),
  };
}
