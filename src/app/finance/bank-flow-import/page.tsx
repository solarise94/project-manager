"use client";

import { useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { Loader2, Upload, ArrowLeft, ArrowRight, Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatLocalDateInput, getTodayLocalDateInput } from "@/lib/finance/date-input";

// ─── Types ──────────────────────────────────────────────────────

interface RawRow {
  cells: (string | number | null)[];
  rowIndex: number;
}

interface ParsedRow {
  id: string;
  rowIndex: number;
  payerName: string;
  amount: number;
  date: string; // ISO date string YYYY-MM-DD
  remark: string;
}

interface MatchCombination {
  invoiceIds: string[];
  amounts: number[];
  sum: number;
  count: number;
  crossOrder: boolean;
  orderBreakdown: Array<{ orderId: string; sum: number }>;
}

interface MatchApiResponse {
  status: "MATCHED" | "NO_EXACT_MATCH";
  reason?: "SUM_SHORTFALL" | "NO_SUBSET_EQUALS";
  organization?: { id: string; canonicalName: string };
  candidateInvoices?: Array<{
    id: string;
    invoiceNo: string | null;
    totalAmount: number;
    outstanding: number;
    issuedAt: string | null;
    orderId: string | null;
    buyerOrganizationName: string;
  }>;
  combinations?: MatchCombination[];
  nearestBelow?: { sum: number; delta: number; count: number };
  nearestAbove?: { sum: number; delta: number; count: number };
  degraded?: boolean;
}

type QueueItemStatus =
  | "pending"
  | "resolving"
  | "matched"
  | "unmatched"
  | "confirming"
  | "confirmed"
  | "error";

interface QueueItem extends ParsedRow {
  status: QueueItemStatus;
  error?: string;
  organizationId?: string;
  organizationName?: string;
  matchResult?: MatchApiResponse;
  selectedCombination?: MatchCombination;
}

interface OrgOption {
  id: string;
  canonicalName: string;
}

// ─── Column mapping helpers ─────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  payerName: "付款单位",
  amount: "金额",
  date: "到款日期",
  remark: "备注",
};

const FIELD_KEYWORDS: Record<string, string[]> = {
  payerName: ["付款", "对方户名", "户名", "单位", "客户", "payer", "name"],
  amount: ["金额", "收入", "收款", "amount", "credit", "转入"],
  date: ["日期", "时间", "date", "time"],
  remark: ["备注", "摘要", "用途", "remark", "note", "用途"],
};

function guessColumnMapping(headers: string[]): Record<string, number | null> {
  const mapping: Record<string, number | null> = {
    payerName: null,
    amount: null,
    date: null,
    remark: null,
  };
  const used = new Set<number>();
  for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = String(headers[i] ?? "").toLowerCase();
      if (keywords.some((k) => h.includes(k))) {
        mapping[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return mapping;
}

function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/,/g, "").replace(/\s+/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 500000) return null;
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return null;
  return new Date(
    parsed.y,
    parsed.m - 1,
    parsed.d,
    parsed.H ?? 0,
    parsed.M ?? 0,
    parsed.S ?? 0,
  );
}

function parseDateString(s: string): Date | null {
  const trimmed = s.trim();
  // 2024-05-01 / 2024/05/01 / 2024-05-01 14:30
  const m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
    return new Date(y, mo - 1, d, h || 0, mi || 0, se || 0);
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : formatLocalDateInput(v);
  if (typeof v === "number") {
    const d = excelSerialToDate(v);
    return d ? formatLocalDateInput(d) : null;
  }
  const d = parseDateString(String(v));
  return d ? formatLocalDateInput(d) : null;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Page ─────────────────────────────────────────────────────────

export default function BankFlowImportPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!session) {
    router.push("/login");
    return null;
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "USER") {
    router.push("/finance/order-receivables");
    return null;
  }

  return <BankFlowImportContent />;
}

function BankFlowImportContent() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "review" | "done">("upload");

  const [rawSheetRows, setRawSheetRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number | null>>({
    payerName: null,
    amount: null,
    date: null,
    remark: null,
  });
  const [hasHeader, setHasHeader] = useState(true);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processing, setProcessing] = useState(false);

  function looksLikeHeader(row: unknown[]): boolean {
    if (!row || row.length === 0) return false;
    const joined = row
      .map((c) => String(c ?? "").toLowerCase())
      .join(" ");
    return Object.values(FIELD_KEYWORDS)
      .flat()
      .some((kw) => joined.includes(kw));
  }

  const displayHeaders = useMemo<string[]>(() => {
    if (!hasHeader || rawSheetRows.length === 0) return [];
    return rawSheetRows[0].map((h) => String(h ?? "").trim());
  }, [rawSheetRows, hasHeader]);

  const rawRows = useMemo<RawRow[]>(() => {
    const start = hasHeader ? 1 : 0;
    const rows: RawRow[] = [];
    for (let i = start; i < rawSheetRows.length; i++) {
      const cells = rawSheetRows[i] as (string | number | null)[];
      if (!cells || cells.every((c) => c == null || String(c).trim() === "")) continue;
      rows.push({ cells, rowIndex: i + 1 });
    }
    return rows;
  }, [rawSheetRows, hasHeader]);

  const parsedRows = useMemo<ParsedRow[]>(() => {
    const rows: ParsedRow[] = [];
    for (const raw of rawRows) {
      const payerName = mapping.payerName != null ? String(raw.cells[mapping.payerName] ?? "").trim() : "";
      const amount = mapping.amount != null ? parseAmount(raw.cells[mapping.amount]) : null;
      const date = mapping.date != null ? parseDate(raw.cells[mapping.date]) : null;
      const remark = mapping.remark != null ? String(raw.cells[mapping.remark] ?? "").trim() : "";
      if (!payerName || amount == null) continue;
      rows.push({
        id: generateId(),
        rowIndex: raw.rowIndex,
        payerName,
        amount,
        date: date ?? getTodayLocalDateInput(),
        remark,
      });
    }
    return rows;
  }, [rawRows, mapping]);

  const applyHeaderMode = useCallback((withHeader: boolean) => {
    setHasHeader(withHeader);
    const headers = withHeader && rawSheetRows.length > 0
      ? rawSheetRows[0].map((h) => String(h ?? "").trim())
      : [];
    setMapping(headers.length > 0 ? guessColumnMapping(headers) : { payerName: null, amount: null, date: null, remark: null });
  }, [rawSheetRows]);

  const handleFile = useCallback(async (file: File) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null });
    if (json.length === 0) {
      toast.error("文件为空");
      return;
    }

    const detectedHeader = looksLikeHeader(json[0] as unknown[]);
    setRawSheetRows(json as unknown[][]);
    setHasHeader(detectedHeader);
    const headers = detectedHeader ? json[0].map((h) => String(h ?? "").trim()) : [];
    setMapping(headers.length > 0 ? guessColumnMapping(headers) : { payerName: null, amount: null, date: null, remark: null });
  }, []);

  const runAutoMatch = useCallback(async () => {
    if (parsedRows.length === 0) return;
    setProcessing(true);
    const initialQueue: QueueItem[] = parsedRows.map((r) => ({ ...r, status: "resolving" }));
    setQueue(initialQueue);
    setStep("review");

    for (let i = 0; i < initialQueue.length; i++) {
      const row = initialQueue[i];
      setQueue((prev) => prev.map((item) => (item.id === row.id ? { ...item, status: "resolving" } : item)));

      try {
        // Resolve organization
        const resolveRes = await fetch("/api/organizations/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: row.payerName }),
        });
        const resolveData = await resolveRes.json();
        if (!resolveRes.ok || !resolveData.organizationId) {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === row.id
                ? {
                    ...item,
                    status: "unmatched",
                    error: resolveData.status === "candidate" ? "请从候选机构中确认" : "未解析到机构",
                    organizationId: undefined,
                    organizationName: undefined,
                  }
                : item,
            ),
          );
          continue;
        }

        const orgId = resolveData.organizationId;
        const orgName = resolveData.canonicalName;

        // Match invoices
        const matchRes = await fetch("/api/finance/payment-vouchers/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId: orgId, amount: row.amount, receivedAt: row.date }),
        });
        const matchData: MatchApiResponse = await matchRes.json();
        if (!matchRes.ok || matchData.status !== "MATCHED" || !matchData.combinations || matchData.combinations.length === 0) {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === row.id
                ? {
                    ...item,
                    status: "unmatched",
                    error: matchData.reason === "SUM_SHORTFALL" ? "候选金额不足" : "无精确匹配组合",
                    organizationId: orgId,
                    organizationName: orgName,
                    matchResult: matchData,
                  }
                : item,
            ),
          );
          continue;
        }

        setQueue((prev) =>
          prev.map((item) =>
            item.id === row.id
              ? {
                  ...item,
                  status: "matched",
                  organizationId: orgId,
                  organizationName: orgName,
                  matchResult: matchData,
                  selectedCombination: matchData.combinations![0],
                }
              : item,
          ),
        );
      } catch {
        setQueue((prev) =>
          prev.map((item) => (item.id === row.id ? { ...item, status: "error", error: "请求失败" } : item)),
        );
      }
    }

    setProcessing(false);
  }, [parsedRows]);

  const confirmItem = useCallback(async (item: QueueItem): Promise<boolean> => {
    if (!item.selectedCombination || !item.organizationId) return false;
    setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: "confirming" } : q)));

    const allocations = item.selectedCombination.invoiceIds.map((invoiceId, idx) => ({
      invoiceId,
      amount: item.selectedCombination!.amounts[idx],
    }));

    try {
      const res = await fetch("/api/finance/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: item.amount,
          receivedAt: item.date,
          source: "BANK",
          remark: item.remark || `批量导入：付款单位=${item.payerName}, 命中 ${allocations.length} 张发票`,
          organizationId: item.organizationId,
          allocations,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: "error", error: data.error || "核销失败" } : q)));
        return false;
      }
      setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: "confirmed" } : q)));
      toast.success(`第 ${item.rowIndex} 行核销成功`);
      return true;
    } catch {
      setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: "error", error: "网络错误" } : q)));
      return false;
    }
  }, []);

  const confirmAllMatched = useCallback(async () => {
    const matched = queue.filter((q) => q.status === "matched");
    if (matched.length === 0) return;
    setProcessing(true);
    let failedCount = 0;
    for (const item of matched) {
      const ok = await confirmItem(item);
      if (!ok) failedCount += 1;
    }
    setProcessing(false);

    if (failedCount > 0) {
      toast.error(`${failedCount} 行核销失败，请留在复核页查看失败明细`);
      return;
    }
    setStep("done");
  }, [queue, confirmItem]);

  const matchedCount = queue.filter((q) => q.status === "matched").length;
  const confirmedCount = queue.filter((q) => q.status === "confirmed").length;
  const unmatchedCount = queue.filter((q) => q.status === "unmatched" || q.status === "error").length;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title="银行流水批量导入"
        description="上传银行流水文件，自动解析付款单位并匹配发票组合，人工复核后批量核销"
        backHref="/finance/order-receivables"
      />

      {step === "upload" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" />
                上传文件
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
              <p className="text-xs text-muted-foreground">
                支持 CSV、Excel 格式。文件第一行可为表头，系统会尝试自动识别“付款单位/对方户名”“金额/收入”“日期”“备注/摘要”列。
              </p>

              {rawRows.length > 0 && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      id="hasHeader"
                      type="checkbox"
                      checked={hasHeader}
                      onChange={(e) => applyHeaderMode(e.target.checked)}
                    />
                    <Label htmlFor="hasHeader" className="font-normal">第一行是表头</Label>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {( ["payerName", "amount", "date", "remark"] as const ).map((field) => (
                      <div key={field} className="space-y-1">
                        <Label className="text-xs">{FIELD_LABELS[field]}</Label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                          value={mapping[field] ?? ""}
                          onChange={(e) =>
                            setMapping((m) => ({ ...m, [field]: e.target.value === "" ? null : parseInt(e.target.value, 10) }))
                          }
                        >
                          <option value="">-- 选择列 --</option>
                          {displayHeaders.map((h, i) => (
                            <option key={i} value={i}>{h || `列 ${i + 1}`}</option>
                          ))}
                          {displayHeaders.length === 0 && rawRows[0]?.cells.map((_, i) => (
                            <option key={i} value={i}>列 {i + 1}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-2 py-1 text-left">行号</th>
                          {displayHeaders.length > 0
                            ? displayHeaders.map((h, i) => <th key={i} className="px-2 py-1 text-left">{h}</th>)
                            : rawRows[0]?.cells.map((_, i) => <th key={i} className="px-2 py-1 text-left">列 {i + 1}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rawRows.slice(0, 5).map((r) => (
                          <tr key={r.rowIndex} className="border-t">
                            <td className="px-2 py-1 text-muted-foreground">{r.rowIndex}</td>
                            {r.cells.map((c, i) => <td key={i} className="px-2 py-1">{c ?? ""}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {parsedRows.length > 0 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => router.push("/finance/order-receivables")}>取消</Button>
              <Button onClick={runAutoMatch} disabled={processing}>
                {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ArrowRight className="h-4 w-4 mr-1" />}
                自动匹配 ({parsedRows.length} 行)
              </Button>
            </div>
          )}
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="default">已匹配 {matchedCount}</Badge>
              <Badge variant="secondary">已确认 {confirmedCount}</Badge>
              <Badge variant="destructive">待处理 {unmatchedCount}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("upload")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> 重新上传
              </Button>
              {matchedCount > 0 && (
                <Button size="sm" onClick={confirmAllMatched} disabled={processing}>
                  <Check className="h-4 w-4 mr-1" />
                  批量确认 {matchedCount} 行
                </Button>
              )}
            </div>
          </div>

          <FinanceDataTable
            columns={[
              { key: "rowIndex", header: "行号", align: "center" },
              {
                key: "payerName",
                header: "付款单位",
                render: (item) => (
                  <div className="space-y-1">
                    <p>{item.payerName}</p>
                    {item.organizationName && (
                      <p className="text-xs text-muted-foreground">{item.organizationName}</p>
                    )}
                    {item.status === "unmatched" && !item.organizationId && (
                      <ManualOrgPicker
                        onSelect={(org) => {
                          setQueue((prev) =>
                            prev.map((q) =>
                              q.id === item.id
                                ? { ...q, organizationId: org.id, organizationName: org.canonicalName, error: undefined }
                                : q,
                            ),
                          );
                        }}
                      />
                    )}
                  </div>
                ),
              },
              {
                key: "amount",
                header: "金额",
                align: "right",
                render: (item) => <MoneyText value={item.amount} />,
              },
              { key: "date", header: "日期", render: (item) => item.date },
              {
                key: "status",
                header: "状态",
                align: "center",
                render: (item) => <QueueStatusBadge item={item} />,
              },
              {
                key: "match",
                header: "匹配结果",
                render: (item) => <MatchPreview item={item} />,
              },
              {
                key: "actions",
                header: "操作",
                align: "center",
                render: (item) => (
                  <div className="flex items-center justify-center gap-2">
                    {item.status === "matched" && (
                      <Button size="sm" onClick={() => confirmItem(item)} disabled={processing}>
                        确认核销
                      </Button>
                    )}
                    {item.status === "unmatched" && item.organizationId && (
                      <Button size="sm" variant="outline" onClick={() => rerunMatch(item.id, item.organizationId!, item.amount, item.date, setQueue)} disabled={processing}>
                        重新匹配
                      </Button>
                    )}
                    {item.status === "confirmed" && <Check className="h-4 w-4 text-emerald-600" />}
                  </div>
                ),
              },
            ]}
            data={queue}
            keyExtractor={(item) => item.id}
          />
        </div>
      )}

      {step === "done" && (
        <div className="text-center py-12 space-y-4">
          <Check className="h-12 w-12 text-emerald-600 mx-auto" />
          <h2 className="text-xl font-semibold">批量导入完成</h2>
          <p className="text-muted-foreground">已成功确认 {confirmedCount} 笔回款核销。</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={() => router.push("/finance/order-receivables")}>返回回款工作台</Button>
            <Button onClick={() => { setStep("upload"); setQueue([]); setRawSheetRows([]); }}>继续导入</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function QueueStatusBadge({ item }: { item: QueueItem }) {
  const labels: Record<QueueItemStatus, { label: string; variant: string }> = {
    pending: { label: "待处理", variant: "outline" },
    resolving: { label: "解析中", variant: "secondary" },
    matched: { label: "已匹配", variant: "default" },
    unmatched: { label: "未匹配", variant: "destructive" },
    confirming: { label: "确认中", variant: "secondary" },
    confirmed: { label: "已确认", variant: "outline" },
    error: { label: "失败", variant: "destructive" },
  };
  const { label, variant } = labels[item.status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        variant === "default" && "bg-primary text-primary-foreground",
        variant === "secondary" && "bg-secondary text-secondary-foreground",
        variant === "outline" && "border",
        variant === "destructive" && "bg-destructive text-destructive-foreground",
      )}
    >
      {label}
    </span>
  );
}

function MatchPreview({ item }: { item: QueueItem }) {
  if (item.status === "confirmed") return <span className="text-xs text-muted-foreground">已核销</span>;
  if (item.error) return <span className="text-xs text-destructive">{item.error}</span>;
  if (!item.selectedCombination) return <span className="text-xs text-muted-foreground">-</span>;
  const combo = item.selectedCombination;
  return (
    <div className="text-xs space-y-0.5">
      <p className="font-medium">
        <MoneyText value={combo.sum} /> / {combo.count} 张发票
      </p>
      {combo.crossOrder && <p className="text-amber-600">跨订单</p>}
      {item.matchResult?.degraded && <p className="text-amber-600">已降级匹配</p>}
    </div>
  );
}

async function rerunMatch(
  id: string,
  organizationId: string,
  amount: number,
  date: string,
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>,
) {
  setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "resolving", error: undefined } : q)));
  try {
    const res = await fetch("/api/finance/payment-vouchers/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, amount, receivedAt: date }),
    });
    const data: MatchApiResponse = await res.json();
    if (!res.ok || data.status !== "MATCHED" || !data.combinations || data.combinations.length === 0) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === id
            ? { ...q, status: "unmatched", error: data.reason === "SUM_SHORTFALL" ? "候选金额不足" : "无精确匹配组合", matchResult: data }
            : q,
        ),
      );
      return;
    }
    setQueue((prev) =>
      prev.map((q) =>
        q.id === id
          ? { ...q, status: "matched", matchResult: data, selectedCombination: data.combinations![0] }
          : q,
      ),
    );
  } catch {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "error", error: "匹配请求失败" } : q)));
  }
}

function ManualOrgPicker({ onSelect }: { onSelect: (org: OrgOption) => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (!q) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/organizations/list?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data.organizations) ? data.organizations.slice(0, 5) : []);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="mt-1">
      <div className="relative">
        <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
        <Input
          placeholder="搜索机构..."
          className="h-7 pl-7 text-xs"
          value={search}
          onChange={(e) => { setSearch(e.target.value); doSearch(e.target.value); }}
        />
        {loading && <Loader2 className="absolute right-2 top-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      {results.length > 0 && (
        <div className="border rounded-md mt-1 bg-popover">
          {results.map((o) => (
            <button
              key={o.id}
              type="button"
              className="w-full text-left px-2 py-1 text-xs hover:bg-accent"
              onClick={() => { onSelect(o); setResults([]); setSearch(""); }}
            >
              {o.canonicalName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
