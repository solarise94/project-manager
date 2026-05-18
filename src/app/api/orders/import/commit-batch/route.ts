import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { processImportRows, BATCH_SIZE } from "@/lib/orders/import-batch";
import { normalizeImportDate } from "@/lib/orders/import-commit";
import type { NormalizedOrderRow } from "@/lib/external-order";

type CommitBatchRow = Omit<NormalizedOrderRow, "orderAt" | "paidAt"> & {
  orderAt: Date | string | null;
  paidAt: Date | string | null;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "无效请求体" }, { status: 400 });

  const {
    source,
    sourceRemark,
    rows,
    customerMode = "MATCH_ONLY",
    organizationMode = "RESOLVE_ONLY",
    ownerUserId = null,
    createCrmProfile = false,
    batchIndex = 0,
    totalBatches = 1,
  } = body as {
    source: string;
    sourceRemark?: string;
    rows: CommitBatchRow[];
    customerMode?: string;
    organizationMode?: string;
    ownerUserId?: string | null;
    createCrmProfile?: boolean;
    batchIndex?: number;
    totalBatches?: number;
  };

  if (!source?.trim()) return NextResponse.json({ error: "缺少 source" }, { status: 400 });
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows 必须是非空数组" }, { status: 400 });
  }
  if (rows.length > BATCH_SIZE) {
    return NextResponse.json({ error: `每批最多 ${BATCH_SIZE} 条，收到 ${rows.length} 条` }, { status: 400 });
  }

  // Validate modes (mirrors commit route)
  const validCustomerModes = ["MATCH_ONLY", "CREATE_IF_MISSING", "SKIP"];
  const validOrgModes = ["RESOLVE_ONLY", "CREATE_IF_MISSING", "SKIP"];
  const safeCustomerMode = validCustomerModes.includes(customerMode) ? customerMode : "MATCH_ONLY";
  const safeOrgMode = validOrgModes.includes(organizationMode) ? organizationMode : "RESOLVE_ONLY";
  if (createCrmProfile && !ownerUserId) {
    return NextResponse.json({ error: "createCrmProfile 需要指定 ownerUserId" }, { status: 400 });
  }

  const normalizedRows: NormalizedOrderRow[] = rows.map((row) => ({
    ...row,
    orderAt: normalizeImportDate(row.orderAt),
    paidAt: normalizeImportDate(row.paidAt),
  }));

  const result = await processImportRows({
    source: source.trim(),
    sourceRemark: sourceRemark?.trim() || undefined,
    rows: normalizedRows,
    userId: session.user.id,
    customerMode: safeCustomerMode as "MATCH_ONLY" | "CREATE_IF_MISSING" | "SKIP",
    organizationMode: safeOrgMode as "RESOLVE_ONLY" | "CREATE_IF_MISSING" | "SKIP",
    ownerUserId,
    createCrmProfile,
  });

  return NextResponse.json({
    ...result,
    batchIndex,
    totalBatches,
    processed: normalizedRows.length,
  }, { status: 201 });
}
