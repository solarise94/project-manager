"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function OrderDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { status: authStatus } = useSession();
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authStatus !== "authenticated" || !id) return;
    fetch(`/api/orders/${id}`).then(r => r.ok ? r.json() : null).then(d => { setOrder(d?.order || null); setLoading(false); });
  }, [id, authStatus]);

  if (authStatus === "loading" || loading) return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (authStatus === "unauthenticated") { router.push("/login"); return null; }
  if (!order) return <div className="p-8 text-muted-foreground">订单不存在</div>;

  const badgeVariant = (v: string) => {
    const m: Record<string, string> = { CONFIRMED: "default", DRAFT: "secondary", CANCELLED: "destructive", CLOSED: "outline", DELIVERED: "default", PENDING: "secondary" };
    return (m[v] || "secondary") as "default" | "secondary" | "destructive" | "outline";
  };

  const saveField = async (field: string, value: unknown) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
      if (res.ok) { const d = await res.json(); setOrder(d.order); }
    } finally { setSaving(false); }
  };

  const cust = order.customer as Record<string, unknown> | null;
  const rep = order.representative as Record<string, unknown> | null;
  const lines = (order.lines || []) as Array<Record<string, unknown>>;
  const projectLinks = (order.projectLinks || []) as Array<Record<string, unknown>>;
  const sourceRecords = (order.sourceRecords || []) as Array<Record<string, unknown>>;
  const statusHistory = (order.statusHistory || []) as Array<Record<string, unknown>>;
    const counts = order._count as Record<string, number> | null;
  const effectiveAmount = (order.financeAmountOverride as number) ?? (order.totalAmount as number) ?? 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/orders" className="text-sm text-muted-foreground hover:underline">&larr; 返回订单列表</Link>
          <h1 className="text-xl font-bold mt-1">{order.title as string}</h1>
          <div className="flex gap-2 mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{order.orderNo as string}</span>
            {(order.externalOrderNo as string) ? <span>外部: {order.externalOrderNo as string}</span> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Badge variant={badgeVariant(order.status as string)}>{order.status as string}</Badge>
          <Badge variant={badgeVariant(order.deliveryStatus as string)}>交付: {order.deliveryStatus as string}</Badge>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full overflow-x-auto">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="lines">明细 ({lines.length})</TabsTrigger>
          <TabsTrigger value="customer">客户</TabsTrigger>
          <TabsTrigger value="projects">项目 ({projectLinks.length})</TabsTrigger>
          <TabsTrigger value="finance">财务设置</TabsTrigger>
          <TabsTrigger value="source">来源记录</TabsTrigger>
          <TabsTrigger value="history">操作日志</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3 mt-3">
          <Card className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><span className="text-muted-foreground">来源</span><div>{order.source as string}</div></div>
            <div><span className="text-muted-foreground">分类</span><div><Badge variant="outline">{order.category as string}</Badge></div></div>
            <div><span className="text-muted-foreground">订单金额</span><div className="font-medium">¥{(order.totalAmount as number || 0).toLocaleString()}</div></div>
            <div><span className="text-muted-foreground">有效财务金额</span><div className="font-medium">¥{effectiveAmount.toLocaleString()}</div></div>
            <div><span className="text-muted-foreground">下单日期</span><div>{(order.orderedAt as string)?.slice(0, 10) || "-"}</div></div>
            <div><span className="text-muted-foreground">确认日期</span><div>{(order.confirmedAt as string)?.slice(0, 10) || "-"}</div></div>
            <div><span className="text-muted-foreground">交付日期</span><div>{(order.deliveredAt as string)?.slice(0, 10) || "-"}</div></div>
            <div><span className="text-muted-foreground">计入口径</span><div><Badge variant="outline">{order.financeTreatment as string}</Badge></div></div>
          </Card>
          <Card className="p-4 text-sm space-y-1">
            <div><span className="text-muted-foreground">客户: </span>{cust?.name as string || order.buyerNameSnapshot as string || "未绑定"}</div>
            <div><span className="text-muted-foreground">代表: </span>{rep?.name as string || "-"}</div>
            <div><span className="text-muted-foreground">快照: </span>{[order.buyerNameSnapshot, order.buyerPhoneSnapshot, order.buyerOrgNameSnapshot].filter(Boolean).join(" / ") || "-"}</div>
            <div><span className="text-muted-foreground">地址: </span>{(order.buyerAddressSnapshot as string) || "-"}</div>
            <div><span className="text-muted-foreground">统计: </span>{counts?.lines || 0} 明细, {counts?.receipts || 0} 回款</div>
          </Card>
        </TabsContent>

        <TabsContent value="lines" className="space-y-2 mt-3">
          {lines.length === 0 ? <div className="text-muted-foreground text-sm">暂无明细</div> : lines.map((l: Record<string, unknown>, i: number) => (
            <Card key={i} className="p-3 text-sm flex justify-between items-center">
              <div>
                <div className="font-medium">{l.itemName as string}</div>
                <div className="text-xs text-muted-foreground">{(l.spec as string) ? `${l.spec as string} / ` : ""}×{(l.quantity as number) || 1} {(l.unit as string) || ""}</div>
              </div>
              <div className="text-right font-medium">¥{(l.amount as number || 0).toLocaleString()}</div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="customer" className="space-y-3 mt-3">
          <Card className="p-4 text-sm space-y-2">
            <div><span className="text-muted-foreground">匹配状态: </span><Badge variant="outline">{order.customerMatchStatus as string}</Badge></div>
            {cust ? (
              <>
                <div>客户: <Link href={`/customers?id=${cust.id}`} className="text-primary hover:underline">{cust.name as string} ({cust.customerCode as string})</Link></div>
                <Button variant="outline" size="sm" onClick={() => saveField("customerId", null)} disabled={saving}>解除绑定</Button>
              </>
            ) : (
              <div className="flex gap-2 items-center">
                <Input placeholder="输入客户ID绑定..." className="max-w-[300px]" id="custId" />
                <Button size="sm" onClick={() => { const el = document.getElementById("custId") as HTMLInputElement; if (el?.value) saveField("customerId", el.value); }} disabled={saving}>绑定</Button>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="projects" className="space-y-3 mt-3">
          {projectLinks.length === 0 ? <div className="text-muted-foreground text-sm">暂无关联项目</div> : projectLinks.map((l: Record<string, unknown>) => {
            const prj = l.project as Record<string, unknown>;
            return (
              <Card key={l.id as string} className="p-3 text-sm flex justify-between items-center">
                <div>
                  <div className="font-medium"><Link href={`/projects/${prj?.id}`} className="text-primary hover:underline">{prj?.name as string}</Link></div>
                  <div className="text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs mr-1">{l.relationType as string}</Badge>
                    <Badge variant="outline" className="text-xs">{l.treatment as string}</Badge>
                    {l.allocatedAmount != null ? ` 分摊: ¥${(l.allocatedAmount as number).toLocaleString()}` : ""}
                    {l.isPrimary ? " ★主" : ""}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={async () => { await fetch(`/api/orders/${id}/project-links/${l.id}`, { method: "DELETE" }); router.refresh(); }}>解绑</Button>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="finance" className="space-y-3 mt-3">
          <Card className="p-4 text-sm space-y-2">
            <div className="flex gap-2 items-center">
              <span className="text-muted-foreground w-24">分类:</span>
              <select className="border rounded px-2 py-1 text-sm" value={(order.category as string) || "UNKNOWN"} onChange={(e) => saveField("category", e.target.value)}>
                <option value="UNKNOWN">未分类</option><option value="PRODUCT">商品</option><option value="SERVICE">服务</option><option value="MIXED">混合</option>
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-muted-foreground w-24">计入口径:</span>
              <select className="border rounded px-2 py-1 text-sm" value={(order.financeTreatment as string) || "AUTO"} onChange={(e) => saveField("financeTreatment", e.target.value)}>
                <option value="AUTO">自动</option><option value="STANDALONE">独立计入</option><option value="PROJECT_INCLUDED">并入项目</option><option value="EXCLUDED">排除</option>
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-muted-foreground w-24">金额覆盖:</span>
              <Input className="w-40" type="number" placeholder={String(order.totalAmount || 0)} defaultValue={(order.financeAmountOverride as number) || ""} onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; saveField("financeAmountOverride", v); }} />
            </div>
            {(order.financeNote as string) && <div><span className="text-muted-foreground">备注: </span>{order.financeNote as string}</div>}
            <div className="text-xs text-muted-foreground mt-2">回款、开票操作请前往 <Link href="/finance" className="text-primary hover:underline">财务管理</Link></div>
          </Card>
        </TabsContent>

        <TabsContent value="source" className="space-y-2 mt-3">
          {sourceRecords.length === 0 ? <div className="text-muted-foreground text-sm">暂无来源记录</div> : sourceRecords.map((s: Record<string, unknown>, i: number) => (
            <Card key={i} className="p-3 text-sm">
              <div className="text-xs text-muted-foreground">{s.source as string} / {s.externalOrderNo as string} / {s.duplicateStatus as string}</div>
              <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">查看原始数据</summary><pre className="text-xs mt-1 bg-muted p-2 rounded overflow-x-auto max-h-60">{JSON.stringify(s.rawJson ? JSON.parse(s.rawJson as string) : {}, null, 2)}</pre></details>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="history" className="space-y-2 mt-3">
          {statusHistory.length === 0 ? <div className="text-muted-foreground text-sm">暂无操作记录</div> : statusHistory.map((h: Record<string, unknown>, i: number) => (
            <Card key={i} className="p-3 text-sm flex justify-between">
              <div>
                {h.oldStatus ? <Badge variant="outline" className="text-xs mr-1">{h.oldStatus as string}</Badge> : null}
                {h.oldStatus ? " → " : ""}
                <Badge variant="outline" className="text-xs">{h.newStatus as string}</Badge>
                {h.note ? <span className="text-xs text-muted-foreground ml-2">{h.note as string}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">{(h.createdAt as string)?.slice(0, 16)}</div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
