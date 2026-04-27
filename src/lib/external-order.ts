import type { PrismaClient } from "@prisma/client";
import { parse as csvParse } from "csv-parse/sync";
import iconv from "iconv-lite";

export interface NormalizedOrderRow {
  source: string;
  platform: string | null;
  externalOrderNo: string;
  merchantOrderNo: string | null;
  storeName: string | null;
  orderType: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  orderUser: string | null;
  orderUserTags: string | null;
  productNamesRaw: string | null;
  productNamesJson: string | null;
  itemCount: number | null;
  itemTypeCount: number | null;
  orderAt: Date | null;
  paidAt: Date | null;
  scheduledDeliveryText: string | null;
  sellerMessage: string | null;
  merchantRemark: string | null;
  formNote: string | null;
  grossAmount: number | null;
  priceAdjustment: number | null;
  paidAmount: number | null;
  shippingFee: number | null;
  rawJson: string;
}

export interface ParseResult {
  rows: NormalizedOrderRow[];
  errors: Array<{ row: number; message: string }>;
}

export interface InvoicePrefill {
  contactName: string;
  buyerOrganizationName: string;
  invoiceType: string;
  contentSummary: string;
  remark: string;
  items: Array<{
    itemName: string;
    spec: string | null;
    unit: string | null;
    quantity: number | null;
    amount: number;
  }>;
}

const ORDER_HEADER_MAP: Record<string, string> = {
  "所属平台": "platform",
  "订单号": "externalOrderNo",
  "商户单号": "merchantOrderNo",
  "所属门店": "storeName",
  "全部商品名称": "productNamesRaw",
  "商品总件数": "itemCount",
  "商品种类数": "itemTypeCount",
  "下单时间": "orderAt",
  "付款时间": "paidAt",
  "卖家留言": "sellerMessage",
  "商家备注": "merchantRemark",
  "预约配送时间": "scheduledDeliveryText",
  "订单类型": "orderType",
  "收件人": "receiverName",
  "收件人电话": "receiverPhone",
  "商品总额": "grossAmount",
  "下单用户": "orderUser",
  "下单用户标签": "orderUserTags",
  "备注/表单": "formNote",
  "收件人地址": "receiverAddress",
  "订单改价": "priceAdjustment",
  "订单实付金额": "paidAmount",
  "运费": "shippingFee",
};

function tryParseDate(s: string | undefined): Date | null {
  if (!s || !s.trim()) return null;
  const d = new Date(s.trim());
  return isNaN(d.getTime()) ? null : d;
}

function tryParseNumber(s: string | undefined): number | null {
  if (!s || !s.trim()) return null;
  const cleaned = s.replace(/[¥￥,，]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function tryParseInt(s: string | undefined): number | null {
  if (!s || !s.trim()) return null;
  const n = parseInt(s.trim(), 10);
  return isNaN(n) ? null : n;
}

function cleanCell(s: string): string {
  let v = s;
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  v = v.replace(/""/g, '"');
  v = v.replace(/\t+$/, "");
  return v.trim();
}

function scoreHeaders(cells: string[]): number {
  return cells.filter((c) => ORDER_HEADER_MAP[cleanCell(c)] != null).length;
}

type DetectedFormat = { kind: "csv" } | { kind: "tsv" };

function detectFormat(rawText: string): DetectedFormat {
  const firstLine = rawText.split(/\r?\n/)[0] || "";

  let csvScore = 0;
  try {
    const parsed: string[][] = csvParse(firstLine + "\n", {
      relax_column_count: true,
      skip_empty_lines: true,
    });
    if (parsed.length > 0) csvScore = scoreHeaders(parsed[0]);
  } catch { /* not valid CSV */ }

  const tsvCells = firstLine.split("\t");
  const tsvScore = scoreHeaders(tsvCells);

  if (csvScore > 0 && csvScore >= tsvScore) return { kind: "csv" };
  if (tsvScore > 0) return { kind: "tsv" };
  // Both 0 hits — guess by structure
  if (firstLine.includes(",")) return { kind: "csv" };
  return { kind: "tsv" };
}

export interface FormatInfo {
  detected: "csv" | "tsv";
  headerHits: number;
  headerTotal: number;
  recognizedHeaders: string[];
}

function splitRows(rawText: string): { rows: string[][]; format: FormatInfo } {
  const fmt = detectFormat(rawText);

  let rows: string[][];
  if (fmt.kind === "csv") {
    const records: string[][] = csvParse(rawText, {
      relax_column_count: true,
      skip_empty_lines: true,
    });
    rows = records.map((row) => row.map(cleanCell));
  } else {
    rows = rawText
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((line) => line.split("\t").map((c) => cleanCell(c)));
  }

  const headers = rows[0] || [];
  const recognized = headers.filter((h) => ORDER_HEADER_MAP[h] != null);

  return {
    rows,
    format: {
      detected: fmt.kind,
      headerHits: recognized.length,
      headerTotal: headers.length,
      recognizedHeaders: recognized,
    },
  };
}

export function decodeImportFile(buffer: Buffer): string {
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.subarray(3).toString("utf-8");
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return iconv.decode(buffer.subarray(2), "utf-16le");
  }
  if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    return iconv.decode(buffer.subarray(2), "utf-16be");
  }
  const utf8 = buffer.toString("utf-8");
  if (!utf8.includes("�")) return utf8;
  return iconv.decode(buffer, "gb18030");
}

export interface ParseResultWithFormat extends ParseResult {
  format: FormatInfo;
}

export function parseOrderText(source: string, rawText: string): ParseResultWithFormat {
  const { rows: rows2d, format } = splitRows(rawText);

  if (rows2d.length < 2) {
    return { rows: [], errors: [{ row: 0, message: "无有效数据行" }], format };
  }

  if (format.headerHits === 0) {
    return {
      rows: [],
      errors: [{
        row: 1,
        message: `无法识别导入文件格式。检测到分隔符: ${format.detected}，识别到的表头: ${format.headerTotal > 0 ? rows2d[0].slice(0, 5).join(", ") + (format.headerTotal > 5 ? "..." : "") : "（空）"}`,
      }],
      format,
    };
  }

  const headers = rows2d[0];
  const fieldMap = headers.map((h) => ORDER_HEADER_MAP[h] || null);

  const rows: NormalizedOrderRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 1; i < rows2d.length; i++) {
    const cols = rows2d[i];
    const raw: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      raw[headers[j]] = cols[j] || "";
    }

    const mapped: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const field = fieldMap[j];
      if (field) mapped[field] = cols[j] || "";
    }

    if (!mapped.externalOrderNo) {
      errors.push({ row: i + 1, message: "缺少订单号" });
      continue;
    }

    const productNamesRaw = mapped.productNamesRaw || null;
    const productNames = productNamesRaw
      ? productNamesRaw.split(/[;；]/).map((s) => s.trim()).filter(Boolean)
      : [];

    rows.push({
      source,
      platform: mapped.platform || null,
      externalOrderNo: mapped.externalOrderNo,
      merchantOrderNo: mapped.merchantOrderNo || null,
      storeName: mapped.storeName || null,
      orderType: mapped.orderType || null,
      receiverName: mapped.receiverName || null,
      receiverPhone: mapped.receiverPhone || null,
      receiverAddress: mapped.receiverAddress || null,
      orderUser: mapped.orderUser || null,
      orderUserTags: mapped.orderUserTags || null,
      productNamesRaw,
      productNamesJson: productNames.length > 0 ? JSON.stringify(productNames) : null,
      itemCount: tryParseInt(mapped.itemCount),
      itemTypeCount: tryParseInt(mapped.itemTypeCount),
      orderAt: tryParseDate(mapped.orderAt),
      paidAt: tryParseDate(mapped.paidAt),
      scheduledDeliveryText: mapped.scheduledDeliveryText || null,
      sellerMessage: mapped.sellerMessage || null,
      merchantRemark: mapped.merchantRemark || null,
      formNote: mapped.formNote || null,
      grossAmount: tryParseNumber(mapped.grossAmount),
      priceAdjustment: tryParseNumber(mapped.priceAdjustment),
      paidAmount: tryParseNumber(mapped.paidAmount),
      shippingFee: tryParseNumber(mapped.shippingFee),
      rawJson: JSON.stringify(raw),
    });
  }

  return { rows, errors, format };
}

/** @deprecated Use parseOrderText instead */
export const parseTsvText = parseOrderText;

export function buildInvoicePrefillFromOrder(order: {
  receiverName: string | null;
  productNamesJson: string | null;
  productNamesRaw: string | null;
  itemCount: number | null;
  paidAmount: number | null;
  merchantRemark: string | null;
  formNote: string | null;
  scheduledDeliveryText: string | null;
  receiverAddress: string | null;
}): InvoicePrefill {
  const productNames: string[] = order.productNamesJson
    ? JSON.parse(order.productNamesJson)
    : [];

  let contentSummary: string;
  if (productNames.length === 1) {
    contentSummary = productNames[0];
  } else if (productNames.length > 1) {
    const preview = productNames.slice(0, 3).join("、");
    contentSummary = productNames.length <= 3 ? preview : `${preview}等`;
  } else {
    contentSummary = "商品销售";
  }

  const remarkParts = [
    order.merchantRemark,
    order.formNote,
    order.scheduledDeliveryText,
    order.receiverAddress,
  ].filter(Boolean);

  const itemName = productNames.length > 0
    ? productNames.join("、")
    : (order.productNamesRaw || "商品");

  return {
    contactName: order.receiverName || "",
    buyerOrganizationName: "",
    invoiceType: "NORMAL",
    contentSummary,
    remark: remarkParts.join("\n"),
    items: [{
      itemName,
      spec: null,
      unit: null,
      quantity: order.itemCount,
      amount: order.paidAmount || 0,
    }],
  };
}

const STATUS_PRIORITY: Record<string, number> = {
  ISSUED: 4, REQUESTED: 3, DRAFT: 2, CANCELLED: 1, NONE: 0,
};

export async function syncOrderInvoiceStatus(
  prisma: PrismaClient,
  externalOrderId: string,
): Promise<void> {
  const invoices = await prisma.externalOrderInvoiceRequest.findMany({
    where: { externalOrderId },
    select: { status: true },
  });

  let highest = "NONE";
  for (const inv of invoices) {
    if (inv.status === "CANCELLED") continue;
    if ((STATUS_PRIORITY[inv.status] || 0) > (STATUS_PRIORITY[highest] || 0)) {
      highest = inv.status;
    }
  }

  await prisma.externalOrder.update({
    where: { id: externalOrderId },
    data: { invoiceStatus: highest },
  });
}
