import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { parseOrderText, decodeImportFile } from "@/lib/external-order";
import * as XLSX from "xlsx";

function tryParseXlsx(buffer: Buffer): string | null {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return sheet ? XLSX.utils.sheet_to_csv(sheet) : null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ct = req.headers.get("content-type") || "";
  let source: string;
  let rawText: string;

  let sourceRemark: string | undefined;

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    source = (form.get("source") as string | null)?.trim() || "OTHER_IMPORT";
    sourceRemark = (form.get("sourceRemark") as string | null)?.trim() || undefined;
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "缺少 file" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    if (file.name.endsWith(".xlsx")) {
      const csv = tryParseXlsx(buf);
      if (!csv) return NextResponse.json({ error: "无法解析 .xlsx 文件" }, { status: 422 });
      rawText = csv;
    } else {
      rawText = decodeImportFile(buf);
    }
  } else {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.rawText !== "string") return NextResponse.json({ error: "缺少 rawText" }, { status: 400 });
    source = (body.source as string)?.trim() || "OTHER_IMPORT";
    sourceRemark = (body.sourceRemark as string)?.trim() || undefined;
    rawText = body.rawText.trim();
  }

  if (!source || !rawText) return NextResponse.json({ error: "source 和 rawText 不能为空" }, { status: 400 });

  const { rows, errors, format } = parseOrderText(source, rawText);

  const rawColumns = format.recognizedHeaders.length > 0
    ? format.recognizedHeaders
    : (rows.length > 0 ? Object.keys(JSON.parse(rows[0].rawJson || "{}")) : []);

  const directImportable = format.headerHits >= 5;
  const suggestedMode = directImportable ? ("DIRECT" as const) : ("AI_NORMALIZE" as const);

  const previewRows = rows.slice(0, 10).map((r) => {
    const raw = JSON.parse(r.rawJson || "{}") as Record<string, string>;
    return { externalOrderNo: r.externalOrderNo, receiverName: r.receiverName, totalAmount: r.paidAmount ?? r.grossAmount, ...raw };
  });

  return NextResponse.json({
    format,
    rawColumns,
    rowCount: rows.length,
    errorCount: errors.length,
    directImportable,
    suggestedMode,
    previewRows,
    rows,
    errors: errors.slice(0, 20),
    sourceRemark,
  });
}
