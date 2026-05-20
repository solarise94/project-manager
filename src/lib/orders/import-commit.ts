import { Prisma, PrismaClient } from "@prisma/client";
import type { NormalizedOrderRow } from "@/lib/external-order";

export type ImportDateLike = Date | string | null | undefined;

export function normalizeImportDate(value: ImportDateLike): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveImportRefDate(...candidates: ImportDateLike[]): Date {
  for (const candidate of candidates) {
    const normalized = normalizeImportDate(candidate);
    if (normalized) return normalized;
  }
  return new Date();
}

type ImportDbClient = PrismaClient | Prisma.TransactionClient;

const IMPORT_ORDER_MATCH_SELECT = {
  id: true,
  orderId: true,
  order: { select: { deleted: true, mergeTargets: { select: { id: true }, take: 1 } } },
} satisfies Prisma.OrderSourceRecordSelect;

export interface ExistingImportOrderMatch {
  orderId: string;
  exactSourceRecordId: string | null;
  order: {
    deleted: boolean;
    mergeTargets: Array<{ id: string }>;
  } | null;
}

function choosePreferredOrderMatch<T extends { order: { mergeTargets: Array<{ id: string }> } | null }>(matches: T[]): T | null {
  return matches.find((match) => (match.order?.mergeTargets.length ?? 0) === 0) ?? matches[0] ?? null;
}

function choosePreferredMergedCandidate<T extends { mergeTargets: Array<{ id: string }> }>(matches: T[]): T | null {
  return matches.find((match) => match.mergeTargets.length === 0) ?? matches[0] ?? null;
}

export async function findExistingImportOrder(
  db: ImportDbClient,
  normalizedSource: string,
  externalOrderNo: string,
): Promise<ExistingImportOrderMatch | null> {
  const exactSourceRecord = await db.orderSourceRecord.findUnique({
    where: {
      source_externalOrderNo: {
        source: normalizedSource,
        externalOrderNo,
      },
    },
    select: IMPORT_ORDER_MATCH_SELECT,
  });
  if (exactSourceRecord?.orderId) {
    return {
      orderId: exactSourceRecord.orderId,
      exactSourceRecordId: exactSourceRecord.id,
      order: exactSourceRecord.order,
    };
  }

  const crossSourceMatches = await db.orderSourceRecord.findMany({
    where: {
      externalOrderNo,
      orderId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: IMPORT_ORDER_MATCH_SELECT,
  });
  const preferredSourceRecord = choosePreferredOrderMatch(crossSourceMatches);
  if (preferredSourceRecord?.orderId) {
    return {
      orderId: preferredSourceRecord.orderId,
      exactSourceRecordId: null,
      order: preferredSourceRecord.order,
    };
  }

  const directOrderMatches = await db.order.findMany({
    where: { externalOrderNo },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      deleted: true,
      mergeTargets: { select: { id: true }, take: 1 },
    },
  });
  const preferredOrder = choosePreferredMergedCandidate(directOrderMatches);
  if (!preferredOrder) return null;

  return {
    orderId: preferredOrder.id,
    exactSourceRecordId: null,
    order: {
      deleted: preferredOrder.deleted,
      mergeTargets: preferredOrder.mergeTargets,
    },
  };
}

export async function upsertImportSourceRecord(
  db: ImportDbClient,
  params: {
    orderId: string;
    source: string;
    sourceRemark?: string;
    platform?: string | null;
    externalOrderNo: string;
    merchantOrderNo?: string | null;
    rawJson?: string;
  },
): Promise<void> {
  const {
    orderId,
    source,
    sourceRemark,
    platform,
    externalOrderNo,
    merchantOrderNo,
    rawJson,
  } = params;

  await db.orderSourceRecord.upsert({
    where: {
      source_externalOrderNo: {
        source,
        externalOrderNo,
      },
    },
    update: {
      orderId,
      sourceRemark,
      platform,
      merchantOrderNo,
      rawJson,
    },
    create: {
      orderId,
      source,
      sourceRemark,
      platform,
      externalOrderNo,
      merchantOrderNo,
      rawJson,
    },
  });
}

export async function generateImportOrderNo(
  tx: Prisma.TransactionClient,
  refDate: ImportDateLike,
  prefix = "PO",
): Promise<string> {
  const normalizedRefDate = resolveImportRefDate(refDate);
  const dateStr = `${normalizedRefDate.getFullYear()}${String(normalizedRefDate.getMonth() + 1).padStart(2, "0")}${String(normalizedRefDate.getDate()).padStart(2, "0")}`;
  const lastOrder = await tx.order.findFirst({
    where: { orderNo: { startsWith: `${prefix}-${dateStr}` } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  let seq = 1;
  if (lastOrder) {
    const parts = lastOrder.orderNo.split("-");
    seq = parseInt(parts[parts.length - 1] || "0", 10) + 1;
  }
  return `${prefix}-${dateStr}-${String(seq).padStart(4, "0")}`;
}

export function computeOrderAmount(row: NormalizedOrderRow): number {
  if (row.paidAmount != null) return row.paidAmount;
  const sum = (row.grossAmount ?? 0) + (row.priceAdjustment ?? 0) + (row.shippingFee ?? 0);
  return sum > 0 ? sum : 0;
}

function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fn(); } catch (e: unknown) {
      if (isP2002(e) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("操作失败：多次重试后仍存在冲突");
}

export interface ImportCommitRowParams {
  row: NormalizedOrderRow;
  source: string;
  userId: string;
  customerId?: string | null;
}
