"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const PAGE_SIZE = 20;

const FILTER_OPTIONS: Record<string, { value: string; label: string }[]> = {
  source: [{ value: "", label: "全部来源" }, { value: "MANUAL", label: "手动" }, { value: "PINGOODMICE", label: "拼好鼠" }, { value: "OTHER_IMPORT", label: "其他导入" }],
  status: [{ value: "", label: "全部状态" }, { value: "DRAFT", label: "草稿" }, { value: "CONFIRMED", label: "已确认" }, { value: "CANCELLED", label: "已取消" }, { value: "CLOSED", label: "已关闭" }],
  deliveryStatus: [{ value: "", label: "全部交付" }, { value: "PENDING", label: "未交付" }, { value: "PARTIAL", label: "部分交付" }, { value: "DELIVERED", label: "已交付" }, { value: "WAIVED", label: "无需交付" }],
  category: [{ value: "", label: "全部分类" }, { value: "SERVICE", label: "服务" }, { value: "PRODUCT", label: "商品" }, { value: "MIXED", label: "混合" }, { value: "UNKNOWN", label: "未分类" }],
  customerMatchStatus: [{ value: "", label: "全部匹配" }, { value: "UNMATCHED", label: "未匹配" }, { value: "AUTO_MATCHED", label: "自动匹配" }, { value: "MANUAL_MATCHED", label: "人工匹配" }, { value: "CONFLICT", label: "冲突" }],
  financeTreatment: [{ value: "", label: "全部口径" }, { value: "AUTO", label: "自动" }, { value: "STANDALONE", label: "独立计入" }, { value: "PROJECT_INCLUDED", label: "并入项目" }, { value: "EXCLUDED", label: "排除" }],
};

const BADGE_VARIANT: Record<string, string> = { CONFIRMED: "default", DRAFT: "secondary", CANCELLED: "destructive", CLOSED: "outline", DELIVERED: "default", PENDING: "secondary", PARTIAL: "outline", WAIVED: "outline" };

function FilterSelect({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={(v) => { if (v != null) onChange(v); }}>
      <SelectTrigger className="h-9 text-xs">
        <SelectDisplay label={opts[0].label} valueLabel={opts.find(o => o.value === value)?.label} />
      </SelectTrigger>
      <SelectContent>
        {opts.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
      </SelectContent>
    </Select>
  );
}

function OrdersContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const { status: authStatus } = useSession();

  const [search, setSearch] = useState(sp.get("search") || "");
  const [source, setSource] = useState(sp.get("source") || "");
  const [status, setStatus] = useState(sp.get("status") || "");
  const [deliveryStatus, setDeliveryStatus] = useState(sp.get("deliveryStatus") || "");
  const [category, setCategory] = useState(sp.get("category") || "");
  const [matchStatus, setMatchStatus] = useState(sp.get("customerMatchStatus") || "");
  const [treatment, setTreatment] = useState(sp.get("financeTreatment") || "");
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (source) p.set("source", source);
      if (status) p.set("status", status);
      if (deliveryStatus) p.set("deliveryStatus", deliveryStatus);
      if (category) p.set("category", category);
      if (matchStatus) p.set("customerMatchStatus", matchStatus);
      if (treatment) p.set("financeTreatment", treatment);
      p.set("page", String(page));
      p.set("pageSize", String(PAGE_SIZE));
      const res = await fetch(`/api/orders?${p.toString()}`);
      if (res.ok) {
        const d = await res.json();
        setOrders(d.orders);
        setTotal(d.total);
      }
    } finally { setLoading(false); }
  }, [search, source, status, deliveryStatus, category, matchStatus, treatment, page]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (authStatus === "authenticated") fetchOrders(); }, [authStatus, fetchOrders]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [search, source, status, deliveryStatus, category, matchStatus, treatment]);

  if (authStatus === "loading") return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (authStatus === "unauthenticated") { router.push("/login"); return null; }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const getVariant = (v: string) => (BADGE_VARIANT[v] || "secondary") as "default" | "secondary" | "destructive" | "outline";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">订单管理</h1>
        <div className="flex gap-2">
          <Link href="/orders/new"><Button>新建服务订单</Button></Link>
          <Link href="/orders/import/pingoodmice"><Button variant="outline">拼好鼠导入</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <div className="col-span-2 md:col-span-2 lg:col-span-2">
          <Input placeholder="搜索订单号/客户/电话..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <FilterSelect value={source} onChange={setSource} opts={FILTER_OPTIONS.source} />
        <FilterSelect value={status} onChange={setStatus} opts={FILTER_OPTIONS.status} />
        <FilterSelect value={deliveryStatus} onChange={setDeliveryStatus} opts={FILTER_OPTIONS.deliveryStatus} />
        <FilterSelect value={category} onChange={setCategory} opts={FILTER_OPTIONS.category} />
        <FilterSelect value={matchStatus} onChange={setMatchStatus} opts={FILTER_OPTIONS.customerMatchStatus} />
        <FilterSelect value={treatment} onChange={setTreatment} opts={FILTER_OPTIONS.financeTreatment} />
      </div>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">加载中...</div>
      ) : orders.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">暂无订单</div>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground">
                <th className="p-2">订单号</th><th className="p-2">来源</th><th className="p-2">标题/客户</th><th className="p-2">金额</th><th className="p-2">分类</th><th className="p-2">状态</th><th className="p-2">口径</th><th className="p-2">项目</th>
              </tr></thead>
              <tbody>
                {orders.map((o: Record<string, unknown>) => (
                  <tr key={o.id as string} className="border-b hover:bg-muted/50 cursor-pointer" onClick={() => router.push(`/orders/${o.id}`)}>
                    <td className="p-2 font-mono text-xs">{(o.externalOrderNo as string) || (o.orderNo as string)}</td>
                    <td className="p-2 text-xs">{(o.source as string) === "MANUAL" ? "手动" : (o.source as string) === "PINGOODMICE" ? "拼好鼠" : (o.source as string)}</td>
                    <td className="p-2 max-w-[200px] truncate"><div className="truncate">{o.title as string}</div><div className="text-xs text-muted-foreground">{((o.customer as Record<string, unknown>)?.name as string) || (o.buyerNameSnapshot as string) || "-"}</div></td>
                    <td className="p-2 text-right">¥{((o.financeAmountOverride || o.totalAmount) as number || 0).toLocaleString()}</td>
                    <td className="p-2"><Badge variant="outline" className="text-xs">{o.category as string}</Badge></td>
                    <td className="p-2"><Badge variant={getVariant(o.status as string)} className="text-xs">{(o.status as string)}</Badge></td>
                    <td className="p-2"><Badge variant="outline" className="text-xs">{o.financeTreatment as string}</Badge></td>
                    <td className="p-2 text-xs max-w-[120px] truncate">{(o.projectLinks as Array<Record<string, unknown>>)?.map((l) => (l.project as Record<string, unknown>)?.name).filter(Boolean).join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {orders.map((o: Record<string, unknown>) => (
              <Card key={o.id as string} className="p-3 cursor-pointer" onClick={() => router.push(`/orders/${o.id}`)}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{o.orderNo as string}</span>
                  <Badge variant={getVariant(o.status as string)} className="text-xs">{o.status as string}</Badge>
                </div>
                <div className="text-sm font-medium mt-1 truncate">{o.title as string}</div>
                <div className="text-xs text-muted-foreground truncate">{((o.customer as Record<string, unknown>)?.name as string) || (o.buyerNameSnapshot as string) || "无客户"}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-medium">¥{((o.financeAmountOverride || o.totalAmount) as number || 0).toLocaleString()}</span>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="text-xs">{o.category as string}</Badge>
                    <Badge variant="outline" className="text-xs">{o.deliveryStatus as string}</Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
              <span className="text-sm py-2">{page}/{totalPages} (共{total}条)</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">加载中...</div>}>
      <OrdersContent />
    </Suspense>
  );
}
