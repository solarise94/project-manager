"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function PingoodmiceImportPage() {
  const router = useRouter();
  const { status } = useSession();
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"text" | "file">("text");

  if (status === "loading") return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (status === "unauthenticated") { router.push("/login"); return null; }

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      if (mode === "file" && file) {
        const form = new FormData();
        form.set("source", "PINGOODMICE");
        form.set("file", file);
        const res = await fetch("/api/orders/import/pingoodmice", { method: "POST", body: form });
        const d = await res.json();
        if (res.ok) setResult(d); else setError(d.error || "导入失败");
      } else {
        const res = await fetch("/api/orders/import/pingoodmice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "PINGOODMICE", rawText }),
        });
        const d = await res.json();
        if (res.ok) setResult(d); else setError(d.error || "导入失败");
      }
    } catch (e) {
      setError(`请求失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLoading(false); }
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div><Link href="/orders" className="text-sm text-muted-foreground hover:underline">&larr; 返回订单列表</Link><h1 className="text-xl font-bold">拼好鼠订单导入</h1></div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex gap-2">
          <Button variant={mode === "text" ? "default" : "outline"} size="sm" onClick={() => setMode("text")}>粘贴文本</Button>
          <Button variant={mode === "file" ? "default" : "outline"} size="sm" onClick={() => setMode("file")}>上传文件</Button>
        </div>

        {mode === "text" ? (
          <textarea className="w-full border rounded p-3 text-sm font-mono h-64" value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="粘贴拼好鼠CSV内容..." />
        ) : (
          <div>
            <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
            {file && <div className="text-sm text-muted-foreground mt-1">已选择: {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
          </div>
        )}

        <Button onClick={handleSubmit} disabled={loading || (mode === "text" ? !rawText.trim() : !file)}>
          {loading ? "导入中..." : "开始导入"}
        </Button>

        {error && <Card className="p-3 text-sm text-red-600 bg-red-50">{error}</Card>}

        {result && (
          <Card className="p-3 text-sm space-y-1 bg-green-50 border-green-200">
            <div className="font-medium text-green-800">导入完成</div>
            <div>新增: {(result.created as number) || 0} 条</div>
            <div>更新: {(result.updated as number) || 0} 条</div>
            {(result.errors as Array<unknown>)?.length > 0 && <div className="text-red-600">错误: {(result.errors as Array<unknown>).length} 条</div>}
          </Card>
        )}
      </Card>
      <div className="text-sm text-muted-foreground">
        提示：导入后的订单会自动创建 OrderSourceRecord 和 OrderLine。已存在的订单（按 source+externalOrderNo 匹配）会更新数据。
      </div>
    </div>
  );
}
