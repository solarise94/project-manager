import { prisma } from "@/lib/prisma";

/**
 * Compute non-cancelled invoice totals per order, covering both
 * direct ExternalOrderInvoiceRequest.orderId and OrderInvoiceCoverage.orderId.
 * Deduplicates by invoiceRequest.id so the same invoice counted via both paths
 * is not double-counted.
 */
export async function getOrderInvoiceTotals(orderIds: string[]): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();

  // per-order → set of invoiceRequest IDs with their amount
  const perOrder = new Map<string, Map<string, number>>();
  const add = (orderId: string | null, invoiceId: string, amount: number) => {
    if (!orderId) return;
    let invMap = perOrder.get(orderId);
    if (!invMap) { invMap = new Map(); perOrder.set(orderId, invMap); }
    invMap.set(invoiceId, amount);
  };

  // Direct: orderId on invoice request
  const direct = await prisma.externalOrderInvoiceRequest.findMany({
    where: { orderId: { in: orderIds }, status: { not: "CANCELLED" }, adjustmentsAsOriginal: { none: { kind: "RED" } } },
    select: { id: true, orderId: true, totalAmount: true },
  });
  for (const inv of direct) {
    add(inv.orderId, inv.id, inv.totalAmount);
  }

  // Coverage: via OrderInvoiceCoverage — split proportionally by GLOBAL covered order count
  const coverage = await prisma.orderInvoiceCoverage.findMany({
    where: {
      orderId: { in: orderIds },
      invoiceRequest: { status: { not: "CANCELLED" }, adjustmentsAsOriginal: { none: { kind: "RED" } } },
    },
    select: {
      orderId: true,
      invoiceRequest: { select: { id: true, totalAmount: true } },
    },
  });

  // Query GLOBAL coverage per invoice and split proportionally by each order's totalAmount
  const coverageInvoiceIds = [...new Set(coverage.map((c) => c.invoiceRequest.id))];
  const orderAmounts = new Map<string, number>();
  if (coverageInvoiceIds.length > 0) {
    // Fetch all covered orders for these invoices
    const allCoverage = await prisma.orderInvoiceCoverage.findMany({
      where: { invoiceRequestId: { in: coverageInvoiceIds } },
      select: { invoiceRequestId: true, orderId: true },
    });
    const allCoveredOrderIds = [...new Set(allCoverage.map((c) => c.orderId))];
    // Fetch order amounts
    const orders = await prisma.order.findMany({
      where: { id: { in: allCoveredOrderIds } },
      select: { id: true, totalAmount: true },
    });
    for (const o of orders) orderAmounts.set(o.id, o.totalAmount || 0);

    // Per-invoice: sum covered order amounts, then split proportionally
    const invoiceCoveredOrders = new Map<string, string[]>(); // invoiceId → orderIds
    for (const c of allCoverage) {
      const list = invoiceCoveredOrders.get(c.invoiceRequestId) || [];
      list.push(c.orderId);
      invoiceCoveredOrders.set(c.invoiceRequestId, list);
    }

    for (const cov of coverage) {
      const coveredOrderIds = invoiceCoveredOrders.get(cov.invoiceRequest.id) || [cov.orderId];
      const rawTotalCovered = coveredOrderIds.reduce((s, oid) => s + (orderAmounts.get(oid) || 0), 0);
      const orderAmt = orderAmounts.get(cov.orderId) || 0;
      const ratio = rawTotalCovered > 0 ? (orderAmt / rawTotalCovered) : (1 / coveredOrderIds.length);
      const splitAmount = cov.invoiceRequest.totalAmount * ratio;
      add(cov.orderId, cov.invoiceRequest.id, splitAmount);
    }
  } else {
    for (const cov of coverage) {
      add(cov.orderId, cov.invoiceRequest.id, cov.invoiceRequest.totalAmount);
    }
  }

  // Sum deduped amounts per order
  const result = new Map<string, number>();
  for (const [orderId, invMap] of perOrder) {
    let total = 0;
    for (const amount of invMap.values()) total += amount;
    result.set(orderId, total);
  }
  return result;
}

/**
 * Compute GLOBAL invoice total across orders — deduplicates merged invoices
 * that may cover multiple orders. Used for aggregate stats.
 */
export async function getGlobalInvoiceTotal(orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;

  // Collect all unique invoice requests that touch these orders
  const directInvoices = await prisma.externalOrderInvoiceRequest.findMany({
    where: { orderId: { in: orderIds }, status: { not: "CANCELLED" }, adjustmentsAsOriginal: { none: { kind: "RED" } } },
    select: { id: true, totalAmount: true },
  });

  const coverageInvoices = await prisma.orderInvoiceCoverage.findMany({
    where: {
      orderId: { in: orderIds },
      invoiceRequest: { status: { not: "CANCELLED" }, adjustmentsAsOriginal: { none: { kind: "RED" } } },
    },
    select: { invoiceRequest: { select: { id: true, totalAmount: true } } },
  });

  // Deduplicate by invoice request ID, then sum
  const seen = new Set<string>();
  let total = 0;
  for (const inv of directInvoices) {
    if (seen.has(inv.id)) continue;
    seen.add(inv.id);
    total += inv.totalAmount;
  }
  for (const cov of coverageInvoices) {
    const id = cov.invoiceRequest.id;
    if (seen.has(id)) continue;
    seen.add(id);
    total += cov.invoiceRequest.totalAmount;
  }
  return total;
}

/**
 * Compute receipt totals per order.
 */
export async function getOrderReceiptTotals(orderIds: string[]): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const receipts = await prisma.financeReceipt.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, amount: true },
  });
  const result = new Map<string, number>();
  for (const r of receipts) {
    result.set(r.orderId!, (result.get(r.orderId!) || 0) + r.amount);
  }
  return result;
}
