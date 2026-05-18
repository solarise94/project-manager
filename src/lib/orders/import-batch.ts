import { prisma } from "@/lib/prisma";
import { normalizeOrderSource } from "@/lib/orders/constants";
import { computeOrderAmount, findExistingImportOrder, generateImportOrderNo, normalizeImportDate, resolveImportRefDate, upsertImportSourceRecord, withRetry } from "@/lib/orders/import-commit";
import { resolveOrCreateOrganizationForImport, resolveOrCreateCustomerForImport } from "@/lib/orders/import-masterdata";
import type { CustomerMode, OrganizationMode } from "@/lib/orders/import-masterdata";
import type { NormalizedOrderRow } from "@/lib/external-order";

export interface ImportBatchInput {
  source: string;
  sourceRemark?: string;
  rows: NormalizedOrderRow[];
  userId: string;
  customerMode?: CustomerMode;
  organizationMode?: OrganizationMode;
  ownerUserId?: string | null;
  createCrmProfile?: boolean;
}

export interface ImportBatchResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; externalOrderNo?: string; message: string }>;
}

export interface ImportRowError {
  row: number;
  externalOrderNo?: string;
  message: string;
}

export const BATCH_SIZE = 20;

/**
 * Process a batch of normalized import rows.
 *
 * Each row is handled independently with its own dedup check and transaction.
 * Row-level failures are collected and do not block the rest of the batch.
 */
export async function processImportRows(input: ImportBatchInput): Promise<ImportBatchResult> {
  const {
    source,
    sourceRemark,
    rows,
    userId,
    customerMode = "MATCH_ONLY",
    organizationMode = "RESOLVE_ONLY",
    ownerUserId = null,
    createCrmProfile = false,
  } = input;

  if (rows.length > BATCH_SIZE) {
    throw new Error(`每批最多 ${BATCH_SIZE} 条，收到 ${rows.length} 条`);
  }

  const errors: ImportRowError[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const normalizedSource = normalizeOrderSource(row.source);
    const orderAt = normalizeImportDate(row.orderAt);
    const paidAt = normalizeImportDate(row.paidAt);
    const refDate = resolveImportRefDate(orderAt, paidAt);

    try {
      const action = await withRetry(async () => {
        const existingSrc = await findExistingImportOrder(prisma, normalizedSource, row.externalOrderNo);

        if (existingSrc?.orderId) {
          // If the linked order is a merge target (source records were moved here
          // during a previous merge), skip — updating would corrupt the target order
          // with the source's original import data.
          if (existingSrc.order && existingSrc.order.mergeTargets.length > 0) {
            return "skipped" as const;
          }

          const isDeleted = existingSrc.order?.deleted;
          const totalAmount = computeOrderAmount(row);
          await prisma.order.update({
            where: { id: existingSrc.orderId },
            data: {
              totalAmount: totalAmount > 0 ? totalAmount : undefined,
              sourceRemark: sourceRemark ?? undefined,
              buyerNameSnapshot: row.receiverName ?? undefined,
              buyerPhoneSnapshot: row.receiverPhone ?? undefined,
              buyerAddressSnapshot: row.receiverAddress ?? undefined,
              buyerWechatSnapshot: row.orderUser ?? undefined,
              buyerOrgNameSnapshot: row.storeName ?? undefined,
              orderedAt: orderAt ?? undefined,
              confirmedAt: paidAt ?? undefined,
              title: row.productNamesRaw ?? undefined,
              // Re-import restores soft-deleted orders only
              ...(isDeleted ? { deleted: false, deletedAt: null, archived: false, financeTreatment: "AUTO" } : {}),
            },
          });
          await upsertImportSourceRecord(prisma, {
            orderId: existingSrc.orderId,
            source: normalizedSource,
            sourceRemark,
            platform: row.platform || source,
            externalOrderNo: row.externalOrderNo,
            merchantOrderNo: row.merchantOrderNo,
            rawJson: JSON.stringify(row),
          });
          return "updated" as const;
        }

        await prisma.$transaction(async (tx) => {
          const orgResult = await resolveOrCreateOrganizationForImport(
            row.storeName,
            organizationMode,
            tx,
          );

          const custInput = {
            buyerName: row.receiverName,
            buyerPhone: row.receiverPhone,
            buyerWechat: row.orderUser,
            buyerOrgName: row.storeName,
            buyerAddress: row.receiverAddress,
          };
          const custResult = await resolveOrCreateCustomerForImport(
            custInput,
            customerMode,
            orgResult.organizationId,
            ownerUserId,
            createCrmProfile,
            tx,
          );

          const totalAmount = computeOrderAmount(row);
          const orderNo = await generateImportOrderNo(tx, refDate);
          const rawJson = JSON.stringify(row);

          const order = await tx.order.create({
            data: {
              orderNo,
              source: normalizedSource,
              sourcePlatform: row.platform || source,
              sourceRemark,
              externalOrderNo: row.externalOrderNo,
              merchantOrderNo: row.merchantOrderNo,
              title: row.productNamesRaw || `${row.receiverName || "未知"}的订单`,
              category: "UNKNOWN",
              status: "CONFIRMED",
              deliveryStatus: "DELIVERED",
              orderedAt: orderAt,
              confirmedAt: paidAt,
              deliveredAt: paidAt ?? new Date(),
              buyerNameSnapshot: row.receiverName,
              buyerPhoneSnapshot: row.receiverPhone,
              buyerAddressSnapshot: row.receiverAddress,
              buyerWechatSnapshot: row.orderUser,
              buyerOrgNameSnapshot: row.storeName,
              totalAmount,
              customerId: custResult.customerId,
              customerMatchStatus: custResult.matchStatus,
              customerMatchScore: custResult.matchScore,
              customerMatchReason: custResult.matchReason,
              createdById: userId,
            },
          });

          await upsertImportSourceRecord(tx, {
            orderId: order.id,
            source: normalizedSource,
            sourceRemark,
            platform: row.platform || source,
            externalOrderNo: row.externalOrderNo,
            merchantOrderNo: row.merchantOrderNo,
            rawJson,
          });

          const itemName = row.productNamesRaw || row.externalOrderNo || "导入订单";
          await tx.orderLine.create({
            data: {
              orderId: order.id,
              itemName: String(itemName).slice(0, 200),
              amount: totalAmount,
              category: "UNKNOWN",
              sortOrder: 0,
            },
          });
        });
        return "created" as const;
      });

      if (action === "updated") updated++;
      else if (action === "created") created++;
      else if (action === "skipped") skipped++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      errors.push({
        row: i + 1,
        externalOrderNo: row.externalOrderNo,
        message: `创建失败: ${msg}`,
      });
    }
  }

  return { created, updated, skipped, errors };
}
