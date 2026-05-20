"use client";

import { useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";

const DEFAULT_SOURCE = "OTHER_IMPORT";
const BATCH_SIZE = 20;

const CUSTOMER_MODES = [
  { value: "MATCH_ONLY", label: "仅匹配" },
  { value: "CREATE_IF_MISSING", label: "无匹配时新建" },
  { value: "SKIP", label: "跳过" },
];

const ORG_MODES = [
  { value: "RESOLVE_ONLY", label: "仅解析" },
  { value: "CREATE_IF_MISSING", label: "无匹配时新建" },
  { value: "SKIP", label: "跳过" },
];

export default function OrderImportPage() {
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <Suspense fallback={<div className="text-muted-foreground">加载中...</div>}>
        <ImportContent />
      </Suspense>
    </div>
  );
}

function ImportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [source] = useState(searchParams.get("source") || DEFAULT_SOURCE);
  const [sourceRemark, setSourceRemark] = useState("");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"text" | "file">("text");
  const [customerMode, setCustomerMode] = useState("MATCH_ONLY");
  const [organizationMode, setOrganizationMode] = useState("RESOLVE_ONLY");

  const [step, setStep] = useState<"input" | "preview" | "importing" | "result">("input");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string> | null>(null);

  // Batch import progress state
  const [progress, setProgress] = useState(0);
  const [processedRows, setProcessedRows] = useState(0);
  const [createdCount, setCreatedCount] = useState(0);
  const [updatedCount, setUpdatedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [importErrors, setImportErrors] = useState<Array<{ row: number; externalOrderNo?: string; message: string }>>([]);
  const [currentBatch, setCurrentBatch] = useState(0);
  const cancelRef = useRef(false);
  const [importCancelled, setImportCancelled] = useState(false);

  if (status === "loading") return <div className="text-muted-foreground">加载中...</div>;
  if (status === "unauthenticated") { router.push("/login"); return null; }

  const isFormData = (p: unknown): p is FormData => p instanceof FormData;

  const openFilePicker = () => {
    setMode("file");
    window.requestAnimationFrame(() => {
      const input = fileInputRef.current;
      if (input) {
        input.value = "";
        input.click();
      }
    });
  };

  const handlePreview = async () => {
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      let payload: FormData | Record<string, unknown>;
      if (mode === "file" && file) {
        const form = new FormData();
        form.set("source", source);
        if (sourceRemark) form.set("sourceRemark", sourceRemark);
        form.set("file", file);
        payload = form;
      } else {
        payload = { source: source, rawText };
        if (sourceRemark) (payload as Record<string, unknown>).sourceRemark = sourceRemark;
      }
      const res = await fetch("/api/orders/import/preview", {
        method: "POST",
        ...(isFormData(payload) ? { body: payload } : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      });
      const d = await res.json();
      if (res.ok) { setPreview(d); setStep("preview"); }
      else setError(d.error || "预览失败");
    } catch (e) {
      setError(`请求失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLoading(false); }
  };

  const handleAiNormalize = async () => {
    setAiLoading(true);
    setError("");
    try {
      let payload: FormData | Record<string, unknown>;
      if (mode === "file" && file) {
        const form = new FormData();
        form.set("source", source);
        if (sourceRemark) form.set("sourceRemark", sourceRemark);
        form.set("file", file);
        payload = form;
      } else {
        payload = { source: source, rawText };
        if (sourceRemark) (payload as Record<string, unknown>).sourceRemark = sourceRemark;
      }
      const res = await fetch("/api/orders/import/ai-normalize", {
        method: "POST",
        ...(isFormData(payload) ? { body: payload } : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setAiResult(d);
      } else {
        setError(d.error || "AI 规范化失败");
      }
    } catch (e) {
      setError(`AI 请求失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setAiLoading(false); }
  };

  const handleCommit = async () => {
    // Get full rows from preview response, or fall back to the old single-request path
    const rows = preview?.rows as Array<Record<string, unknown>> | undefined;
    if (!rows || rows.length === 0) {
      setError("预览数据已过期，请返回重新预览");
      return;
    }

    setStep("importing");
    setProgress(0);
    setProcessedRows(0);
    setCreatedCount(0);
    setUpdatedCount(0);
    setSkippedCount(0);
    setImportErrors([]);
    setCurrentBatch(0);
    cancelRef.current = false;

    const batches: Array<Record<string, unknown>>[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      batches.push(rows.slice(i, i + BATCH_SIZE));
    }
    const totalBatches = batches.length;
    const totalRows = rows.length;

    let createdTotal = 0;
    let updatedTotal = 0;
    let skippedTotal = 0;
    const errorsTotal: Array<{ row: number; externalOrderNo?: string; message: string }> = [];

    let cancelled = false;
    for (let i = 0; i < batches.length; i++) {
      if (cancelRef.current) { cancelled = true; break; }

      setCurrentBatch(i + 1);

      try {
        const res = await fetch("/api/orders/import/commit-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source,
            sourceRemark: sourceRemark || undefined,
            rows: batches[i],
            customerMode,
            organizationMode,
            batchIndex: i,
            totalBatches,
          }),
        });

        const d = await res.json();
        if (res.ok) {
          createdTotal += (d.created as number) || 0;
          updatedTotal += (d.updated as number) || 0;
          skippedTotal += (d.skipped as number) || 0;
          const batchErrors = d.errors as Array<{ row: number; externalOrderNo?: string; message: string }> | undefined;
          if (batchErrors?.length) {
            // Offset error row numbers by the batch start position
            const offset = i * BATCH_SIZE;
            for (const e of batchErrors) {
              errorsTotal.push({ ...e, row: e.row + offset });
            }
          }
        } else {
          // Whole batch failed: mark all rows as errors with correct indices
          const batchRows = batches[i];
          for (let j = 0; j < batchRows.length; j++) {
            errorsTotal.push({
              row: i * BATCH_SIZE + j + 1,
              externalOrderNo: batchRows[j].externalOrderNo as string | undefined,
              message: d.error || "批次导入失败",
            });
          }
        }
      } catch (e) {
        const batchRows = batches[i];
        for (let j = 0; j < batchRows.length; j++) {
          errorsTotal.push({
            row: i * BATCH_SIZE + j + 1,
            externalOrderNo: batchRows[j].externalOrderNo as string | undefined,
            message: `网络错误: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }

      setCreatedCount(createdTotal);
      setUpdatedCount(updatedTotal);
      setSkippedCount(skippedTotal);
      setImportErrors([...errorsTotal]);
      const processed = Math.min((i + 1) * BATCH_SIZE, totalRows);
      setProcessedRows(processed);
      setProgress(Math.round((processed / totalRows) * 100));
    }

    setImportCancelled(cancelled);
    setResult({
      created: createdTotal,
      updated: updatedTotal,
      skipped: skippedTotal,
      errors: errorsTotal,
      totalRows,
    });
    setStep("result");
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch("/api/orders/import/template");
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "order-import-template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch { setError("模板下载失败"); }
  };

  const resetForm = () => {
    setStep("input");
    setPreview(null);
    setResult(null);
    setAiResult(null);
    setColumnMapping(null);
    setError("");
    setProgress(0);
    setProcessedRows(0);
    setCreatedCount(0);
    setUpdatedCount(0);
    setSkippedCount(0);
    setImportErrors([]);
    setCurrentBatch(0);
    cancelRef.current = false;
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <Link href="/orders" className="text-sm text-muted-foreground hover:underline">&larr; 返回订单列表</Link>
          <h1 className="text-xl font-bold">导入订单列表</h1>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>下载模板</Button>
      </div>

      {error && <Card className="p-3 text-sm text-red-600 bg-red-50 whitespace-pre-wrap">{error}</Card>}

      {step === "input" && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">来源备注:</span>
            <Input
              className="w-64"
              placeholder="例如：客户转发表格、平台后台导出、合作方提供"
              value={sourceRemark}
              onChange={(e) => setSourceRemark(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">仅作为备注展示，不影响系统去重和导入匹配</span>
          </div>

          <div className="flex gap-2">
            <Button variant={mode === "text" ? "default" : "outline"} size="sm" onClick={() => setMode("text")}>粘贴文本</Button>
            <Button variant={mode === "file" ? "default" : "outline"} size="sm" onClick={openFilePicker}>上传文件</Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,text/csv,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="hidden"
          />

          {mode === "text" ? (
            <textarea className="w-full border rounded p-3 text-sm font-mono h-64" value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="粘贴 CSV/TSV 内容..." />
          ) : (
            <div className="space-y-2">
              <Button type="button" variant="outline" size="sm" onClick={openFilePicker}>重新选择文件</Button>
              {file && <div className="text-sm text-muted-foreground mt-1">已选择: {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">客户:</span>
              <Select value={customerMode} onValueChange={(v) => setCustomerMode(v || "MATCH_ONLY")}>
                <SelectTrigger className="w-28 h-7 text-xs">
                  <span>{CUSTOMER_MODES.find((m) => m.value === customerMode)?.label || customerMode}</span>
                </SelectTrigger>
                <SelectContent>
                  {CUSTOMER_MODES.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">机构:</span>
              <Select value={organizationMode} onValueChange={(v) => setOrganizationMode(v || "RESOLVE_ONLY")}>
                <SelectTrigger className="w-28 h-7 text-xs">
                  <span>{ORG_MODES.find((m) => m.value === organizationMode)?.label || organizationMode}</span>
                </SelectTrigger>
                <SelectContent>
                  {ORG_MODES.map((m) => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handlePreview} disabled={loading || (mode === "text" ? !rawText.trim() : !file)}>
            {loading ? "解析中..." : "预览数据"}
          </Button>
        </Card>
      )}

      {step === "preview" && preview && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">数据预览</h2>
            <div className="flex gap-2">
              {(preview.suggestedMode as string) === "AI_NORMALIZE" && (
                <Badge variant="secondary" className="border-amber-200 text-amber-700">建议 AI 规范化</Badge>
              )}
              {(preview.suggestedMode as string) === "DIRECT" && (
                <Badge variant="secondary" className="border-green-200 text-green-700">可直接导入</Badge>
              )}
            </div>
          </div>

          <div className="text-sm text-muted-foreground grid grid-cols-3 gap-2">
            <div>行数: <span className="font-medium">{preview.rowCount as number}</span></div>
            <div>识别列: <span className="font-medium">{(preview.format as Record<string, unknown>)?.headerHits as number || 0}</span></div>
            <div>解析错误: <span className="font-medium">{preview.errorCount as number}</span></div>
          </div>

          {((preview.previewRows as Array<unknown>)?.length ?? 0) > 0 && (
            <div className="overflow-x-auto border rounded">
              <table className="text-xs w-full">
                <thead className="bg-muted/50">
                  <tr>
                    {Object.keys((preview.previewRows as Array<Record<string, unknown>>)[0] || {}).slice(0, 8).map((k) => (
                      <th key={k} className="px-2 py-1 text-left font-medium whitespace-nowrap">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(preview.previewRows as Array<Record<string, unknown>>).slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t">
                      {Object.values(r).slice(0, 8).map((v, j) => (
                        <td key={j} className="px-2 py-1 whitespace-nowrap">{String(v ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(preview.suggestedMode as string) === "AI_NORMALIZE" && (
            <div className="space-y-2">
              <Button variant="outline" size="sm" onClick={handleAiNormalize} disabled={aiLoading}>
                {aiLoading ? "AI 处理中..." : "AI 规范化表头"}
              </Button>
              {aiResult && (
                <Card className="p-3 bg-muted/30 space-y-2">
                  {(aiResult.needsChunking as boolean) && (
                    <p className="text-xs text-amber-700">
                      该文件列数较多（{aiResult.rawColumns as number} 列），已拆分为 {(aiResult.chunks as Array<unknown>)?.length} 个分块，请逐块发送给 AI 处理后合并。
                    </p>
                  )}
                  {(aiResult.prompt as string) && (
                    <>
                      <p className="text-xs font-medium">将以下 prompt 发送给 AI 获取列映射 JSON：</p>
                      <pre className="text-xs whitespace-pre-wrap max-h-40 overflow-y-auto bg-background rounded p-2">{(aiResult.prompt as string).slice(0, 2000)}{(aiResult.prompt as string).length > 2000 ? "\n...(已截断)" : ""}</pre>
                    </>
                  )}
                  {(aiResult.chunks as Array<Record<string, unknown>>)?.map((chunk, i) => (
                    <details key={i} className="text-xs">
                      <summary className="cursor-pointer font-medium">分块 {i + 1}（{chunk.columns as number} 列）</summary>
                      <pre className="whitespace-pre-wrap max-h-32 overflow-y-auto bg-background rounded p-2 mt-1">{(chunk.prompt as string)?.slice(0, 1500)}{(chunk.prompt as string)?.length > 1500 ? "\n...(已截断)" : ""}</pre>
                    </details>
                  ))}
                  <div className="space-y-1">
                    <p className="text-xs font-medium">粘贴 AI 返回的列映射 JSON：</p>
                    <textarea
                      className="w-full border rounded p-2 text-xs font-mono h-20"
                      placeholder={`{"原始列名": "标准字段名", ...}`}
                      value={columnMapping ? JSON.stringify(columnMapping, null, 2) : ""}
                      onChange={(e) => {
                        try { setColumnMapping(JSON.parse(e.target.value) as Record<string, string>); } catch { /* invalid JSON while typing */ }
                      }}
                    />
                    {columnMapping && (
                      <p className="text-xs text-green-700">已加载 {Object.keys(columnMapping).length} 个列映射</p>
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={resetForm}>返回修改</Button>
            <Button onClick={handleCommit} disabled={loading}>
              {loading ? "导入中..." : `确认导入 (${preview.rowCount} 行)`}
            </Button>
          </div>
        </Card>
      )}

      {step === "importing" && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">正在导入订单</h2>
            <Button variant="outline" size="sm" onClick={() => { cancelRef.current = true; }}>
              取消导入
            </Button>
          </div>

          <Progress value={progress}>
            <ProgressLabel>导入进度</ProgressLabel>
            <ProgressValue>{() => `${progress}%`}</ProgressValue>
          </Progress>

          <div className="text-sm text-muted-foreground grid grid-cols-2 gap-2">
            <div>已处理: <span className="font-medium text-foreground">{processedRows} / {preview?.rowCount as number}</span> 条</div>
            <div>当前批次: <span className="font-medium text-foreground">{currentBatch} / {Math.ceil((preview?.rowCount as number || 1) / BATCH_SIZE)}</span></div>
          </div>

          <div className="text-sm grid grid-cols-4 gap-2">
            <div className="bg-green-50 rounded p-2 text-center">
              <div className="text-xs text-muted-foreground">新增</div>
              <div className="font-bold text-green-700 text-lg">{createdCount}</div>
            </div>
            <div className="bg-blue-50 rounded p-2 text-center">
              <div className="text-xs text-muted-foreground">更新</div>
              <div className="font-bold text-blue-700 text-lg">{updatedCount}</div>
            </div>
            <div className="bg-amber-50 rounded p-2 text-center">
              <div className="text-xs text-muted-foreground">已跳过</div>
              <div className="font-bold text-amber-700 text-lg">{skippedCount}</div>
            </div>
            <div className="bg-red-50 rounded p-2 text-center">
              <div className="text-xs text-muted-foreground">错误</div>
              <div className="font-bold text-red-700 text-lg">{importErrors.length}</div>
            </div>
          </div>

          {importErrors.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">错误明细 ({importErrors.length})</summary>
              <div className="max-h-48 overflow-y-auto space-y-1 mt-2">
                {importErrors.slice(0, 50).map((e, i) => (
                  <div key={i} className="text-red-700 bg-red-50 rounded p-1">
                    #{e.row} {e.externalOrderNo ? `(${e.externalOrderNo})` : ""} — {e.message}
                  </div>
                ))}
                {importErrors.length > 50 && <div className="text-muted-foreground">...还有 {importErrors.length - 50} 条</div>}
              </div>
            </details>
          )}
        </Card>
      )}

      {step === "result" && result && (
        <Card className={`p-4 text-sm space-y-3 border-2 ${importCancelled ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
          <div className={`font-medium text-lg ${importCancelled ? "text-amber-800" : "text-green-800"}`}>
            {importCancelled ? "导入已取消" : "导入完成"}
          </div>
          {importCancelled && (
            <div className="text-sm text-amber-700">
              导入在批次 {currentBatch} / {Math.ceil((preview?.rowCount as number || 1) / BATCH_SIZE)} 时被取消。
              已处理的 {processedRows} 条数据已保存，剩余 {((preview?.rowCount as number) || 0) - processedRows} 条未处理。
            </div>
          )}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-white rounded p-2 text-center border">
              <div className="text-xs text-muted-foreground">总行数</div>
              <div className="font-bold text-lg">{(result.totalRows as number) || 0}</div>
            </div>
            <div className="bg-white rounded p-2 text-center border border-green-200">
              <div className="text-xs text-muted-foreground">新增</div>
              <div className="font-bold text-green-700 text-lg">{(result.created as number) || 0}</div>
            </div>
            <div className="bg-white rounded p-2 text-center border border-blue-200">
              <div className="text-xs text-muted-foreground">更新</div>
              <div className="font-bold text-blue-700 text-lg">{(result.updated as number) || 0}</div>
            </div>
            <div className="bg-white rounded p-2 text-center border border-amber-200">
              <div className="text-xs text-muted-foreground">已跳过</div>
              <div className="font-bold text-amber-700 text-lg">{(result.skipped as number) || 0}</div>
            </div>
          </div>
          {(result.skipped as number) > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded p-2">
              已跳过 {(result.skipped as number)} 条：这些订单的源记录已通过合并操作归属到另一个订单，重导时自动跳过以避免覆盖合并结果。
            </div>
          )}
          {(result.errors as Array<unknown>)?.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-red-700 font-medium">错误: {(result.errors as Array<unknown>).length} 条</summary>
              <div className="max-h-48 overflow-y-auto space-y-1 mt-2">
                {(result.errors as Array<{ row: number; externalOrderNo?: string; message: string }>).slice(0, 20).map((e, i) => (
                  <div key={i} className="text-red-700 bg-red-50 rounded p-1">
                    #{e.row} {e.externalOrderNo ? `(${e.externalOrderNo})` : ""} — {e.message}
                  </div>
                ))}
              </div>
            </details>
          )}
          <Button variant="outline" size="sm" onClick={resetForm}>继续导入</Button>
        </Card>
      )}

      <div className="text-sm text-muted-foreground">
        提示：导入后的订单会自动创建 OrderSourceRecord 和 OrderLine。已存在的订单（按 source+externalOrderNo 匹配）会更新数据。导入前请先预览。
      </div>
    </>
  );
}
