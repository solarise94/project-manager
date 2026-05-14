"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Search, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectDisplay,
} from "@/components/ui/select";
import { toast } from "sonner";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { useMediaQuery } from "@/hooks/use-media-query";

const COST_TYPES = [
  { value: "PROCUREMENT", label: "采购成本" },
  { value: "EXPERIMENT", label: "实验成本" },
  { value: "LABOR", label: "人工成本" },
  { value: "LOGISTICS", label: "物流成本" },
  { value: "PLATFORM", label: "平台成本" },
  { value: "MARKETING", label: "市场获客成本" },
  { value: "ENTERTAINMENT", label: "招待成本" },
  { value: "REFUND", label: "退款/冲减" },
  { value: "OTHER", label: "其他" },
];

interface CostItem {
  id: string;
  amount: number;
  costType: string;
  occurredAt: string;
  remark: string | null;
  customer: { id: string; name: string } | null;
  order: { id: string; orderNo: string } | null;
  project: { id: string; name: string } | null;
}

interface OrderOption {
  id: string;
  orderNo: string;
  customer: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  totalAmount: number;
}

export default function CostsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">加载中...</div>}>
      <CostsContent />
    </Suspense>
  );
}

function CostsContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const defaultOrderId = sp.get("orderId") || "";

  if (status === "loading") return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title="成本管理"
        description="订单维度的成本跟踪与记录"
        backHref="/finance"
      />
      <CostForm defaultOrderId={defaultOrderId} />
      <CostList orderId={defaultOrderId} />
    </div>
  );
}

function CostForm({ defaultOrderId }: { defaultOrderId: string }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const isAdmin = session?.user?.role === "ADMIN";
  const [amount, setAmount] = useState("");
  const [costType, setCostType] = useState("OTHER");
  const [remark, setRemark] = useState("");
  const [open, setOpen] = useState(false);

  // Order search state
  const [selectedOrder, setSelectedOrder] = useState<OrderOption | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderSearchOpen, setOrderSearchOpen] = useState(false);

  // Fetch locked order info when coming from order detail
  const { data: lockedOrder } = useQuery<OrderOption>({
    queryKey: ["order", "mini", defaultOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${defaultOrderId}`);
      if (!res.ok) throw new Error("Failed to load order");
      const data = await res.json();
      return {
        id: data.order?.id || data.id,
        orderNo: data.order?.orderNo || data.orderNo,
        customer: data.order?.customer || data.customer,
        project: data.order?.project || data.project,
        totalAmount: data.order?.totalAmount || data.totalAmount || 0,
      };
    },
    enabled: !!defaultOrderId,
  });

  // Search orders
  const { data: searchResults } = useQuery<{ orders: OrderOption[] }>({
    queryKey: ["orders", "search", orderSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ search: orderSearch, pageSize: "10" });
      const res = await fetch(`/api/orders?${params}`);
      if (!res.ok) return { orders: [] };
      const data = await res.json();
      /* eslint-disable @typescript-eslint/no-explicit-any */
      return {
        orders: (data.orders || []).map((o: any) => ({
          id: o.id as string,
          orderNo: (o.orderNo || o.externalOrderNo) as string,
          customer: o.customer as { id: string; name: string } | null,
          project: (o.project || (o.projectLinks?.[0]?.project)) as { id: string; name: string } | null,
          totalAmount: (o.totalAmount || o.paidAmount || 0) as number,
        })),
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    enabled: orderSearch.length >= 2 && !defaultOrderId && orderSearchOpen,
  });

  // Use locked order as the effective order when available
  const effectiveOrder = selectedOrder || lockedOrder || null;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/finance/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          costType,
          customerId: effectiveOrder?.customer?.id || null,
          orderId: effectiveOrder?.id || null,
          projectId: effectiveOrder?.project?.id || null,
          remark: remark || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "创建失败"); }
      return res.json();
    },
    onSuccess: () => {
      toast.success("成本已记录");
      queryClient.invalidateQueries({ queryKey: ["finance", "costs"] });
      setAmount(""); setRemark(""); setCostType("OTHER");
      if (!defaultOrderId) setSelectedOrder(null);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />新增成本</Button>;

  return (
    <Card className="p-4 space-y-4">
      <h3 className="font-medium">新增成本</h3>

      {/* Order context */}
      {defaultOrderId && effectiveOrder ? (
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{effectiveOrder.orderNo}</span>
            {effectiveOrder.customer && <span className="text-muted-foreground">· {effectiveOrder.customer.name}</span>}
            {effectiveOrder.project && <span className="text-muted-foreground">· {effectiveOrder.project.name}</span>}
            <span className="text-muted-foreground ml-auto">
              <MoneyText value={effectiveOrder.totalAmount} compact />
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">关联订单（可选）</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索订单号..."
              className="pl-8"
              value={orderSearch}
              onChange={(e) => { setOrderSearch(e.target.value); setOrderSearchOpen(true); }}
              onFocus={() => setOrderSearchOpen(true)}
            />
            {orderSearchOpen && searchResults && searchResults.orders.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                {searchResults.orders.map((o) => (
                  <button
                    key={o.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between"
                    onClick={() => { setSelectedOrder(o); setOrderSearch(o.orderNo); setOrderSearchOpen(false); }}
                  >
                    <span>{o.orderNo} {o.customer && <span className="text-muted-foreground">· {o.customer.name}</span>}</span>
                    <MoneyText value={o.totalAmount} compact />
                  </button>
                ))}
              </div>
            )}
            {orderSearchOpen && orderSearch.length >= 2 && searchResults && searchResults.orders.length === 0 && (
              <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
                未找到匹配的订单
              </div>
            )}
          </div>
          {selectedOrder && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>已选：{selectedOrder.orderNo}</span>
              {selectedOrder.customer && <span>· {selectedOrder.customer.name}</span>}
              {selectedOrder.project && <span>· {selectedOrder.project.name}</span>}
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setSelectedOrder(null); setOrderSearch(""); }}>清除</Button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium">金额 *</label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="text-sm font-medium">类型</label>
          <Select value={costType} onValueChange={(v) => { if (v) setCostType(v); }}>
            <SelectTrigger><SelectDisplay label="选择类型" valueLabel={COST_TYPES.find(c => c.value === costType)?.label} /></SelectTrigger>
            <SelectContent>{COST_TYPES.map(c => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">备注</label>
        <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="可选" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !amount}>{createMutation.isPending ? "创建中..." : "保存"}</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>取消</Button>
      </div>
    </Card>
  );
}

function CostList({ orderId }: { orderId?: string }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const sp = new URLSearchParams();
  sp.set("page", String(page));
  sp.set("pageSize", "20");
  if (orderId) sp.set("orderId", orderId);

  const { data, isLoading } = useQuery<{ costs: CostItem[]; total: number; totalPages: number }>({
    queryKey: ["finance", "costs", page, orderId],
    queryFn: () => fetch(`/api/finance/costs?${sp.toString()}`).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/finance/costs/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("已删除"); queryClient.invalidateQueries({ queryKey: ["finance", "costs"] }); },
  });

  const costs = data?.costs || [];

  if (isLoading) return <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;

  if (costs.length === 0) {
    return (
      <FinanceEmptyState
        title="暂无成本记录"
        description="点击上方按钮新增成本。建议优先关联订单。"
      />
    );
  }

  return (
    <>
      {isMobile ? (
        <div className="md:hidden space-y-3">
          {costs.map((c) => (
            <FinanceMobileCard
              key={c.id}
              title={
                <MoneyText value={c.amount} tone="expense" />
              }
              badge={<Badge variant="outline">{COST_TYPES.find(t => t.value === c.costType)?.label || c.costType}</Badge>}
              subtitle={
                <div className="space-y-0.5">
                  {c.order && <p>订单：{c.order.orderNo}</p>}
                  {c.customer && <p>客户：{c.customer.name}</p>}
                  <p>{c.occurredAt?.slice(0, 10)}</p>
                </div>
              }
              metrics={[
                { label: "类型", value: COST_TYPES.find(t => t.value === c.costType)?.label || c.costType },
                { label: "日期", value: c.occurredAt?.slice(0, 10) || "-" },
              ]}
              moreActions={
                session?.user?.role === "ADMIN"
                  ? [{
                      label: "删除",
                      onClick: () => { if (confirm("删除此成本记录？")) deleteMutation.mutate(c.id); },
                      destructive: true,
                    }]
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <FinanceDataTable
          columns={[
            { key: "occurredAt", header: "日期", render: (c) => c.occurredAt?.slice(0, 10) || "-" },
            { key: "costType", header: "类型", render: (c) => <Badge variant="outline">{COST_TYPES.find(t => t.value === c.costType)?.label || c.costType}</Badge> },
            { key: "order", header: "订单", render: (c) => c.order?.orderNo || "-" },
            { key: "customer", header: "客户", render: (c) => c.customer?.name || "-" },
            { key: "amount", header: "金额", align: "right", render: (c) => <MoneyText value={c.amount} tone="expense" /> },
            { key: "remark", header: "备注", render: (c) => c.remark || "-" },
            {
              key: "actions",
              header: "操作",
              align: "center",
              render: (c) => session?.user?.role === "ADMIN" ? (
                <Button variant="ghost" size="sm" onClick={() => { if (confirm("删除此成本记录？")) deleteMutation.mutate(c.id); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              ) : null,
            },
          ]}
          data={costs}
          keyExtractor={(c) => c.id}
        />
      )}

      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span className="text-sm py-2">{page}/{data?.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= (data?.totalPages ?? 0)} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}
    </>
  );
}
