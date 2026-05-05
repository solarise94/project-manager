"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function NewOrderPage() {
  const router = useRouter();
  const { status } = useSession();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("SERVICE");
  const [customerId, setCustomerId] = useState("");
  const [representativeId, setRepresentativeId] = useState("");
  const [totalAmount] = useState("");
  const [orderedAt, setOrderedAt] = useState(new Date().toISOString().slice(0, 10));
  const [projectAction, setProjectAction] = useState("NONE"); // NONE, GENERATE, LINK
  const [projectId, setProjectId] = useState("");
  const [financeTreatment, setFinanceTreatment] = useState("AUTO");
  const [lines, setLines] = useState<{ itemName: string; spec: string; unit: string; quantity: number; unitPrice: number; amount: number }[]>([
    { itemName: "", spec: "", unit: "", quantity: 1, unitPrice: 0, amount: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (status === "loading") return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (status === "unauthenticated") { router.push("/login"); return null; }

  const updateLine = (i: number, field: string, value: unknown) => {
    const updated = [...lines];
    updated[i] = { ...updated[i], [field]: value };
    if (field === "quantity" || field === "unitPrice") {
      updated[i].amount = (updated[i].quantity || 0) * (updated[i].unitPrice || 0);
    }
    setLines(updated);
  };

  const addLine = () => setLines([...lines, { itemName: "", spec: "", unit: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const handleSubmit = async (draft: boolean) => {
    setSubmitting(true);
    setError("");
    try {
      const body = {
        title,
        category,
        status: draft ? "DRAFT" : "CONFIRMED",
        orderedAt: orderedAt ? new Date(orderedAt).toISOString() : null,
        customerId: customerId || null,
        representativeId: representativeId || null,
        projectAction,
        projectId: projectId || null,
        financeTreatment,
        lines: lines.filter(l => l.itemName.trim()),
        totalAmount: totalAmount ? Number(totalAmount) : undefined,
      };
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const d = await res.json();
        router.push(`/orders/${d.order.id}`);
      } else {
        const d = await res.json();
        setError(d.error || "创建失败");
      }
    } catch (e) {
      setError(`提交失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSubmitting(false); }
  };

  const lineTotal = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div><Link href="/orders" className="text-sm text-muted-foreground hover:underline">&larr; 返回</Link><h1 className="text-xl font-bold">新建服务订单</h1></div>
      </div>

      {error && <Card className="p-3 text-sm text-red-600 bg-red-50 border-red-200">{error}</Card>}

      <Card className="p-4 space-y-3">
        <div><label className="text-sm font-medium">订单标题 *</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 单细胞测序服务" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-sm font-medium">分类</label><select className="w-full border rounded px-2 py-1.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}><option value="SERVICE">服务</option><option value="PRODUCT">商品</option><option value="MIXED">混合</option></select></div>
          <div><label className="text-sm font-medium">下单日期</label><Input type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-sm font-medium">客户ID</label><Input value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="可选" /></div>
          <div><label className="text-sm font-medium">代表ID</label><Input value={representativeId} onChange={(e) => setRepresentativeId(e.target.value)} placeholder="可选" /></div>
        </div>
      </Card>

      {/* Lines */}
      <Card className="p-4 space-y-3">
        <div className="flex justify-between items-center"><h3 className="font-medium">订单明细</h3><Button variant="outline" size="sm" onClick={addLine}>+ 添加行</Button></div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-6 gap-2 items-end border-b pb-2">
            <div className="col-span-2"><label className="text-xs text-muted-foreground">名称</label><Input value={l.itemName} onChange={(e) => updateLine(i, "itemName", e.target.value)} placeholder="服务名称" /></div>
            <div><label className="text-xs text-muted-foreground">数量</label><Input type="number" value={l.quantity || ""} onChange={(e) => updateLine(i, "quantity", Number(e.target.value))} /></div>
            <div><label className="text-xs text-muted-foreground">单价</label><Input type="number" value={l.unitPrice || ""} onChange={(e) => updateLine(i, "unitPrice", Number(e.target.value))} /></div>
            <div><label className="text-xs text-muted-foreground">金额</label><div className="text-sm py-1.5 font-medium">¥{l.amount.toLocaleString()}</div></div>
            <div className="flex items-end"><Button variant="outline" size="sm" onClick={() => removeLine(i)} disabled={lines.length <= 1}>×</Button></div>
          </div>
        ))}
        <div className="text-right font-medium">合计: ¥{lineTotal.toLocaleString()}</div>
      </Card>

      {/* Project options */}
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">项目选项</h3>
        <select className="w-full border rounded px-2 py-1.5 text-sm" value={projectAction} onChange={(e) => setProjectAction(e.target.value)}>
          <option value="NONE">仅创建订单</option>
          <option value="GENERATE">创建订单并生成项目</option>
          <option value="LINK">创建订单并绑定已有项目</option>
        </select>
        {projectAction === "LINK" && <Input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="输入项目ID" />}
      </Card>

      {/* Finance */}
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">财务设置</h3>
        <select className="w-full border rounded px-2 py-1.5 text-sm" value={financeTreatment} onChange={(e) => setFinanceTreatment(e.target.value)}>
          <option value="AUTO">自动判断</option><option value="STANDALONE">独立计入</option><option value="PROJECT_INCLUDED">并入项目</option><option value="EXCLUDED">排除</option>
        </select>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitting || !title.trim()}>保存草稿</Button>
        <Button onClick={() => handleSubmit(false)} disabled={submitting || !title.trim()}>确认创建</Button>
      </div>
    </div>
  );
}
