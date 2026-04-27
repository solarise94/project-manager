import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { parseOrderText, decodeImportFile } from "@/lib/external-order";

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
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const input = await extractInput(req);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const { source, rawText } = input;
  const { rows, errors, format } = parseOrderText(source, rawText);

  if (rows.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors[0].message, errors, format }, { status: 422 });
  }

  const batch = await prisma.externalOrderImportBatch.create({
    data: {
      source,
      rawText,
      rowCount: rows.length,
      createdById: session.user.id,
    },
  });

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.externalOrder.findUnique({
      where: { source_externalOrderNo: { source: row.source, externalOrderNo: row.externalOrderNo } },
      select: { id: true },
    });

    const data = {
      platform: row.platform,
      merchantOrderNo: row.merchantOrderNo,
      storeName: row.storeName,
      orderType: row.orderType,
      receiverName: row.receiverName,
      receiverPhone: row.receiverPhone,
      receiverAddress: row.receiverAddress,
      orderUser: row.orderUser,
      orderUserTags: row.orderUserTags,
      productNamesRaw: row.productNamesRaw,
      productNamesJson: row.productNamesJson,
      itemCount: row.itemCount,
      itemTypeCount: row.itemTypeCount,
      orderAt: row.orderAt,
      paidAt: row.paidAt,
      scheduledDeliveryText: row.scheduledDeliveryText,
      sellerMessage: row.sellerMessage,
      merchantRemark: row.merchantRemark,
      formNote: row.formNote,
      grossAmount: row.grossAmount,
      priceAdjustment: row.priceAdjustment,
      paidAmount: row.paidAmount,
      shippingFee: row.shippingFee,
      rawJson: row.rawJson,
      importBatchId: batch.id,
    };

    if (existing) {
      await prisma.externalOrder.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.externalOrder.create({
        data: {
          source: row.source,
          externalOrderNo: row.externalOrderNo,
          ...data,
        },
      });
      created++;
    }
  }

  return NextResponse.json({ batchId: batch.id, created, updated, errors, format }, { status: 201 });
}
