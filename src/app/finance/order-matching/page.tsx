"use client";

import { useState, useMemo, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Search, Link2, FolderTree, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getOrderEffectiveTreatment } from "@/lib/finance/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderMatchBadge } from "@/components/finance/order-match-badge";
import { CustomerMatchDialog } from "@/components/finance/customer-match-dialog";
import { ProjectBindDialog } from "@/components/finance/project-bind-dialog";
import { InvoiceCard } from "@/components/finance/invoice-card";
import { InvoiceFormDialog, type InvoiceRecord } from "@/components/invoice-form-dialog";
import type { MatchScanResult } from "@/lib/finance/types";
import { useMediaQuery } from "@/hooks/use-media-query";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const TREATMENT_LABELS: Record<string, string> = {
  AUTO: "自动",
  STANDALONE: "独立计入",
  PROJECT_INCLUDED: "已并入项目",
  EXCLUDED: "已排除",
};

interface OrderItem {
  id: string;
  externalOrderNo: string;
  receiverName: string | null;
  receiverPhone: string | null;
  orderUser: string | null;
  receiverAddress: string | null;
  paidAmount: number | null;
  storeName: string | null;
  productNamesRaw: string | null;
  itemCount: number | null;
  invoiceStatus: string;
  duplicateStatus: string;
  mergedIntoId: string | null;
  customerMatchStatus: string;
  customerMatchScore: number | null;
  customerMatchReason: string | null;
  customerId: string | null;
  customer: { id: string; name: string; customerCode: string } | null;
  projectId: string | null;
  project: { id: string; name: string } | null;
  financeCategory: string;
  financeTreatment: string;
  financeAmountOverride: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function computeInvoiceStatus(order: Record<string, any>): string {
  const STATUS_PRIORITY: Record<string, number> = { ISSUED: 4, REQUESTED: 3, DRAFT: 2 };
  let best = "NONE";
  for (const inv of (order.invoiceRequests as any[]) || []) {
    if ((STATUS_PRIORITY[inv.status] || 0) > (STATUS_PRIORITY[best] || 0)) best = inv.status;
  }
  for (const cov of (order.invoiceCoverage as any[]) || []) {
    const s = ((cov as any).invoiceRequest as any)?.status;
    if (s && (STATUS_PRIORITY[s] || 0) > (STATUS_PRIORITY[best] || 0)) best = s;
  }
  return best;
}

function mapOrderToOrderItem(order: Record<string, any>): OrderItem {
  const plinks = (order.projectLinks as any[]) || [];
  const primaryLink = plinks.find((l) => l.isPrimary) || plinks[0];

  return {
    id: order.id as string,
    externalOrderNo: (order.externalOrderNo || order.orderNo) as string,
    receiverName: order.buyerNameSnapshot as string | null,
    receiverPhone: order.buyerPhoneSnapshot as string | null,
    orderUser: order.buyerWechatSnapshot as string | null,
    receiverAddress: order.buyerAddressSnapshot as string | null,
    paidAmount: ((order.financeAmountOverride ?? order.totalAmount) as number) ?? 0,
    storeName: order.buyerOrgNameSnapshot as string | null,
    productNamesRaw: order.title as string | null,
    itemCount: (order._count as any)?.lines ?? null,
    invoiceStatus: computeInvoiceStatus(order),
    duplicateStatus: ((order.sourceRecords as any[])?.[0]?.duplicateStatus as string) || "UNREVIEWED",
    mergedIntoId: ((order.mergeSources as any[])?.[0]?.targetOrderId as string) ?? null,
    customerMatchStatus: order.customerMatchStatus as string,
    customerMatchScore: order.customerMatchScore as number | null,
    customerMatchReason: order.customerMatchReason as string | null,
    customerId: order.customerId as string | null,
    customer: order.customer as OrderItem["customer"],
    projectId: primaryLink?.project?.id ?? null,
    project: primaryLink?.project ?? null,
    financeCategory: order.category as string,
    financeTreatment: order.financeTreatment as string,
    financeAmountOverride: order.financeAmountOverride as number | null,
  };
}

function mapOrderDetailToOrderItem(detail: Record<string, any>): OrderItem {
  const plinks = (detail.projectLinks as any[]) || [];
  const primaryLink = plinks.find((l: any) => l.isPrimary) || plinks[0];

  return {
    id: detail.id as string,
    externalOrderNo: (detail.externalOrderNo || detail.orderNo) as string,
    receiverName: detail.buyerNameSnapshot as string | null,
    receiverPhone: detail.buyerPhoneSnapshot as string | null,
    orderUser: detail.buyerWechatSnapshot as string | null,
    receiverAddress: detail.buyerAddressSnapshot as string | null,
    paidAmount: ((detail.financeAmountOverride ?? detail.totalAmount) as number) ?? 0,
    storeName: detail.buyerOrgNameSnapshot as string | null,
    productNamesRaw: detail.title as string | null,
    itemCount: (detail._count as any)?.lines ?? null,
    invoiceStatus: computeInvoiceStatus(detail),
    duplicateStatus: ((detail.sourceRecords as any[])?.[0]?.duplicateStatus as string) || "UNREVIEWED",
    mergedIntoId: ((detail.mergeSources as any[])?.[0]?.targetOrderId as string) ?? null,
    customerMatchStatus: detail.customerMatchStatus as string,
    customerMatchScore: detail.customerMatchScore as number | null,
    customerMatchReason: detail.customerMatchReason as string | null,
    customerId: detail.customerId as string | null,
    customer: detail.customer as OrderItem["customer"],
    projectId: primaryLink?.project?.id ?? null,
    project: primaryLink?.project ?? null,
    financeCategory: detail.category as string,
    financeTreatment: detail.financeTreatment as string,
    financeAmountOverride: detail.financeAmountOverride as number | null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function OrderMatchingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <OrderMatchingWrapper />
    </Suspense>
  );
}

function OrderMatchingWrapper() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const sp = useSearchParams();

  if (status === "loading") {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return <OrderMatchingContent isAdmin={session.user.role === "ADMIN"} userId={session.user.id} initialSearch={sp.get("search") || ""} />;
}

function OrderMatchingContent({ isAdmin, userId, initialSearch }: { isAdmin: boolean; userId: string; initialSearch: string }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("unmatched");
  const [search, setSearch] = useState(initialSearch);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [matchDialogOrder, setMatchDialogOrder] = useState<OrderItem | null>(null);
  const [projectDialogOrderId, setProjectDialogOrderId] = useState<string | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [mergeInvoiceOpen, setMergeInvoiceOpen] = useState(false);
  const [mergeDefaults, setMergeDefaults] = useState<Record<string, unknown>>({});
  const [mergeCreateUrl, setMergeCreateUrl] = useState("");
  const [mergeCoveredOrderIds, setMergeCoveredOrderIds] = useState<string[]>([]);
  const isMobile = useMediaQuery("(max-width: 768px)");

  function clearSelection() { setSelectedIds(new Set()); }

  function toggleSelectAll() {
    const pageOrders = orders?.orders || [];
    if (pageOrders.every((o) => selectedIds.has(o.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pageOrders.map((o) => o.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function launchMergeInvoice() {
    const selected = (orders?.orders || []).filter((o) => selectedIds.has(o.id));
    if (selected.length < 2) { toast.error("合并开票至少需要选择 2 条订单"); return; }
    const merged = selected.filter((o) => o.duplicateStatus === "MERGED" || o.mergedIntoId);
    if (merged.length > 0) {
      toast.error(`以下订单已合并，无法开票：${merged.map((o) => o.externalOrderNo).join("、")}`);
      return;
    }
    const already = selected.filter((o) => o.invoiceStatus !== "NONE");
    if (already.length > 0) {
      toast.error(`以下订单已有有效开票：${already.map((o) => o.externalOrderNo).join("、")}`);
      return;
    }

    const names = [...new Set(selected.map((o) => o.receiverName).filter(Boolean))];
    const stores = [...new Set(selected.map((o) => o.storeName).filter(Boolean))];
    const products = [...new Set(selected.map((o) => o.productNamesRaw).filter(Boolean))];
    const masterOrder = selected[0];

    setMergeCoveredOrderIds(selected.map((o) => o.id));
    setMergeCreateUrl("/api/finance/order-invoices");
    setMergeDefaults({
      contactName: names.length === 1 ? names[0] : (names[0] || masterOrder.receiverName || ""),
      buyerOrgName: stores.length === 1 ? stores[0] : (stores[0] || ""),
      contentSummary: products.join("、"),
      remark: `合并开票订单：${selected.map((o) => o.externalOrderNo).join("、")}`,
      items: selected.map((o) => ({
        itemName: o.productNamesRaw || o.externalOrderNo,
        spec: "",
        unit: "",
        quantity: String(o.itemCount || 1),
        amount: String(o.paidAmount || 0),
      })),
    });
    setMergeInvoiceOpen(true);
  }

  const { data: orders, isLoading } = useQuery<{ orders: OrderItem[]; total: number }>({
    queryKey: ["orders", "matching", activeTab, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("source", "PINGOODMICE");
      if (search) params.set("search", search);
      params.set("pageSize", "50");
      if (activeTab === "unmatched") params.set("customerMatchStatus", "UNMATCHED");
      else if (activeTab === "matched") params.set("customerMatchStatus", "AUTO_MATCHED");
      else if (activeTab === "conflict") params.set("customerMatchStatus", "CONFLICT");
      else if (activeTab === "manual") params.set("customerMatchStatus", "MANUAL_MATCHED");
      const res = await fetch(`/api/orders?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      return {
        orders: (data.orders || []).map(mapOrderToOrderItem),
        total: data.total,
      };
    },
  });

  const scanMutation = useMutation<MatchScanResult, Error, string[] | undefined>({
    mutationFn: async (orderIds?: string[]) => {
      const res = await fetch("/api/finance/pingoodmice/match-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderIds?.length ? { orderIds } : {}),
      });
      if (!res.ok) throw new Error("Scan failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      clearSelection();
      toast.success(`扫描 ${data.scanned} 条，自动匹配 ${data.matched} 条，冲突 ${data.conflicted} 条，未匹配 ${data.unmatched} 条`);
    },
  });

  const financeMutation = useMutation({
    mutationFn: async ({ orderId, field, value }: { orderId: string; field: string; value: string | null }) => {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("更新失败");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("财务分类已更新");
    },
    onError: () => toast.error("更新失败"),
  });

  const batchCategoryMutation = useMutation({
    mutationFn: async ({ ids, field, value }: { ids: string[]; field: string; value: string }) => {
      await Promise.all(ids.map((id) =>
        fetch(`/api/orders/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      clearSelection();
      toast.success("批量更新完成");
    },
    onError: () => toast.error("批量更新失败"),
  });

  // Order detail + invoices
  const { data: detailData } = useQuery<{
    order: OrderItem;
    invoices: InvoiceRecord[];
  }>({
    queryKey: ["order-detail", detailOrderId],
    queryFn: async () => {
      const [orderRes, invoiceRes] = await Promise.all([
        fetch(`/api/orders/${detailOrderId}`),
        fetch(`/api/finance/order-invoices?orderId=${detailOrderId}`),
      ]);
      const orderData = await orderRes.json();
      const invoiceData = await invoiceRes.json();
      return {
        order: mapOrderDetailToOrderItem(orderData.order || orderData),
        invoices: invoiceData.invoices || [],
      };
    },
    enabled: !!detailOrderId,
  });

  const invalidateDetail = () => {
    queryClient.invalidateQueries({ queryKey: ["order-detail", detailOrderId] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  const invoiceStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/finance/order-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      return data;
    },
    onSuccess: () => { toast.success("状态已更新"); invalidateDetail(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const invoiceRemarkMutation = useMutation({
    mutationFn: async ({ id, remark }: { id: string; remark: string }) => {
      const res = await fetch(`/api/finance/order-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      return data;
    },
    onSuccess: () => { toast.success("备注已更新"); invalidateDetail(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const invoiceConfirmTaxIdMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/finance/order-invoices/${invoiceId}/confirm-tax-id`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失败");
      return data;
    },
    onSuccess: (data: { conflict?: boolean; message?: string }) => {
      if (data.conflict) toast.warning(data.message || "税号冲突");
      else toast.success(data.message || "税号已同步");
      invalidateDetail();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const tabs = useMemo(() => [
    { value: "unmatched", label: "待匹配" },
    { value: "matched", label: "已匹配" },
    { value: "conflict", label: "冲突待确认" },
    { value: "manual", label: "已人工绑定" },
  ], []);

  // Map PATCH field names: financeCategory -> category, financeTreatment -> financeTreatment (same)
  function financeFieldToPatchField(field: string): string {
    if (field === "financeCategory") return "category";
    return field;
  }

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden pb-36">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">拼好鼠订单匹配</h1>
        {isAdmin && (
          <Button onClick={() => scanMutation.mutate(undefined)} disabled={scanMutation.isPending} className="w-full sm:w-auto">
            {scanMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            执行匹配扫描
          </Button>
        )}
      </div>

      <div className="relative max-w-sm min-w-0 w-full">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="搜索订单号/收件人..." className="pl-8 w-full" value={search} onChange={(e) => { setSearch(e.target.value); clearSelection(); }} />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); clearSelection(); }}>
        {isMobile ? (
          <Select value={activeTab} onValueChange={(v) => v && (setActiveTab(v), clearSelection())}>
            <SelectTrigger className="w-full"><SelectDisplay label="状态" valueLabel={tabs.find(t => t.value === activeTab)?.label} placeholder="筛选状态" /></SelectTrigger>
            <SelectContent>
              {tabs.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
            </SelectContent>
          </Select>
        ) : (
          <TabsList>
            {tabs.map((t) => (<TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>))}
          </TabsList>
        )}

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
            <>
              {/* Desktop batch action bar */}
              {isAdmin && selectedIds.size > 0 && (
                <div className="hidden md:flex items-center gap-2 mb-3 p-2 bg-muted/30 rounded-lg flex-wrap">
                  <span className="text-sm font-medium">已选 {selectedIds.size} 项</span>
                  <Button size="sm" onClick={() => scanMutation.mutate(Array.from(selectedIds))} disabled={scanMutation.isPending}>
                    {scanMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                    匹配选中
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => batchCategoryMutation.mutate({ ids: Array.from(selectedIds), field: "category", value: "PRODUCT" })}>
                    设为商品
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => batchCategoryMutation.mutate({ ids: Array.from(selectedIds), field: "category", value: "SERVICE" })}>
                    设为服务
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => batchCategoryMutation.mutate({ ids: Array.from(selectedIds), field: "financeTreatment", value: "EXCLUDED" })}>
                    批量排除
                  </Button>
                  <Button size="sm" onClick={launchMergeInvoice} disabled={selectedIds.size < 2}>
                    <FileText className="h-3 w-3 mr-1" />合并开票 ({selectedIds.size})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection}>取消选择</Button>
                </div>
              )}

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-center py-2 px-1 w-8">
                        <input type="checkbox" className="cursor-pointer" checked={(orders?.orders || []).length > 0 && (orders?.orders || []).every((o) => selectedIds.has(o.id))} onChange={toggleSelectAll} />
                      </th>
                      <th className="text-left py-2 px-2">订单号</th>
                      <th className="text-left py-2 px-2">收件人</th>
                      <th className="text-right py-2 px-2">金额</th>
                      <th className="text-center py-2 px-2">匹配状态</th>
                      {isAdmin && <th className="text-center py-2 px-2">财务分类</th>}
                      <th className="text-center py-2 px-2">计入方式</th>
                      <th className="text-left py-2 px-2">匹配客户</th>
                      <th className="text-center py-2 px-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(orders?.orders || []).map((o) => (
                      <tr key={o.id} className="border-b">
                        <td className="py-2 px-1 text-center">
                          <input type="checkbox" className="cursor-pointer" checked={selectedIds.has(o.id)} onChange={() => toggleOne(o.id)} />
                        </td>
                        <td className="py-2 px-2 font-mono text-xs">{o.externalOrderNo}</td>
                        <td className="py-2 px-2">{o.receiverName || "-"}<br /><span className="text-xs text-muted-foreground">{o.receiverPhone || ""}</span></td>
                        <td className="py-2 px-2 text-right">{(o.paidAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 px-2 text-center">
                          <OrderMatchBadge status={o.customerMatchStatus} />
                          {o.invoiceStatus !== "NONE" && (
                            <Badge variant={o.invoiceStatus === "ISSUED" ? "outline" : "secondary"} className="text-[10px] mt-1">
                              {o.invoiceStatus === "DRAFT" ? "草稿" : o.invoiceStatus === "REQUESTED" ? "已申请" : o.invoiceStatus === "ISSUED" ? "已开票" : o.invoiceStatus}
                            </Badge>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="py-2 px-2 text-center">
                            <Select
                              value={o.financeCategory}
                              onValueChange={(v) => v && financeMutation.mutate({ orderId: o.id, field: financeFieldToPatchField("financeCategory"), value: v })}
                            >
                              <SelectTrigger className="h-7 text-xs w-24">
                                <SelectDisplay label="分类" valueLabel={o.financeCategory === "UNKNOWN" ? "未分类" : o.financeCategory === "PRODUCT" ? "商品" : "服务"} placeholder="分类" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="UNKNOWN">未分类</SelectItem>
                                <SelectItem value="PRODUCT">商品</SelectItem>
                                <SelectItem value="SERVICE">服务</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                        )}
                        <td className="py-2 px-2 text-center">
                          <Badge variant="secondary" className="text-xs shrink-0 whitespace-nowrap">
                            {TREATMENT_LABELS[getOrderEffectiveTreatment(o)] || getOrderEffectiveTreatment(o)}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          {o.customer ? `${o.customer.name} (${o.customer.customerCode})` : "-"}
                          {o.project && <div className="text-xs text-muted-foreground">项目: {o.project.name}</div>}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {isAdmin ? (
                            <div className="flex gap-1 justify-center">
                              <Button size="sm" variant="outline" onClick={() => setMatchDialogOrder(o)}>
                                <Link2 className="h-3 w-3 mr-1" />客户
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setProjectDialogOrderId(o.id)}>
                                <FolderTree className="h-3 w-3 mr-1" />项目
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setDetailOrderId(o.id)}>
                                <FileText className="h-3 w-3 mr-1" />开票
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">仅查看</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {(orders?.orders || []).map((o) => {
                  const treatment = getOrderEffectiveTreatment(o);
                  return (
                    <Card key={o.id} className="relative">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {isAdmin && (
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 shrink-0"
                              checked={selectedIds.has(o.id)}
                              onChange={() => toggleOne(o.id)}
                            />
                          )}
                          <span className="font-mono text-xs truncate">{o.externalOrderNo}</span>
                          <div className="ml-auto shrink-0 flex flex-col items-end gap-0.5">
                            <OrderMatchBadge status={o.customerMatchStatus} />
                            {o.invoiceStatus !== "NONE" && (
                              <Badge variant={o.invoiceStatus === "ISSUED" ? "outline" : "secondary"} className="text-[10px]">
                                {o.invoiceStatus === "DRAFT" ? "草稿" : o.invoiceStatus === "REQUESTED" ? "已申请" : o.invoiceStatus === "ISSUED" ? "已开票" : o.invoiceStatus}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{o.receiverName || "未知收件人"}</p>
                            <p className="text-xs text-muted-foreground">{o.receiverPhone || ""}</p>
                          </div>
                          <span className="text-sm font-medium shrink-0">{(o.paidAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground shrink-0">财务：</span>
                          {isAdmin ? (
                            <Select
                              value={o.financeCategory}
                              onValueChange={(v) => v && financeMutation.mutate({ orderId: o.id, field: financeFieldToPatchField("financeCategory"), value: v })}
                            >
                              <SelectTrigger className="h-7 text-xs w-24">
                                <SelectDisplay label="分类" valueLabel={o.financeCategory === "UNKNOWN" ? "未分类" : o.financeCategory === "PRODUCT" ? "商品" : "服务"} placeholder="分类" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="UNKNOWN">未分类</SelectItem>
                                <SelectItem value="PRODUCT">商品</SelectItem>
                                <SelectItem value="SERVICE">服务</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline" className="text-xs shrink-0 whitespace-nowrap">
                              {o.financeCategory === "UNKNOWN" ? "未分类" : o.financeCategory === "PRODUCT" ? "商品" : "服务"}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-xs shrink-0 whitespace-nowrap">
                            {TREATMENT_LABELS[treatment] || treatment}
                          </Badge>
                        </div>

                        <div className="space-y-1">
                          <p className="text-xs text-primary truncate">
                            客户：{o.customer ? `${o.customer.name} (${o.customer.customerCode})` : "未绑定"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            项目：{o.project ? o.project.name : "未关联"}
                          </p>
                        </div>

                        {isAdmin && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => setMatchDialogOrder(o)}>
                              <Link2 className="h-3 w-3 mr-1" />绑定客户
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => setProjectDialogOrderId(o.id)}>
                              <FolderTree className="h-3 w-3 mr-1" />关联项目
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => setDetailOrderId(o.id)}>
                              <FileText className="h-3 w-3 mr-1" />开票
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {matchDialogOrder && (
        <CustomerMatchDialog
          open={!!matchDialogOrder}
          onOpenChange={(open) => { if (!open) setMatchDialogOrder(null); }}
          orderId={matchDialogOrder.id}
          userId={userId}
          orderPrefill={{
            receiverName: matchDialogOrder.receiverName,
            receiverPhone: matchDialogOrder.receiverPhone,
            orderUser: matchDialogOrder.orderUser,
            receiverAddress: matchDialogOrder.receiverAddress,
            storeName: matchDialogOrder.storeName,
          }}
          onBound={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
        />
      )}

      {projectDialogOrderId && (
        <ProjectBindDialog
          open={!!projectDialogOrderId}
          onOpenChange={(open) => { if (!open) setProjectDialogOrderId(null); }}
          orderId={projectDialogOrderId}
          onBound={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
        />
      )}

      {/* Order Detail Dialog with Invoice Management */}
      <Dialog open={!!detailOrderId} onOpenChange={(o) => { if (!o) setDetailOrderId(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailOrderId && detailData?.order && (
            <>
              <DialogHeader>
                <DialogTitle>订单详情</DialogTitle>
              </DialogHeader>

              {/* Order info */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div><span className="text-muted-foreground">订单号：</span>{detailData.order.externalOrderNo}</div>
                {detailData.order.receiverName && <div><span className="text-muted-foreground">收件人：</span>{detailData.order.receiverName}</div>}
                {detailData.order.receiverPhone && <div><span className="text-muted-foreground">电话：</span>{detailData.order.receiverPhone}</div>}
                {detailData.order.paidAmount != null && <div><span className="text-muted-foreground">金额：</span>¥{detailData.order.paidAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</div>}
                {detailData.order.customer && <div><span className="text-muted-foreground">客户：</span>{detailData.order.customer.name}</div>}
                {detailData.order.project && <div><span className="text-muted-foreground">项目：</span>{detailData.order.project.name}</div>}
              </div>

              {/* Invoice Section */}
              <div className="border-t pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">开票申请</h4>
                  {isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingInvoice(null); setInvoiceOpen(true); }}>
                      新建开票申请
                    </Button>
                  )}
                </div>
                {(detailData.invoices || []).length === 0 ? (
                  <div className="text-center py-3 text-xs text-muted-foreground">暂无开票申请</div>
                ) : (
                  <div className="space-y-2">
                    {(detailData.invoices || []).map((inv) => (
                      <InvoiceCard
                        key={inv.id}
                        inv={inv}
                        readOnly={!isAdmin}
                        callbacks={isAdmin ? {
                          onEdit: (inv) => { setEditingInvoice(inv); setInvoiceOpen(true); },
                          onStatusChange: (id, status) => invoiceStatusMutation.mutate({ id, status }),
                          onRemarkSave: async (id, remark) => { invoiceRemarkMutation.mutate({ id, remark }); },
                          onConfirmTaxId: (id) => invoiceConfirmTaxIdMutation.mutate(id),
                          confirmTaxIdPending: invoiceConfirmTaxIdMutation.isPending,
                        } : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Invoice Form Dialog */}
              {isAdmin && (
                <InvoiceFormDialog
                  open={invoiceOpen}
                  onOpenChange={setInvoiceOpen}
                  editingInvoice={editingInvoice}
                  createUrl="/api/finance/order-invoices"
                  patchUrlPrefix="/api/finance/order-invoices"
                  onSuccess={invalidateDetail}
                  showProjectCode={false}
                  aiDraftUrl={null}
                  extraPayload={{ orderId: detailOrderId }}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Merge Invoice Form Dialog */}
      {isAdmin && mergeCreateUrl && (
        <InvoiceFormDialog
          open={mergeInvoiceOpen}
          onOpenChange={(v) => { setMergeInvoiceOpen(v); if (!v) { setMergeCreateUrl(""); setMergeCoveredOrderIds([]); } }}
          editingInvoice={null}
          createUrl={mergeCreateUrl}
          patchUrlPrefix="/api/finance/order-invoices"
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["orders"] });
            clearSelection();
          }}
          defaultValues={mergeDefaults as Record<string, unknown> & { contactName?: string; contentSummary?: string; remark?: string; items?: Array<{ itemName: string; spec: string; unit: string; quantity: string; amount: string }>; buyerOrgName?: string; buyerOrgId?: string; buyerTaxId?: string; invoiceType?: string; projectCode?: string }}
          showProjectCode={false}
          aiDraftUrl={null}
          extraPayload={{ orderId: mergeCoveredOrderIds[0], coveredOrderIds: mergeCoveredOrderIds }}
        />
      )}

      {/* Mobile sticky batch action bar */}
      {isMobile && isAdmin && selectedIds.size > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-50 bg-background border-t px-4 py-3 space-y-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">已选 {selectedIds.size}</span>
            <Button size="sm" variant="ghost" onClick={clearSelection}>取消</Button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Button size="sm" onClick={() => scanMutation.mutate(Array.from(selectedIds))} disabled={scanMutation.isPending}>
              {scanMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              匹配
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchCategoryMutation.mutate({ ids: Array.from(selectedIds), field: "category", value: "PRODUCT" })}>
              设商品
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchCategoryMutation.mutate({ ids: Array.from(selectedIds), field: "category", value: "SERVICE" })}>
              设服务
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchCategoryMutation.mutate({ ids: Array.from(selectedIds), field: "financeTreatment", value: "EXCLUDED" })}>
              排除
            </Button>
            <Button size="sm" onClick={launchMergeInvoice} disabled={selectedIds.size < 2}>
              <FileText className="h-3 w-3 mr-1" />合并开票 ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
