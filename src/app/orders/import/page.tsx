"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

const SOURCES = [
  { value: "PINGOODMICE", label: "拼好鼠" },
  { value: "OTHER_IMPORT", label: "其他导入" },
];

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
  const [source, setSource] = useState(searchParams.get("source") || "PINGOODMICE");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"text" | "file">("text");
  const [customerMode, setCustomerMode] = useState("MATCH_ONLY");
  const [organizationMode, setOrganizationMode] = useState("RESOLVE_ONLY");

  const [step, setStep] = useState<"input" | "preview" | "result">("input");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string> | null>(null);

  if (status === "loading") return <div className="text-muted-foreground">加载中...</div>;
  if (status === "unauthenticated") { router.push("/login"); return null; }

  const isFormData = (p: unknown): p is FormData => p instanceof FormData;

  const handlePreview = async () => {
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      let payload: FormData | Record<string, unknown>;
      if (mode === "file" && file) {
        const form = new FormData();
        form.set("source", source);
        form.set("file", file);
        payload = form;
      } else {
        payload = { source, rawText };
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
        form.set("file", file);
        payload = form;
      } else {
        payload = { source, rawText };
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
    setLoading(true);
    setError("");
    setResult(null);
    try {
      let payload: FormData | Record<string, unknown>;
      if (mode === "file" && file) {
        const form = new FormData();
        form.set("source", source);
        form.set("file", file);
        form.set("customerMode", customerMode);
        form.set("organizationMode", organizationMode);
        if (columnMapping) form.set("columnMapping", JSON.stringify(columnMapping));
        payload = form;
      } else {
        payload = { source, rawText, customerMode, organizationMode };
        if (columnMapping) (payload as Record<string, unknown>).columnMapping = columnMapping;
      }
      const res = await fetch("/api/orders/import/commit", {
        method: "POST",
        ...(isFormData(payload) ? { body: payload } : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      });
      const d = await res.json();
      if (res.ok) { setResult(d); setStep("result"); }
      else setError(d.error || "导入失败");
    } catch (e) {
      setError(`请求失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLoading(false); }
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
            <span className="text-sm text-muted-foreground">来源:</span>
            <Select value={source} onValueChange={(v) => setSource(v || "PINGOODMICE")}>
              <SelectTrigger className="w-32">
                <span>{SOURCES.find((s) => s.value === source)?.label || source}</span>
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button variant={mode === "text" ? "default" : "outline"} size="sm" onClick={() => setMode("text")}>粘贴文本</Button>
            <Button variant={mode === "file" ? "default" : "outline"} size="sm" onClick={() => setMode("file")}>上传文件</Button>
          </div>

          {mode === "text" ? (
            <textarea className="w-full border rounded p-3 text-sm font-mono h-64" value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="粘贴 CSV/TSV 内容..." />
          ) : (
            <div>
              <input type="file" accept=".csv,.txt,.tsv,.xlsx,text/csv,text/plain" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
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

      {step === "result" && result && (
        <Card className="p-3 text-sm space-y-1 bg-green-50 border-green-200">
          <div className="font-medium text-green-800">导入完成</div>
          <div>新增: {(result.created as number) || 0} 条</div>
          <div>更新: {(result.updated as number) || 0} 条</div>
          <div>错误: {(result.errors as Array<unknown>)?.length || 0} 条</div>
          <Button variant="outline" size="sm" className="mt-2" onClick={resetForm}>继续导入</Button>
        </Card>
      )}

      <div className="text-sm text-muted-foreground">
        提示：导入后的订单会自动创建 OrderSourceRecord 和 OrderLine。已存在的订单（按 source+externalOrderNo 匹配）会更新数据。导入前请先预览。
      </div>
    </>
  );
}
