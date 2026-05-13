import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseOrderText, decodeImportFile } from "@/lib/external-order";
import { normalizeOrderSource } from "@/lib/orders/constants";
import { generateImportOrderNo, computeOrderAmount, withRetry } from "@/lib/orders/import-commit";

async function extractInput(req: NextRequest): Promise<{ source: string; rawText: string } | { error: string }> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const source = (form.get("source") as string | null)?.trim();
    const file = form.get("file") as File | null;
    if (!source || !file) return { error: "缺少 source 或 file" };
    const buf = Buffer.from(await file.arrayBuffer());
    return { source, rawText: decodeImportFile(buf) };
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.source !== "string" || typeof body.rawText !== "string") {
    return { error: "缺少 source 或 rawText" };
  }
  const source = body.source.trim();
  const rawText = body.rawText.trim();
  if (!source || !rawText) return { error: "source 和 rawText 不能为空" };
  return { source, rawText };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const input = await extractInput(req);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const { source, rawText } = input;
  const { rows, errors, format } = parseOrderText(source, rawText);
  if (rows.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors[0].message, errors, format }, { status: 422 });
  }

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existingSrc = await prisma.orderSourceRecord.findUnique({
      where: { source_externalOrderNo: { source: normalizeOrderSource(row.source), externalOrderNo: row.externalOrderNo } },
      select: { orderId: true },
    });

    const totalAmount = computeOrderAmount(row);
    const refDate = row.orderAt ?? row.paidAt ?? new Date();

    if (existingSrc?.orderId) {
      await prisma.order.update({
        where: { id: existingSrc.orderId },
        data: {
          totalAmount: totalAmount > 0 ? totalAmount : undefined,
          buyerNameSnapshot: row.receiverName ?? undefined,
          buyerPhoneSnapshot: row.receiverPhone ?? undefined,
          buyerAddressSnapshot: row.receiverAddress ?? undefined,
          buyerWechatSnapshot: row.orderUser ?? undefined,
          buyerOrgNameSnapshot: row.storeName ?? undefined,
          orderedAt: row.orderAt ?? undefined,
          confirmedAt: row.paidAt ?? undefined,
          title: row.productNamesRaw ?? undefined,
        },
      });
      updated++;
      continue;
    }

    try {
      await withRetry(async () => {
        await prisma.$transaction(async (tx) => {
          const orderNo = await generateImportOrderNo(tx, refDate);
          const rawJson = JSON.stringify(row);

          const order = await tx.order.create({
            data: {
              orderNo,
              source: normalizeOrderSource(row.source),
              sourcePlatform: row.platform || source,
              externalOrderNo: row.externalOrderNo,
              merchantOrderNo: row.merchantOrderNo,
              title: row.productNamesRaw || `${row.receiverName || "未知"}的拼好鼠订单`,
              category: "UNKNOWN",
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

          await tx.orderSourceRecord.create({
            data: {
              orderId: order.id,
              source: normalizeOrderSource(row.source),
              platform: row.platform || source,
              externalOrderNo: row.externalOrderNo,
              merchantOrderNo: row.merchantOrderNo,
              rawJson,
            },
          });

          const itemName = row.productNamesRaw || row.externalOrderNo || "拼好鼠订单";
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
      });
      created++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      errors.push({ row: rows.indexOf(row) + 2, message: `创建失败: ${msg}` });
    }
  }

  return NextResponse.json({ created, updated, errors, format }, { status: 201 });
}
