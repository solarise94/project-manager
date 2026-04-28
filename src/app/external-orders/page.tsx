"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Loader2, Search, Upload, Copy, FileDown,
  Send, CheckCircle2, XCircle, MessageSquare, Pencil, ClipboardCopy,
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { InvoiceFormDialog, type InvoiceRecord, type InvoiceItem } from "@/components/invoice-form-dialog";
import { sheetDataFromRecord, type InvoiceSheetData } from "@/lib/invoice-sheet";
import { exportInvoiceSheetToPdf } from "@/lib/export-invoice-pdf";
import { getFeishuProjectHeader, externalOrderToFeishuRow, externalOrdersToFeishuText } from "@/lib/feishu-export";

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
  rawJson: string | null;
  createdAt: string;
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  NONE: "未开票", DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票",
};
const INVOICE_STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  NONE: "outline", DRAFT: "secondary", REQUESTED: "default", ISSUED: "outline",
};
const INV_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票", CANCELLED: "已取消",
};
const INV_STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "secondary", REQUESTED: "default", ISSUED: "outline", CANCELLED: "destructive",
};

function formatAmount(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildPreviewTextFromRecord(inv: InvoiceRecord): string {
  const lines: string[] = [];
  if (inv.contactName) lines.push(inv.contactName);
  if (inv.projectCode) lines.push(`项目编号：${inv.projectCode}`);
  if (inv.sellerName) lines.push(`开票方：${inv.sellerName}`);
  if (inv.sellerTaxId) lines.push(`开票方税号：${inv.sellerTaxId}`);
  if (inv.sellerBankName || inv.sellerBankAccount) {
    lines.push(`开票方开户行及账号：${[inv.sellerBankName, inv.sellerBankAccount].filter(Boolean).join(" ")}`);
  }
  lines.push(`对方公司名称：${inv.buyerOrganizationName}`);
  if (inv.buyerTaxId) lines.push(`统一社会信用代码/纳税人识别号：${inv.buyerTaxId}`);
  if (inv.contentSummary) lines.push(`开票内容：${inv.contentSummary}`);
  if (inv.totalAmount > 0) lines.push(`金额：${formatAmount(inv.totalAmount)}`);
  lines.push(`普票/专票：${inv.invoiceType === "SPECIAL" ? "专票" : "普票"}`);
  for (const it of inv.items) {
    const parts: string[] = [`项目名称：${it.itemName}`];
    if (it.spec) parts.push(`规格：${it.spec}`);
    if (it.unit) parts.push(`单位：${it.unit}`);
    if (it.quantity != null) parts.push(`数量：${it.quantity}`);
    if (it.amount) parts.push(`金额：${formatAmount(it.amount)}`);
    lines.push(parts.join("；"));
  }
  if (inv.remark) lines.push(`备注：${inv.remark}`);
  return lines.join("\n");
}

export default function ExternalOrdersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState("微信小商店");
  const [importText, setImportText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [detailOrder, setDetailOrder] = useState<ExternalOrder | null>(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceDefaults, setInvoiceDefaults] = useState<Partial<{
    contactName: string; buyerOrgId: string; buyerOrgName: string;
    invoiceType: string; contentSummary: string; remark: string; items: InvoiceItem[];
  }>>({});

  const [editRemarkId, setEditRemarkId] = useState<string | null>(null);
  const [editRemarkText, setEditRemarkText] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  }, []);

  const { data: listData, isLoading } = useQuery<{ orders: ExternalOrder[]; total: number }>({
    queryKey: ["external-orders", debouncedSearch, invoiceStatusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (invoiceStatusFilter !== "ALL") params.set("invoiceStatus", invoiceStatusFilter);
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

  // Detail + invoices
  const { data: detailData } = useQuery<{ order: ExternalOrder & { invoiceRequests: InvoiceRecord[] } }>({
    queryKey: ["external-order-detail", detailOrder?.id],
    queryFn: async () => {
      const res = await fetch(`/api/external-orders/${detailOrder!.id}`);
      if (!res.ok) throw new Error("加载失败");
      return res.json();
    },
    enabled: !!detailOrder,
  });
  const detailInvoices: InvoiceRecord[] = detailData?.order?.invoiceRequests || [];

  const invalidateDetail = useCallback(() => {
    if (detailOrder) {
      queryClient.invalidateQueries({ queryKey: ["external-order-detail", detailOrder.id] });
      queryClient.invalidateQueries({ queryKey: ["external-orders"] });
    }
  }, [queryClient, detailOrder]);

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/external-order-invoices/${id}`, {
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

  const remarkMutation = useMutation({
    mutationFn: async ({ id, remark }: { id: string; remark: string }) => {
      const res = await fetch(`/api/external-order-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      return data;
    },
    onSuccess: () => { toast.success("备注已更新"); setEditRemarkId(null); invalidateDetail(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const confirmTaxIdMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/external-order-invoices/${invoiceId}/confirm-tax-id`, { method: "POST" });
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

  const copyText = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("已复制到剪贴板"); }
    catch { toast.error("复制失败"); }
  }, []);

  const exportPdf = useCallback(async (data: InvoiceSheetData) => {
    try {
      await exportInvoiceSheetToPdf(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF 导出失败");
    }
  }, []);

  const openCreateInvoice = useCallback(async () => {
    if (!detailOrder) return;
    setEditingInvoice(null);
    const fallback = { contactName: detailOrder.receiverName || "" };
    try {
      const res = await fetch(`/api/external-orders/${detailOrder.id}/invoice-draft`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const d = data.draft || {};
        const draftItems: InvoiceItem[] | undefined =
          Array.isArray(d.items) && d.items.length > 0
            ? d.items.map((it: Record<string, unknown>) => ({
                itemName: String(it.itemName || ""),
                spec: String(it.spec || ""),
                unit: String(it.unit || ""),
                quantity: it.quantity != null ? String(it.quantity) : "",
                amount: it.amount != null ? String(it.amount) : "",
              }))
            : undefined;
        setInvoiceDefaults({
          contactName: d.contactName || detailOrder.receiverName || "",
          invoiceType: d.invoiceType || undefined,
          contentSummary: d.contentSummary || undefined,
          remark: d.remark || undefined,
          items: draftItems,
        });
      } else {
        setInvoiceDefaults(fallback);
      }
    } catch {
      setInvoiceDefaults(fallback);
    }
    setInvoiceDialogOpen(true);
  }, [detailOrder]);

  const openEditInvoice = useCallback((inv: InvoiceRecord) => {
    setEditingInvoice(inv);
    setInvoiceDialogOpen(true);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">外部订单</h1>
        <Button size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="mr-1 h-3.5 w-3.5" /> 导入订单
        </Button>
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
          <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            <SelectItem value="NONE">未开票</SelectItem>
            <SelectItem value="DRAFT">草稿</SelectItem>
            <SelectItem value="REQUESTED">已申请</SelectItem>
            <SelectItem value="ISSUED">已开票</SelectItem>
          </SelectContent>
        </Select>
        {orders.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={async () => {
              try {
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
              } catch {
                toast.error("导出失败");
              }
            }}
          >
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" />
            导出飞书（全部{total > pageSize ? ` ${total}条` : ""})
          </Button>
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
                    <span className="text-sm font-mono">{order.externalOrderNo}</span>
                    <Badge variant={INVOICE_STATUS_VARIANTS[order.invoiceStatus] || "outline"} className="text-[10px] shrink-0">
                      {INVOICE_STATUS_LABELS[order.invoiceStatus] || order.invoiceStatus}
                    </Badge>
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
          <DialogHeader><DialogTitle>导入外部订单</DialogTitle></DialogHeader>
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
              <div className="border-t pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">开票申请</h4>
                  <Button size="sm" variant="outline" onClick={openCreateInvoice}>
                    <Plus className="mr-1 h-3 w-3" /> 新建开票申请
                  </Button>
                </div>
                {detailInvoices.length === 0 ? (
                  <div className="text-center py-3 text-xs text-muted-foreground">暂无开票申请</div>
                ) : (
                  <div className="space-y-2">
                    {detailInvoices.map((inv) => (
                      <InvoiceCard
                        key={inv.id} inv={inv}
                        onCopy={() => copyText(buildPreviewTextFromRecord(inv))}
                        onPrint={() => void exportPdf(sheetDataFromRecord(inv))}
                        onEdit={() => openEditInvoice(inv)}
                        onStatus={(status) => statusMutation.mutate({ id: inv.id, status })}
                        onRemarkOpen={() => { setEditRemarkId(inv.id); setEditRemarkText(inv.remark || ""); }}
                        onConfirmTaxId={() => confirmTaxIdMutation.mutate(inv.id)}
                        editRemarkId={editRemarkId}
                        editRemarkText={editRemarkText}
                        setEditRemarkText={setEditRemarkText}
                        remarkMutation={remarkMutation}
                        onRemarkCancel={() => setEditRemarkId(null)}
                        confirmTaxIdPending={confirmTaxIdMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {detailOrder && (
        <InvoiceFormDialog
          open={invoiceDialogOpen}
          onOpenChange={setInvoiceDialogOpen}
          editingInvoice={editingInvoice}
          createUrl={`/api/external-orders/${detailOrder.id}/invoices`}
          patchUrlPrefix="/api/external-order-invoices"
          onSuccess={invalidateDetail}
          defaultValues={invoiceDefaults}
          showProjectCode={false}
          aiDraftUrl={null}
        />
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

/* eslint-disable @typescript-eslint/no-explicit-any */
function InvoiceCard({ inv, onCopy, onPrint, onEdit, onStatus, onRemarkOpen, onConfirmTaxId, editRemarkId, editRemarkText, setEditRemarkText, remarkMutation, onRemarkCancel, confirmTaxIdPending }: {
  inv: InvoiceRecord;
  onCopy: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onStatus: (status: string) => void;
  onRemarkOpen: () => void;
  onConfirmTaxId: () => void;
  editRemarkId: string | null;
  editRemarkText: string;
  setEditRemarkText: (v: string) => void;
  remarkMutation: any;
  onRemarkCancel: () => void;
  confirmTaxIdPending: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{inv.buyerOrganizationName}</span>
            <Badge variant={inv.invoiceType === "SPECIAL" ? "default" : "secondary"} className="text-[10px] shrink-0">
              {inv.invoiceType === "SPECIAL" ? "专票" : "普票"}
            </Badge>
            <Badge variant={INV_STATUS_VARIANTS[inv.status] || "outline"} className="text-[10px] shrink-0">
              {INV_STATUS_LABELS[inv.status] || inv.status}
            </Badge>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-sm font-medium">{formatAmount(inv.totalAmount)}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCopy} title="复制给财务">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onPrint} title="导出 PDF">
              <FileDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {inv.items.length > 0 && (
          <div className="text-xs text-muted-foreground">{inv.items.map((it) => it.itemName).join("、")}</div>
        )}
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-muted-foreground">
            {inv.createdBy.name} · {formatDistanceToNow(new Date(inv.createdAt), { addSuffix: true, locale: zhCN })}
          </div>
          <div className="flex items-center gap-1">
            {inv.status === "DRAFT" && (
              <>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onEdit}>
                  <Pencil className="mr-1 h-3 w-3" /> 编辑
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onStatus("REQUESTED")}>
                  <Send className="mr-1 h-3 w-3" /> 提交申请
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive" onClick={() => onStatus("CANCELLED")}>
                  <XCircle className="mr-1 h-3 w-3" /> 取消
                </Button>
              </>
            )}
            {inv.status === "REQUESTED" && (
              <>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onRemarkOpen}>
                  <MessageSquare className="mr-1 h-3 w-3" /> 备注
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onStatus("ISSUED")}>
                  <CheckCircle2 className="mr-1 h-3 w-3" /> 标记已开票
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive" onClick={() => onStatus("CANCELLED")}>
                  <XCircle className="mr-1 h-3 w-3" /> 取消
                </Button>
              </>
            )}
          </div>
        </div>
        {inv.buyerTaxIdFromLookup && inv.buyerOrganizationId && inv.buyerTaxId && (
          <div className="flex items-center gap-2 text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1">
            <span>税号 {inv.buyerTaxId} 来自查询，尚未同步到单位主数据</span>
            <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" disabled={confirmTaxIdPending} onClick={onConfirmTaxId}>
              确认并同步
            </Button>
          </div>
        )}
        {editRemarkId === inv.id && (
          <div className="flex items-start gap-2 pt-1 border-t">
            <Textarea
              value={editRemarkText}
              onChange={(e) => setEditRemarkText(e.target.value)}
              placeholder="备注信息" rows={2} className="text-xs resize-none flex-1"
            />
            <div className="flex flex-col gap-1">
              <Button size="sm" className="h-7 text-xs" disabled={remarkMutation.isPending} onClick={() => remarkMutation.mutate({ id: inv.id, remark: editRemarkText })}>
                {remarkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "保存"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onRemarkCancel}>取消</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
