import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseOrderText, decodeImportFile } from "@/lib/external-order";
import { normalizeOrderSource, normalizeOrderCategory } from "@/lib/orders/constants";
import { computeOrderAmount, findExistingImportOrder, generateImportOrderNo, upsertImportSourceRecord, withRetry } from "@/lib/orders/import-commit";
import { resolveOrCreateOrganizationForImport, resolveOrCreateCustomerForImport } from "@/lib/orders/import-masterdata";
import type { CustomerMode, OrganizationMode } from "@/lib/orders/import-masterdata";
import * as XLSX from "xlsx";
import { resolveCustomerRepresentative } from "@/lib/crm/customer-owner-representative";
import { transitionCrmStage } from "@/lib/crm/lifecycle";

function tryParseXlsx(buffer: Buffer): string | null {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return null;
    const sheet = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_csv(sheet);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ct = req.headers.get("content-type") || "";
  let source: string;
  let sourceRemark: string | undefined;
  let category: string | undefined;
  let rawText: string;
  let customerMode: CustomerMode = "MATCH_ONLY";
  let organizationMode: OrganizationMode = "RESOLVE_ONLY";
  let ownerUserId: string | null = null;
  let createCrmProfile = false;
  let columnMapping: Record<string, string> | null = null;

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    source = (form.get("source") as string | null)?.trim() || "OTHER_IMPORT";
    sourceRemark = (form.get("sourceRemark") as string | null)?.trim() || undefined;
    category = (form.get("category") as string | null)?.trim() || undefined;
    customerMode = (form.get("customerMode") as CustomerMode) || "MATCH_ONLY";
    organizationMode = (form.get("organizationMode") as OrganizationMode) || "RESOLVE_ONLY";
    ownerUserId = (form.get("ownerUserId") as string)?.trim() || null;
    createCrmProfile = form.get("createCrmProfile") === "true";
    const mappingStr = (form.get("columnMapping") as string)?.trim();
    if (mappingStr) {
      try { columnMapping = JSON.parse(mappingStr) as Record<string, string>; } catch { /* ignore */ }
    }
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "缺少 file" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    if (file.name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      const csv = tryParseXlsx(buf);
      if (!csv) return NextResponse.json({ error: "无法解析 .xlsx 文件" }, { status: 422 });
      rawText = csv;
    } else {
      rawText = decodeImportFile(buf);
    }
  } else {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "无效请求体" }, { status: 400 });
    source = (body.source as string)?.trim() || "OTHER_IMPORT";
    sourceRemark = (body.sourceRemark as string)?.trim() || undefined;
    category = (body.category as string)?.trim() || undefined;
    rawText = (body.rawText as string)?.trim() || "";
    customerMode = (body.customerMode as CustomerMode) || "MATCH_ONLY";
    organizationMode = (body.organizationMode as OrganizationMode) || "RESOLVE_ONLY";
    ownerUserId = typeof body.ownerUserId === "string" ? body.ownerUserId.trim() : null;
    createCrmProfile = body.createCrmProfile === true;
    if (body.columnMapping && typeof body.columnMapping === "object") {
      columnMapping = body.columnMapping as Record<string, string>;
    }
    if (!rawText) return NextResponse.json({ error: "缺少 rawText" }, { status: 400 });
  }

  // Validate modes
  const validCustomerModes: CustomerMode[] = ["MATCH_ONLY", "CREATE_IF_MISSING", "SKIP"];
  const validOrgModes: OrganizationMode[] = ["RESOLVE_ONLY", "CREATE_IF_MISSING", "SKIP"];
  if (!validCustomerModes.includes(customerMode)) customerMode = "MATCH_ONLY";
  if (!validOrgModes.includes(organizationMode)) organizationMode = "RESOLVE_ONLY";
  if (createCrmProfile && !ownerUserId) {
    return NextResponse.json({ error: "createCrmProfile 需要指定 ownerUserId" }, { status: 400 });
  }
  const orderCategory = normalizeOrderCategory(category);

  // Apply AI column mapping: rewrite header row with Chinese names that ORDER_HEADER_MAP recognizes.
  // AI outputs standard English field names; we reverse-translate to Chinese before handing to the parser.
  if (columnMapping && Object.keys(columnMapping).length > 0) {
    const EN_TO_CN: Record<string, string> = {
      source: "所属平台",
      platform: "所属平台",
      externalOrderNo: "订单号",
      merchantOrderNo: "商户单号",
      buyerName: "收件人",
      buyerPhone: "收件人电话",
      buyerWechat: "下单用户",
      buyerOrgName: "所属门店",
      buyerAddress: "收件人地址",
      productNamesRaw: "全部商品名称",
      itemCount: "商品总件数",
      orderAt: "下单时间",
      paidAt: "付款时间",
      grossAmount: "商品总额",
      priceAdjustment: "订单改价",
      paidAmount: "订单实付金额",
      shippingFee: "运费",
      sellerMessage: "卖家留言",
      merchantRemark: "商家备注",
      rawExtraJson: "备注/表单",
      storeName: "所属门店",
      receiverName: "收件人",
      receiverPhone: "收件人电话",
      receiverAddress: "收件人地址",
      orderUser: "下单用户",
      itemTypeCount: "商品种类数",
      formNote: "备注/表单",
    };

    const lines = rawText.split(/\r?\n/);
    if (lines.length > 0) {
      const headerLine = lines[0];
      const isTsv = headerLine.includes("\t") && !headerLine.includes(",");
      const delimiter = isTsv ? "\t" : ",";
      const headers = headerLine.split(delimiter).map((h) => h.trim());
      const mapped = headers.map((h) => {
        const english = columnMapping![h];
        if (!english) return h;
        // Try Chinese reverse lookup first, fall back to the English name directly
        return EN_TO_CN[english] || english;
      });
      lines[0] = mapped.join(delimiter);
      rawText = lines.join("\n");
    }
  }

  const { rows, errors: parseErrors, format } = parseOrderText(source, rawText);
  const errors: Array<{ row: number; externalOrderNo?: string; message: string }> = parseErrors;
  if (rows.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors[0].message, errors, format }, { status: 422 });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const touchedCustomerIds = new Set<string>();

  let rowIndex = 0;
  for (const row of rows) {
    const normalizedSource = normalizeOrderSource(row.source);
    const refDate = row.orderAt ?? row.paidAt ?? new Date();

    // Resolve org and customer + create order in a single atomic transaction
    try {
      const action = await withRetry(async () => {
        // Dedup check inside retry so concurrent imports see committed records on retry
        const existingSrc = await findExistingImportOrder(prisma, normalizedSource, row.externalOrderNo);
        if (existingSrc?.orderId) {
          // Skip merge targets — source records were moved here during merge,
          // updating would corrupt the consolidated target order.
          if (existingSrc.order && existingSrc.order.mergeTargets.length > 0) {
            return "skipped" as const;
          }

          const existingOrder = await prisma.order.findUnique({
            where: { id: existingSrc.orderId },
            select: {
              customerId: true,
              customerMatchStatus: true,
              customerMatchScore: true,
              customerMatchReason: true,
            },
          });
          if (!existingOrder) {
            throw new Error("订单不存在");
          }

          await prisma.$transaction(async (tx) => {
            let custResult: {
              customerId: string | null;
              matchStatus: "AUTO_MATCHED" | "UNMATCHED";
              matchScore: number | null;
              matchReason: string | null;
            } | null = null;

            if (!existingOrder.customerId) {
              const orgResult = await resolveOrCreateOrganizationForImport(
                row.storeName, organizationMode, tx,
              );

              const custInput = {
                buyerName: row.receiverName,
                buyerPhone: row.receiverPhone,
                buyerWechat: row.orderUser,
                buyerOrgName: row.storeName,
                buyerAddress: row.receiverAddress,
              };
              custResult = await resolveOrCreateCustomerForImport(
                custInput, customerMode, orgResult.organizationId, ownerUserId, createCrmProfile, tx,
              );
            }

            const nextCustomerId = custResult?.customerId ?? existingOrder.customerId;
            const resolvedRep = nextCustomerId
              ? await resolveCustomerRepresentative(nextCustomerId, tx)
              : { representativeId: null };
            const isDeleted = existingSrc.order?.deleted;
            const totalAmount = computeOrderAmount(row);

            const updatedOrder = await tx.order.update({
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
                customerId: nextCustomerId,
                representativeId: resolvedRep.representativeId,
                customerMatchStatus: custResult?.customerId ? custResult.matchStatus : existingOrder.customerMatchStatus,
                customerMatchScore: custResult?.customerId ? custResult.matchScore : existingOrder.customerMatchScore,
                customerMatchReason: custResult?.customerId ? custResult.matchReason : existingOrder.customerMatchReason,
                ...(isDeleted ? { deleted: false, deletedAt: null, archived: false, financeTreatment: "AUTO" } : {}),
              },
              select: { customerId: true },
            });
            if (updatedOrder.customerId) touchedCustomerIds.add(updatedOrder.customerId);
            await tx.orderLine.updateMany({
              where: { orderId: existingSrc.orderId },
              data: { category: orderCategory },
            });
            await upsertImportSourceRecord(tx, {
              orderId: existingSrc.orderId,
              source: normalizedSource,
              sourceRemark,
              platform: row.platform || source,
              externalOrderNo: row.externalOrderNo,
              merchantOrderNo: row.merchantOrderNo,
              rawJson: JSON.stringify(row),
            });
          });
          return "updated" as const;
        }

        await prisma.$transaction(async (tx) => {
          const orgResult = await resolveOrCreateOrganizationForImport(
            row.storeName, organizationMode, tx,
          );

          const custInput = {
            buyerName: row.receiverName,
            buyerPhone: row.receiverPhone,
            buyerWechat: row.orderUser,
            buyerOrgName: row.storeName,
            buyerAddress: row.receiverAddress,
          };
          const custResult = await resolveOrCreateCustomerForImport(
            custInput, customerMode, orgResult.organizationId, ownerUserId, createCrmProfile, tx,
          );

          const totalAmount = computeOrderAmount(row);
          const orderNo = await generateImportOrderNo(tx, refDate);
          const rawJson = JSON.stringify(row);
          const resolvedRep = custResult.customerId
            ? await resolveCustomerRepresentative(custResult.customerId, tx)
            : { representativeId: null };

          const order = await tx.order.create({
            data: {
              orderNo,
              source: normalizedSource,
              sourcePlatform: row.platform || source,
              sourceRemark,
              externalOrderNo: row.externalOrderNo,
              merchantOrderNo: row.merchantOrderNo,
              title: row.productNamesRaw || `${row.receiverName || "未知"}的订单`,
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
              customerId: custResult.customerId,
              representativeId: resolvedRep.representativeId,
              customerMatchStatus: custResult.matchStatus,
              customerMatchScore: custResult.matchScore,
              customerMatchReason: custResult.matchReason,
              createdById: session.user.id,
            },
          });
          if (order.customerId) touchedCustomerIds.add(order.customerId);

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
              category: orderCategory,
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
      errors.push({ row: rowIndex + 1, externalOrderNo: row.externalOrderNo, message: `创建失败: ${msg}` });
    }
    rowIndex++;
  }

  // CRM 阶段同步：导入订单均为 CONFIRMED，触发 ORDER_CONFIRMED
  for (const customerId of touchedCustomerIds) {
    const profile = await prisma.crmCustomerProfile.findUnique({
      where: { sourceCustomerId: customerId },
      select: { id: true },
    });
    if (profile) {
      await transitionCrmStage(profile.id, { type: "ORDER_CONFIRMED", orderId: "import-batch" }).catch((err) => {
        console.error(`[CRM][ORDER_IMPORT] ORDER_CONFIRMED transition failed for ${profile.id}:`, err);
      });
    }
  }

  return NextResponse.json({ created, updated, skipped, errors, format }, { status: 201 });
}
