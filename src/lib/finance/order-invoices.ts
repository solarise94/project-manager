import { prisma } from "@/lib/prisma";

export type InvoiceLinkType = "DIRECT" | "COVERAGE" | "LEGACY_DIRECT" | "LEGACY_COVERAGE";

export interface UnifiedOrderInvoice {
  id: string;
  status: string;
  totalAmount: number;
  invoiceType: string;
  contentSummary: string | null;
  buyerOrganizationName: string;
  buyerTaxId: string | null;
  sellerName: string | null;
  actualInvoiceNo: string | null;
  actualIssuedAt: Date | null;
  remark: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
  linkType: InvoiceLinkType;
  isLegacyLinked: boolean;
  orderId: string | null;
  externalOrderId: string | null;
  coveredOrders: Array<{ id: string; orderNo: string }>;
  items: Array<{
    id: string;
    itemName: string;
    spec: string | null;
    unit: string | null;
    quantity: number | null;
    amount: number;
    sortOrder: number;
  }>;
  _documentCount: number;
  _receiptAmount: number;
  adjustments?: Array<{ id: string; kind: string; reason: string | null; createdAt: Date }>;
}

const INVOICE_SELECT = {
  id: true,
  status: true,
  totalAmount: true,
  invoiceType: true,
  contentSummary: true,
  buyerOrganizationName: true,
  buyerTaxId: true,
  sellerName: true,
  actualInvoiceNo: true,
  actualIssuedAt: true,
  remark: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  orderId: true,
  externalOrderId: true,
  items: { select: { id: true, itemName: true, spec: true, unit: true, quantity: true, amount: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
  orderCoverage: { select: { order: { select: { id: true, orderNo: true } } } },
  coverage: { select: { externalOrder: { select: { id: true } } } },
  documents: { select: { id: true } },
  receipts: { where: { deleted: false }, select: { amount: true } },
  allocations: { where: { receipt: { deleted: false } }, select: { amount: true } },
  adjustmentsAsOriginal: { select: { id: true, kind: true, reason: true, createdAt: true } },
} as const;

export async function getInvoicesForOrder(
  orderId: string,
): Promise<UnifiedOrderInvoice[]> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { legacyExternalOrderId: true },
  });
  const legacyExtId = order?.legacyExternalOrderId ?? null;

  const results = new Map<string, UnifiedOrderInvoice>();

  // 1. Direct orderId invoices
  const directInvoices = await prisma.externalOrderInvoiceRequest.findMany({
    where: { orderId },
    select: INVOICE_SELECT,
    orderBy: { createdAt: "desc" },
  });
  for (const inv of directInvoices) {
    results.set(inv.id, normalizeInvoice(inv, "DIRECT"));
  }

  // 2. OrderInvoiceCoverage invoices
  const coverageRecords = await prisma.orderInvoiceCoverage.findMany({
    where: { orderId },
    select: {
      invoiceRequest: { select: INVOICE_SELECT },
    },
  });
  for (const c of coverageRecords) {
    const inv = c.invoiceRequest;
    if (!inv) continue;
    if (!results.has(inv.id)) {
      results.set(inv.id, normalizeInvoice(inv, "COVERAGE"));
    }
  }

  // 3. Legacy direct externalOrderId invoices
  if (legacyExtId) {
    const legacyDirect = await prisma.externalOrderInvoiceRequest.findMany({
      where: { externalOrderId: legacyExtId },
      select: INVOICE_SELECT,
      orderBy: { createdAt: "desc" },
    });
    for (const inv of legacyDirect) {
      if (!results.has(inv.id)) {
        results.set(inv.id, normalizeInvoice(inv, "LEGACY_DIRECT"));
      }
    }

    // 4. Legacy ExternalOrderInvoiceCoverage invoices
    const legacyCoverageRecords = await prisma.externalOrderInvoiceCoverage.findMany({
      where: { externalOrderId: legacyExtId },
      select: {
        invoiceRequest: { select: INVOICE_SELECT },
      },
    });
    for (const c of legacyCoverageRecords) {
      const inv = c.invoiceRequest;
      if (!inv) continue;
      if (!results.has(inv.id)) {
        results.set(inv.id, normalizeInvoice(inv, "LEGACY_COVERAGE"));
      }
    }
  }

  return Array.from(results.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

function normalizeInvoice(
  raw: {
    id: string;
    status: string;
    totalAmount: number;
    invoiceType: string;
    contentSummary: string | null;
    buyerOrganizationName: string;
    buyerTaxId: string | null;
    sellerName: string | null;
    actualInvoiceNo: string | null;
    actualIssuedAt: Date | null;
    remark: string | null;
    createdAt: Date;
    createdBy: { id: string; name: string } | null;
    orderId: string | null;
    externalOrderId: string | null;
    items: Array<{
      id: string;
      itemName: string;
      spec: string | null;
      unit: string | null;
      quantity: number | null;
      amount: number;
      sortOrder: number;
    }>;
    orderCoverage: Array<{ order: { id: string; orderNo: string } | null }>;
    coverage: Array<{ externalOrder: { id: string } | null }>;
    documents: Array<{ id: string }>;
    receipts: Array<{ amount: number }>;
    allocations?: Array<{ amount: number }>;
    adjustmentsAsOriginal?: Array<{ id: string; kind: string; reason: string | null; createdAt: Date }>;
  },
  linkType: InvoiceLinkType,
): UnifiedOrderInvoice {
  const coveredOrders = raw.orderCoverage
    .map((c) => c.order)
    .filter((o): o is { id: string; orderNo: string } => o != null);

  return {
    id: raw.id,
    status: raw.status,
    totalAmount: raw.totalAmount,
    invoiceType: raw.invoiceType,
    contentSummary: raw.contentSummary,
    buyerOrganizationName: raw.buyerOrganizationName,
    buyerTaxId: raw.buyerTaxId,
    sellerName: raw.sellerName,
    actualInvoiceNo: raw.actualInvoiceNo,
    actualIssuedAt: raw.actualIssuedAt,
    remark: raw.remark,
    createdAt: raw.createdAt,
    createdBy: raw.createdBy,
    linkType,
    isLegacyLinked: linkType.startsWith("LEGACY"),
    orderId: raw.orderId,
    externalOrderId: raw.externalOrderId,
    coveredOrders,
    items: raw.items,
    _documentCount: raw.documents.length,
    _receiptAmount:
      raw.receipts.reduce((s, r) => s + r.amount, 0) +
      (raw.allocations || []).reduce((s, a) => s + a.amount, 0),
    adjustments: raw.adjustmentsAsOriginal,
  };
}

export async function findBlockingInvoicesForOrder(
  orderId: string,
): Promise<UnifiedOrderInvoice[]> {
  const all = await getInvoicesForOrder(orderId);
  return all.filter((inv) => {
    if (!["DRAFT", "REQUESTED", "ISSUED"].includes(inv.status)) return false;
    // Exclude invoices that have been red-adjusted
    const hasRed = inv.adjustments?.some((a) => a.kind === "RED");
    return !hasRed;
  });
}

/**
 * Check if an invoice is occupied by any receipt (new allocation or legacy 1-to-1).
 * Returns the occupied amount, or 0 if the invoice is free.
 * Per §9.1: checks both FinanceReceiptAllocation and legacy FinanceReceipt.externalOrderInvoiceRequestId.
 * Per §1.1 S6: always filters receipt.deleted = false.
 */
export async function getInvoiceOccupiedAmount(invoiceId: string): Promise<number> {
  // New path: FinanceReceiptAllocation
  const allocations = await prisma.financeReceiptAllocation.findMany({
    where: {
      invoiceId,
      receipt: { deleted: false },
    },
    select: { amount: true },
  });
  const allocTotal = allocations.reduce((s, a) => s + a.amount, 0);

  // Legacy path: FinanceReceipt.externalOrderInvoiceRequestId (only receipts WITHOUT allocations)
  const legacyReceipts = await prisma.financeReceipt.findMany({
    where: {
      externalOrderInvoiceRequestId: invoiceId,
      deleted: false,
      allocations: { none: {} },
    },
    select: { amount: true },
  });
  const legacyTotal = legacyReceipts.reduce((s, r) => s + r.amount, 0);

  return allocTotal + legacyTotal;
}

/**
 * Assert invoice is not occupied. Throws { status: 409, body } if occupied.
 * Used by RED / REISSUE routes per §9.1.
 */
export async function assertInvoiceNotOccupied(invoiceId: string): Promise<void> {
  const occupied = await getInvoiceOccupiedAmount(invoiceId);
  if (occupied > 0) {
    throw Object.assign(new Error("INVOICE_OCCUPIED"), {
      status: 409,
      body: {
        error: "INVOICE_OCCUPIED",
        message: "该发票已有回款核销，请先撤销核销再冲红",
        occupiedAmount: occupied,
      },
    });
  }
}
