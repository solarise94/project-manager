import { Prisma } from "@prisma/client";
import type { NormalizedOrderRow } from "@/lib/external-order";

export async function generateImportOrderNo(
  tx: Prisma.TransactionClient,
  refDate: Date,
  prefix = "PO",
): Promise<string> {
  const dateStr = `${refDate.getFullYear()}${String(refDate.getMonth() + 1).padStart(2, "0")}${String(refDate.getDate()).padStart(2, "0")}`;
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
  if (row.paidAmount != null && row.paidAmount > 0) return row.paidAmount;
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
