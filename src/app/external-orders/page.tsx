"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Search, Upload, ClipboardCopy, UserPlus, ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import { toast } from "sonner";
import { getFeishuProjectHeader, externalOrderToFeishuRow, externalOrdersToFeishuText } from "@/lib/feishu-export";
import Link from "next/link";

interface ExternalOrder {
  id: string;
  source: string;
  platform: string | null;
  externalOrderNo: string;
  merchantOrderNo: string | null;
  storeName: string | null;
  productNamesRaw: string | null;
  productNamesJson: string | null;
  itemCount: number | null;
  orderAt: string | null;
  paidAt: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  grossAmount: number | null;
  paidAmount: number | null;
  shippingFee: number | null;
  priceAdjustment: number | null;
  orderUser: string | null;
  orderUserTags: string | null;
  sellerMessage: string | null;
  merchantRemark: string | null;
  formNote: string | null;
  scheduledDeliveryText: string | null;
  orderType: string | null;
  invoiceStatus: string;
  duplicateStatus: string;
  duplicateGroupId: string | null;
  mergedIntoId: string | null;
  reviewNote: string | null;
  rawJson: string | null;
  customerId: string | null;
  customer?: { id: string; name: string; customerCode: string } | null;
  createdAt: string;
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  ALL: "全部状态", NONE: "未开票", DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票",
};
const INVOICE_STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  NONE: "outline", DRAFT: "secondary", REQUESTED: "default", ISSUED: "outline",
};
const DEDUP_STATUS_LABELS: Record<string, string> = {
  ALL: "全部", UNREVIEWED: "待审查", UNIQUE: "唯一", DUPLICATE: "已确认重复", MERGED: "已合并", IGNORED: "已忽略",
};
const DEDUP_STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  UNREVIEWED: "default", DUPLICATE: "destructive", UNIQUE: "secondary", MERGED: "outline", IGNORED: "outline",
};

function formatAmount(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ExternalOrdersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("ALL");
  const [duplicateStatusFilter, setDuplicateStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const isMobile = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedOrderIds(new Set());
  }, [page, debouncedSearch, invoiceStatusFilter, duplicateStatusFilter]);

  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState("微信小商店");
  const [importText, setImportText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [detailOrder, setDetailOrder] = useState<ExternalOrder | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  }, []);

  const { data: listData, isLoading } = useQuery<{ orders: ExternalOrder[]; total: number }>({
    queryKey: ["external-orders", debouncedSearch, invoiceStatusFilter, duplicateStatusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (invoiceStatusFilter !== "ALL") params.set("invoiceStatus", invoiceStatusFilter);
      if (duplicateStatusFilter !== "ALL") params.set("duplicateStatus", duplicateStatusFilter);
      const res = await fetch(`/api/external-orders?${params}`);
      if (!res.ok) throw new Error("加载失败");
      return res.json();
    },
  });
  const orders = listData?.orders || [];
  const total = listData?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const importMutation = useMutation({
    mutationFn: async () => {
      let res: Response;
      if (importFile) {
        const form = new FormData();
        form.append("source", importSource);
        form.append("file", importFile);
        res = await fetch("/api/external-orders/import", { method: "POST", body: form });
      } else {
        res = await fetch("/api/external-orders/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: importSource, rawText: importText }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");
      return data;
    },
    onSuccess: (data) => {
      const fmt = data.format ? `（${data.format.detected.toUpperCase()}，识别 ${data.format.headerHits}/${data.format.headerTotal} 列）` : "";
      toast.success(`导入完成：新增 ${data.created}，更新 ${data.updated} ${fmt}`);
      if (data.errors?.length > 0) {
        toast.warning(`${data.errors.length} 行解析失败：${data.errors[0].message}`);
      }
      setImportOpen(false);
      setImportText("");
      setImportFile(null);
      queryClient.invalidateQueries({ queryKey: ["external-orders"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Detail + duplicate group
  const { data: detailData } = useQuery<{
    order: ExternalOrder & { reviewedBy?: { id: string; name: string } | null; mergedInto?: { id: string; externalOrderNo: string; source: string } | null };
    duplicateGroup: Array<{ id: string; externalOrderNo: string; source: string; platform: string | null; receiverName: string | null; receiverPhone: string | null; paidAmount: number | null; orderAt: string | null; productNamesRaw: string | null; duplicateStatus: string }>;
  }>({
    queryKey: ["external-order-detail", detailOrder?.id],
    queryFn: async () => {
      const res = await fetch(`/api/external-orders/${detailOrder!.id}`);
      if (!res.ok) throw new Error("加载失败");
      return res.json();
    },
    enabled: !!detailOrder,
  });
  const duplicateGroup = detailData?.duplicateGroup || [];
  const detailOrderData = (detailData?.order ?? detailOrder) as ExternalOrder;
  const detailReviewedBy = detailData?.order?.reviewedBy;
  const detailMergedInto = detailData?.order?.mergedInto;

  const invalidateDetail = useCallback(() => {
    if (detailOrder) {
      queryClient.invalidateQueries({ queryKey: ["external-order-detail", detailOrder.id] });
      queryClient.invalidateQueries({ queryKey: ["external-orders"] });
    }
  }, [queryClient, detailOrder]);

  const dedupMutation = useMutation({
    mutationFn: async ({ id, duplicateStatus, reviewNote }: { id: string; duplicateStatus: string; reviewNote?: string }) => {
      const res = await fetch(`/api/external-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateStatus, reviewNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      return data;
    },
    onSuccess: () => { toast.success("去重状态已更新"); invalidateDetail(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ sourceId, masterId }: { sourceId: string; masterId: string }) => {
      const res = await fetch(`/api/external-orders/${sourceId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masterId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "合并失败");
      return data;
    },
    onSuccess: () => { toast.success("合并完成"); invalidateDetail(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const scanDuplicatesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/external-orders/duplicates?scan=1");
      if (!res.ok) throw new Error("扫描失败");
      return res.json();
    },
    onSuccess: (data: { groups: Array<{ orders: Array<unknown> }> }) => {
      toast.success(`扫描完成，发现 ${data.groups.length} 个疑似重复组`);
      queryClient.invalidateQueries({ queryKey: ["external-orders"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [dedupReviewNote, setDedupReviewNote] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);

  // Batch selection helpers
  const toggleOrderSelect = useCallback((id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectableIds = orders.map((o) => o.id).join(",");
  const toggleSelectAllOrders = useCallback(() => {
    if (orders.length === 0) return;
    const allSelected = orders.every((o) => selectedOrderIds.has(o.id));
    setSelectedOrderIds(allSelected ? new Set() : new Set(orders.map((o) => o.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectableIds, selectedOrderIds]);

  const batchDeleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/external-orders/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedOrderIds] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      return data as { deleted: number; skipped: Array<{ id: string; reason: string }> };
    },
    onSuccess: (data) => {
      toast.success(`已删除 ${data.deleted} 条`);
      if (data.skipped.length > 0) {
        data.skipped.slice(0, 3).forEach((s) => toast.warning(`${s.id.slice(-6)}: ${s.reason}`));
      }
      setSelectedOrderIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["external-orders"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className={cn("space-y-4", isMobile && "pb-32")}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">拼好鼠订单</h1>
        <div className="flex items-center gap-2">
          <Link href="/finance/order-matching">
            <Button size="sm" variant="outline">
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> 财务匹配与开票
            </Button>
          </Link>
          <Button size="sm" variant="outline" disabled={scanDuplicatesMutation.isPending} onClick={() => scanDuplicatesMutation.mutate()}>
            {scanDuplicatesMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            扫描重复
          </Button>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-1 h-3.5 w-3.5" /> 导入订单
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索订单号、收件人、电话、商品、地址..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={invoiceStatusFilter} onValueChange={(v) => { if (v) { setInvoiceStatusFilter(v); setPage(1); } }}>
          <SelectTrigger className="w-32 h-9"><SelectDisplay label="开票" valueLabel={INVOICE_STATUS_LABELS[invoiceStatusFilter] || "未知"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            <SelectItem value="NONE">未开票</SelectItem>
            <SelectItem value="DRAFT">草稿</SelectItem>
            <SelectItem value="REQUESTED">已申请</SelectItem>
            <SelectItem value="ISSUED">已开票</SelectItem>
          </SelectContent>
        </Select>
        <Select value={duplicateStatusFilter} onValueChange={(v) => { if (v) { setDuplicateStatusFilter(v); setPage(1); } }}>
          <SelectTrigger className="w-32 h-9"><SelectDisplay label="去重" valueLabel={DEDUP_STATUS_LABELS[duplicateStatusFilter] || "未知"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部</SelectItem>
            <SelectItem value="UNREVIEWED">待审查</SelectItem>
            <SelectItem value="DUPLICATE">已确认重复</SelectItem>
            <SelectItem value="UNIQUE">唯一</SelectItem>
            <SelectItem value="MERGED">已合并</SelectItem>
            <SelectItem value="IGNORED">已忽略</SelectItem>
          </SelectContent>
        </Select>
        {orders.length > 0 && (
          <>
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none h-9">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-gray-300"
                checked={orders.length > 0 && orders.every((o) => selectedOrderIds.has(o.id))}
                onChange={toggleSelectAllOrders}
              />
              全选本页
            </label>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={async () => {
                try {
                  if (selectedOrderIds.size > 0) {
                    const selected = orders.filter((o) => selectedOrderIds.has(o.id));
                    const text = getFeishuProjectHeader() + "\n" + externalOrdersToFeishuText(selected);
                    await navigator.clipboard.writeText(text);
                    toast.success(`已复制 ${selected.length} 条订单到剪贴板`);
                  } else {
                    const params = new URLSearchParams({ exportAll: "1" });
                    if (debouncedSearch) params.set("search", debouncedSearch);
                    if (invoiceStatusFilter !== "ALL") params.set("invoiceStatus", invoiceStatusFilter);
                    const res = await fetch(`/api/external-orders?${params}`);
                    if (!res.ok) throw new Error("fetch failed");
                    const data = await res.json();
                    const allOrders: ExternalOrder[] = data.orders || [];
                    if (allOrders.length === 0) { toast.error("没有可导出的订单"); return; }
                    const text = getFeishuProjectHeader() + "\n" + externalOrdersToFeishuText(allOrders);
                    await navigator.clipboard.writeText(text);
                    toast.success(`已复制 ${allOrders.length} 条订单到剪贴板`);
                  }
                } catch {
                  toast.error("导出失败");
                }
              }}
            >
              <ClipboardCopy className="mr-1 h-3.5 w-3.5" />
              {selectedOrderIds.size > 0 ? `导出已选 ${selectedOrderIds.size} 条` : `导出飞书（全部${total > pageSize ? ` ${total}条` : ""})`}
            </Button>
            {selectedOrderIds.size > 0 && !isMobile && (
              <Button
                variant="destructive"
                size="sm"
                className="h-9"
                disabled={batchDeleteMutation.isPending}
                onClick={() => {
                  if (!confirm(`确认删除选中的 ${selectedOrderIds.size} 条拼好鼠订单？此操作不可恢复。`)) return;
                  batchDeleteMutation.mutate();
                }}
              >
                {batchDeleteMutation.isPending ? "删除中..." : `删除已选 (${selectedOrderIds.size})`}
              </Button>
            )}
          </>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : orders.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">暂无订单数据</div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <Card key={order.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setDetailOrder(order)}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 shrink-0"
                      checked={selectedOrderIds.has(order.id)}
                      onChange={() => toggleOrderSelect(order.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-sm font-mono">{order.externalOrderNo}</span>
                    <Badge variant={INVOICE_STATUS_VARIANTS[order.invoiceStatus] || "outline"} className="text-[10px] shrink-0">
                      {INVOICE_STATUS_LABELS[order.invoiceStatus] || order.invoiceStatus}
                    </Badge>
                    {order.duplicateGroupId && order.duplicateStatus === "UNREVIEWED" && (
                      <Badge variant="default" className="text-[10px] shrink-0 bg-amber-100 text-amber-700 hover:bg-amber-100">疑似重复</Badge>
                    )}
                    {order.duplicateStatus === "DUPLICATE" && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">已确认重复</Badge>
                    )}
                    {order.duplicateStatus === "MERGED" && (
                      <Badge variant="outline" className="text-[10px] shrink-0">已合并</Badge>
                    )}
                    {order.customerId && order.customer && (
                      <Badge variant="outline" className="text-[10px] shrink-0 bg-green-50 text-green-700 border-green-200">已绑定：{order.customer.name}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-sm">
                    {order.paidAmount != null && <span className="font-medium">¥{formatAmount(order.paidAmount)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {order.receiverName && <span>{order.receiverName}</span>}
                  {order.receiverPhone && <span>{order.receiverPhone}</span>}
                  {order.productNamesRaw && <span className="truncate max-w-[200px]">{order.productNamesRaw}</span>}
                  {order.orderAt && <span>{new Date(order.orderAt).toLocaleDateString("zh-CN")}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) { setImportFile(null); setImportText(""); setFileInputKey((k) => k + 1); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>导入拼好鼠订单</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">来源</label>
              <Input value={importSource} onChange={(e) => setImportSource(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">上传文件（推荐）</label>
              <Input
                key={fileInputKey}
                type="file" accept=".csv,.tsv,.txt"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="h-9 text-sm"
              />
              {importFile && (
                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-muted-foreground">{importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)</p>
                  <Button type="button" size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => { setImportFile(null); setFileInputKey((k) => k + 1); }}>清除</Button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">或粘贴 TSV/CSV 数据（含表头行）</label>
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="从微信小商店等平台导出的订单数据，直接粘贴即可（支持 TSV 和 CSV 格式）"
                rows={8} className="text-xs font-mono resize-none"
                disabled={!!importFile}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>取消</Button>
              <Button size="sm" disabled={(!importText.trim() && !importFile) || importMutation.isPending} onClick={() => importMutation.mutate()}>
                {importMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                导入
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailOrder} onOpenChange={(o) => { if (!o) setDetailOrder(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailOrder && (
            <>
              <DialogHeader><DialogTitle>订单详情</DialogTitle></DialogHeader>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const text = externalOrderToFeishuRow(detailOrder);
                    navigator.clipboard.writeText(text).then(
                      () => toast.success("已复制到剪贴板，可直接粘贴到飞书"),
                      () => toast.error("复制失败"),
                    );
                  }}
                >
                  <ClipboardCopy className="mr-1 h-3 w-3" />
                  复制到飞书
                </Button>
              </div>
              <OrderDetail order={detailOrder} />

              {/* Customer Binding */}
              <CustomerBindSection order={detailOrderData} />

              {/* Dedup Review Panel */}
              {(duplicateGroup.length > 0 || detailOrderData.duplicateGroupId || detailOrderData.mergedIntoId || detailMergedInto) && (
                <div className="border-t pt-3 space-y-2">
                  <h4 className="text-sm font-medium">去重审查</h4>
                  <div className="flex items-center gap-2">
                    <Badge variant={DEDUP_STATUS_VARIANTS[detailOrderData.duplicateStatus] || "outline"} className="text-[10px]">
                      {DEDUP_STATUS_LABELS[detailOrderData.duplicateStatus] || detailOrderData.duplicateStatus}
                    </Badge>
                    {detailReviewedBy && (
                      <span className="text-xs text-muted-foreground">审查人：{detailReviewedBy.name}</span>
                    )}
                    {detailMergedInto && (
                      <span className="text-xs text-muted-foreground">
                        已合并到：{detailMergedInto.externalOrderNo}（{detailMergedInto.source}）
                      </span>
                    )}
                  </div>

                  {duplicateGroup.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">疑似重复订单：</p>
                      {duplicateGroup.map((dup) => (
                        <div key={dup.id} className="flex items-center gap-2 text-xs p-2 bg-muted/50 rounded">
                          <span className="font-mono">{dup.externalOrderNo}</span>
                          <span className="text-muted-foreground">{dup.source}</span>
                          {dup.receiverName && <span className="text-muted-foreground">{dup.receiverName}</span>}
                          {dup.paidAmount != null && <span>¥{formatAmount(dup.paidAmount)}</span>}
                          {dup.duplicateStatus !== "UNREVIEWED" && (
                            <Badge variant={DEDUP_STATUS_VARIANTS[dup.duplicateStatus] || "outline"} className="text-[10px]">
                              {DEDUP_STATUS_LABELS[dup.duplicateStatus]}
                            </Badge>
                          )}
                          {mergeTargetId === dup.id ? (
                            <span className="text-amber-600 text-[10px] ml-auto">确认将发票合并到此订单？</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}

                  {detailOrderData.duplicateStatus !== "MERGED" && !detailMergedInto && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {detailOrderData.duplicateStatus === "UNREVIEWED" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => dedupMutation.mutate({ id: detailOrderData.id, duplicateStatus: "UNIQUE", reviewNote: dedupReviewNote || undefined })}>
                            标记唯一
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => dedupMutation.mutate({ id: detailOrderData.id, duplicateStatus: "DUPLICATE", reviewNote: dedupReviewNote || undefined })}>
                            标记重复
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => dedupMutation.mutate({ id: detailOrderData.id, duplicateStatus: "IGNORED", reviewNote: dedupReviewNote || undefined })}>
                            忽略此组
                          </Button>
                        </>
                      )}
                      {detailOrderData.duplicateStatus === "DUPLICATE" && duplicateGroup.length > 0 && (
                        <>
                          {mergeTargetId ? (
                            <>
                              <Button size="sm" className="h-7 text-xs" disabled={mergeMutation.isPending} onClick={() => mergeMutation.mutate({ sourceId: detailOrderData.id, masterId: mergeTargetId })}>
                                {mergeMutation.isPending ? "合并中..." : "确认合并"}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMergeTargetId(null)}>取消</Button>
                            </>
                          ) : (
                            duplicateGroup.map((dup) => (
                              <Button key={dup.id} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMergeTargetId(dup.id)}>
                                合并到 {dup.externalOrderNo}
                              </Button>
                            ))
                          )}
                        </>
                      )}
                      {(detailOrderData.duplicateStatus === "DUPLICATE" || detailOrderData.duplicateStatus === "UNIQUE" || detailOrderData.duplicateStatus === "IGNORED") && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dedupMutation.mutate({ id: detailOrderData.id, duplicateStatus: "UNREVIEWED", reviewNote: dedupReviewNote || undefined })}>
                          撤销标记
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="flex items-start gap-2">
                    <Textarea
                      value={dedupReviewNote}
                      onChange={(e) => setDedupReviewNote(e.target.value)}
                      placeholder="审查备注（保存时随操作一起提交）"
                      rows={1} className="text-xs resize-none flex-1"
                    />
                    {dedupReviewNote && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { dedupMutation.mutate({ id: detailOrderData.id, duplicateStatus: detailOrderData.duplicateStatus, reviewNote: dedupReviewNote }); setDedupReviewNote(""); }}>
                        保存备注
                      </Button>
                    )}
                  </div>
                  {detailOrderData.reviewNote && (
                    <p className="text-xs text-muted-foreground">备注：{detailOrderData.reviewNote}</p>
                  )}
                </div>
              )}

              {/* Invoice processing link */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">开票处理</h4>
                  <Link href="/finance/order-matching">
                    <Button size="sm" variant="outline">
                      <ExternalLink className="mr-1 h-3 w-3" /> 在财务管理中处理开票与匹配
                    </Button>
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground mt-1">订单匹配、财务分类、开票申请等操作请前往财务管理模块统一处理。</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {isMobile && selectedOrderIds.size > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-50 bg-background border-t px-4 py-3 flex items-center gap-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <span className="text-sm font-medium shrink-0">已选 {selectedOrderIds.size}</span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const selected = orders.filter((o) => selectedOrderIds.has(o.id));
                const text = getFeishuProjectHeader() + "\n" + externalOrdersToFeishuText(selected);
                await navigator.clipboard.writeText(text);
                toast.success(`已复制 ${selected.length} 条订单到剪贴板`);
              } catch { toast.error("导出失败"); }
            }}
          >
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" />导出
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={batchDeleteMutation.isPending}
            onClick={() => {
              if (!confirm(`确认删除选中的 ${selectedOrderIds.size} 条拼好鼠订单？此操作不可恢复。`)) return;
              batchDeleteMutation.mutate();
            }}
          >
            {batchDeleteMutation.isPending ? "删除中..." : "删除"}
          </Button>
        </div>
      )}
    </div>
  );
}

function CustomerBindSection({ order }: { order: ExternalOrder }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "bind">("create");
  const [bindCustomerId, setBindCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [formName, setFormName] = useState(order.receiverName || "");
  const [formPrincipal, setFormPrincipal] = useState(order.receiverPhone || "");
  const [formWechat, setFormWechat] = useState("");
  const [formAddress, setFormAddress] = useState(order.receiverAddress || "");
  const [formOrganization, setFormOrganization] = useState(order.storeName || "");

  const isMerged = order.duplicateStatus === "MERGED" || !!order.mergedIntoId;

  const { data: customerList } = useQuery<{ customers: { id: string; name: string; customerCode: string; principal: string | null }[] }>({
    queryKey: ["customers-search", customerSearch],
    queryFn: () => fetch(`/api/customers/list?search=${encodeURIComponent(customerSearch)}`).then((r) => r.json()),
    enabled: open && mode === "bind",
  });

  const bindMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = mode === "bind"
        ? { mode: "bind", customerId: bindCustomerId }
        : { mode: "create", name: formName, principal: formPrincipal, wechat: formWechat, address: formAddress, organization: formOrganization };
      const res = await fetch(`/api/external-orders/${order.id}/customer`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "操作失败"); }
      return res.json();
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "客户已创建并绑定" : "客户已绑定");
      queryClient.invalidateQueries({ queryKey: ["external-orders"] });
      queryClient.invalidateQueries({ queryKey: ["external-order-detail", order.id] });
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (order.customerId && order.customer) {
    return (
      <div className="flex items-center gap-2 text-sm py-2">
        <span className="text-muted-foreground">已绑定客户：</span>
        <a href={`/customers`} className="text-primary hover:underline font-medium">{order.customer.name}</a>
        <span className="text-xs text-muted-foreground">({order.customer.customerCode})</span>
      </div>
    );
  }

  return (
    <div className="py-2">
      {isMerged ? (
        <p className="text-xs text-muted-foreground">该订单已合并，请在主订单上处理客户</p>
      ) : (
        <>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1" />{order.customerId ? "已绑定" : "添加/绑定客户"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>{mode === "create" ? "新建客户" : "绑定已有客户"}</DialogTitle></DialogHeader>
              <div className="flex gap-2 mb-4">
                <Button size="sm" variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>新建客户</Button>
                <Button size="sm" variant={mode === "bind" ? "default" : "outline"} onClick={() => setMode("bind")}>绑定已有客户</Button>
              </div>

              {mode === "create" && (
                <div className="space-y-3">
                  <div><label className="text-sm font-medium">客户名称 *</label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="从订单收件人预填" /></div>
                  <div><label className="text-sm font-medium">联系人/电话</label><Input value={formPrincipal} onChange={(e) => setFormPrincipal(e.target.value)} placeholder="从订单电话预填" /></div>
                  <div><label className="text-sm font-medium">微信</label><Input value={formWechat} onChange={(e) => setFormWechat(e.target.value)} /></div>
                  <div><label className="text-sm font-medium">地址</label><Input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} placeholder="从订单地址预填" /></div>
                  <div><label className="text-sm font-medium">单位</label><Input value={formOrganization} onChange={(e) => setFormOrganization(e.target.value)} placeholder="从订单门店预填" /></div>
                  <Button onClick={() => bindMutation.mutate()} disabled={!formName.trim() || bindMutation.isPending} className="w-full">
                    {bindMutation.isPending ? "创建中..." : "创建并绑定"}
                  </Button>
                </div>
              )}

              {mode === "bind" && (
                <div className="space-y-3">
                  <Input placeholder="搜索客户..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
                  <div className="border rounded-md max-h-48 overflow-y-auto">
                    {customerList?.customers.map((c) => (
                      <div key={c.id} className={`flex items-center justify-between p-2 cursor-pointer hover:bg-muted ${bindCustomerId === c.id ? "bg-primary/10" : ""}`} onClick={() => setBindCustomerId(c.id)}>
                        <div><div className="text-sm font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.customerCode}{c.principal ? ` · ${c.principal}` : ""}</div></div>
                        {bindCustomerId === c.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      </div>
                    ))}
                    {customerList?.customers.length === 0 && <p className="text-xs text-muted-foreground p-3 text-center">暂无匹配客户</p>}
                  </div>
                  <Button onClick={() => bindMutation.mutate()} disabled={!bindCustomerId || bindMutation.isPending} className="w-full">
                    {bindMutation.isPending ? "绑定中..." : "确认绑定"}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function OrderDetail({ order }: { order: ExternalOrder }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div><span className="text-muted-foreground">订单号：</span>{order.externalOrderNo}</div>
        {order.merchantOrderNo && <div><span className="text-muted-foreground">商户单号：</span>{order.merchantOrderNo}</div>}
        {order.platform && <div><span className="text-muted-foreground">平台：</span>{order.platform}</div>}
        {order.storeName && <div><span className="text-muted-foreground">门店：</span>{order.storeName}</div>}
        {order.receiverName && <div><span className="text-muted-foreground">收件人：</span>{order.receiverName}</div>}
        {order.receiverPhone && <div><span className="text-muted-foreground">电话：</span>{order.receiverPhone}</div>}
        {order.receiverAddress && <div className="col-span-2"><span className="text-muted-foreground">地址：</span>{order.receiverAddress}</div>}
        {order.orderAt && <div><span className="text-muted-foreground">下单时间：</span>{new Date(order.orderAt).toLocaleString("zh-CN")}</div>}
        {order.paidAt && <div><span className="text-muted-foreground">付款时间：</span>{new Date(order.paidAt).toLocaleString("zh-CN")}</div>}
        {order.grossAmount != null && <div><span className="text-muted-foreground">商品总额：</span>¥{formatAmount(order.grossAmount)}</div>}
        {order.paidAmount != null && <div><span className="text-muted-foreground">实付金额：</span>¥{formatAmount(order.paidAmount)}</div>}
        {order.shippingFee != null && order.shippingFee > 0 && <div><span className="text-muted-foreground">运费：</span>¥{formatAmount(order.shippingFee)}</div>}
        {order.itemCount != null && <div><span className="text-muted-foreground">商品件数：</span>{order.itemCount}</div>}
        {order.orderType && <div><span className="text-muted-foreground">订单类型：</span>{order.orderType}</div>}
        {order.orderUser && <div><span className="text-muted-foreground">下单用户：</span>{order.orderUser}</div>}
      </div>
      {order.productNamesRaw && (
        <div><span className="text-muted-foreground">商品：</span>{order.productNamesRaw}</div>
      )}
      {(order.merchantRemark || order.sellerMessage || order.formNote || order.scheduledDeliveryText) && (
        <div className="space-y-1 text-xs">
          {order.merchantRemark && <div><span className="text-muted-foreground">商家备注：</span>{order.merchantRemark}</div>}
          {order.sellerMessage && <div><span className="text-muted-foreground">卖家留言：</span>{order.sellerMessage}</div>}
          {order.formNote && <div><span className="text-muted-foreground">表单备注：</span>{order.formNote}</div>}
          {order.scheduledDeliveryText && <div><span className="text-muted-foreground">预约配送：</span>{order.scheduledDeliveryText}</div>}
        </div>
      )}
      {order.rawJson && (
        <div>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? "收起原始数据" : "查看原始数据"}
          </Button>
          {showRaw && (
            <pre className="mt-1 p-2 bg-muted rounded text-[10px] max-h-40 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(JSON.parse(order.rawJson), null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
