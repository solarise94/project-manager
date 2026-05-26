import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseOrderText, decodeImportFile } from "@/lib/external-order";
import { normalizeOrderSource, normalizeOrderCategory } from "@/lib/orders/constants";
import { computeOrderAmount, findExistingImportOrder, generateImportOrderNo, upsertImportSourceRecord, withRetry } from "@/lib/orders/import-commit";
import { syncCrmLifecycleForCustomer } from "@/lib/crm/lifecycle";

async function extractInput(req: NextRequest): Promise<{ source: string; rawText: string; sourceRemark?: string; category?: string } | { error: string }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const source = (form.get("source") as string | null)?.trim();
    const sourceRemark = (form.get("sourceRemark") as string | null)?.trim() || undefined;
    const category = (form.get("category") as string | null)?.trim() || undefined;
    const file = form.get("file") as File | null;
    if (!source || !file) return { error: "缺少 source 或 file" };
    const buf = Buffer.from(await file.arrayBuffer());
    return { source, rawText: decodeImportFile(buf), sourceRemark, category };
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.source !== "string" || typeof body.rawText !== "string") {
    return { error: "缺少 source 或 rawText" };
  }
  const source = body.source.trim();
  const sourceRemark = (body.sourceRemark as string)?.trim() || undefined;
  const category = (body.category as string)?.trim() || undefined;
  const rawText = body.rawText.trim();
  if (!source || !rawText) return { error: "source 和 rawText 不能为空" };
  return { source, rawText, sourceRemark, category };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const input = await extractInput(req);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const { source, rawText, sourceRemark, category } = input;
  const orderCategory = normalizeOrderCategory(category);
  const { rows, errors: parseErrors, format } = parseOrderText(source, rawText);
  const errors: Array<{ row: number; externalOrderNo?: string; message: string }> = parseErrors;
  if (rows.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors[0].message, errors, format }, { status: 422 });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const touchedCustomerIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const normalizedSource = normalizeOrderSource(row.source);
    const refDate = row.orderAt ?? row.paidAt ?? new Date();

    try {
      const action = await withRetry(async () => {
        const existingSrc = await findExistingImportOrder(prisma, normalizedSource, row.externalOrderNo);

        if (existingSrc?.orderId) {
          if (existingSrc.order && existingSrc.order.mergeTargets.length > 0) {
            return "skipped" as const;
          }

          const isDeleted = existingSrc.order?.deleted;
          const totalAmount = computeOrderAmount(row);
          const updatedOrder = await prisma.order.update({
            where: { id: existingSrc.orderId },
            data: {
              totalAmount: totalAmount > 0 ? totalAmount : undefined,
              category: orderCategory,
              sourceRemark: sourceRemark ?? undefined,
              buyerNameSnapshot: row.receiverName ?? undefined,
              buyerPhoneSnapshot: row.receiverPhone ?? undefined,
              buyerAddressSnapshot: row.receiverAddress ?? undefined,
              buyerWechatSnapshot: row.orderUser ?? undefined,
              buyerOrgNameSnapshot: row.storeName ?? undefined,
              orderedAt: row.orderAt ?? undefined,
              confirmedAt: row.paidAt ?? undefined,
              title: row.productNamesRaw ?? undefined,
              ...(isDeleted ? { deleted: false, deletedAt: null, archived: false, financeTreatment: "AUTO" } : {}),
            },
            select: { customerId: true },
          });
          if (updatedOrder.customerId) touchedCustomerIds.add(updatedOrder.customerId);
          await prisma.orderLine.updateMany({
            where: { orderId: existingSrc.orderId },
            data: { category: orderCategory },
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
              title: row.productNamesRaw || `${row.receiverName || "未知"}的平台订单`,
              category: orderCategory,
              status: "CONFIRMED",
              deliveryStatus: "DELIVERED",
              orderedAt: row.orderAt ?? null,
              confirmedAt: row.paidAt ?? null,
              deliveredAt: row.paidAt ?? new Date(),
              buyerNameSnapshot: row.receiverName,
              buyerPhoneSnapshot: row.receiverPhone,
              buyerAddressSnapshot: row.receiverAddress,
              buyerWechatSnapshot: row.orderUser,
              buyerOrgNameSnapshot: row.storeName,
              totalAmount,
              createdById: session.user.id,
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

          const itemName = row.productNamesRaw || row.externalOrderNo || "平台订单";
          await tx.orderLine.create({
            data: {
              orderId: order.id,
              itemName: String(itemName).slice(0, 200),
              amount: totalAmount,
              category: orderCategory,
              sortOrder: 0,
            },
          });
          if (order.customerId) touchedCustomerIds.add(order.customerId);
        });
        return "created" as const;
      });

      if (action === "updated") updated++;
      else if (action === "created") created++;
      else if (action === "skipped") skipped++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      errors.push({ row: i + 1, externalOrderNo: row.externalOrderNo, message: `创建失败: ${msg}` });
    }
  }

  for (const customerId of touchedCustomerIds) {
    await syncCrmLifecycleForCustomer(customerId);
  }

  return NextResponse.json({ created, updated, skipped, errors, format }, { status: 201 });
}
