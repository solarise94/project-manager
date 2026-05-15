"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, Plus, Search, Eye, Upload, RotateCcw, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { InvoiceStatusBadge } from "@/components/finance/finance-status-badge";
import { InvoiceFormDialog } from "@/components/invoice-form-dialog";
import type { InvoiceRecord } from "@/components/invoice-form-dialog";
import { useMediaQuery } from "@/hooks/use-media-query";
import Link from "next/link";

interface InvoiceItem {
  id: string;
  status: string;
  buyerOrganizationName: string | null;
  orderId: string | null;
  order: { orderNo: string } | null;
  totalAmount: number;
  invoiceType: string;
  actualInvoiceNo: string | null;
  actualIssuedAt: string | null;
  createdAt: string;
  documents: Array<{ id: string }>;
  orderCoverage: Array<{ order: { id: string; orderNo: string } | null }>;
  adjustmentsAsOriginal: Array<{ id: string; kind: string }>;
}

type InvoiceTab = "all" | "draft" | "requested" | "issued" | "red" | "cancelled";

const TAB_LABELS: Record<InvoiceTab, string> = {
  all: "全部",
  draft: "草稿",
  requested: "待开票",
  issued: "已开票",
  red: "已冲红",
  cancelled: "已取消",
};

const VALID_TABS: InvoiceTab[] = ["all", "draft", "requested", "issued", "red", "cancelled"];

export default function InvoicesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <InvoicesContent />
    </Suspense>
  );
}

function InvoicesContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<InvoiceTab>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const orderId = searchParams.get("orderId");
  const editInvoiceId = searchParams.get("edit");
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isAdmin = session?.user?.role === "ADMIN";

  const { data: editingInvoice, error: editError } = useQuery<InvoiceRecord>({
    queryKey: ["finance", "order-invoice", editInvoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/finance/order-invoices/${editInvoiceId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `加载失败 (${res.status})`);
      }
      const d = await res.json();
      return d.invoice;
    },
    enabled: !!editInvoiceId,
    retry: false,
  });

  // When editing invoice detail fails to load, close dialog and alert user
  useEffect(() => {
    if (!editError || !editInvoiceId) return;
    alert(editError.message || "发票详情加载失败");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("edit");
    router.push(`/finance/invoices?${params.toString()}`);
  }, [editError, editInvoiceId, router, searchParams]);

  const p = new URLSearchParams();
  if (search) p.set("search", search);
  if (tab === "red") {
    p.set("hasRedAdjustment", "true");
  } else if (tab === "issued") {
    p.set("status", "ISSUED");
    p.set("hasRedAdjustment", "false");
  } else if (tab !== "all") {
    p.set("status", tab.toUpperCase());
  }
  p.set("pageSize", String(pageSize));
  p.set("page", String(page));
  if (orderId) p.set("orderId", orderId);

  const { data: orderData, isLoading } = useQuery<{
    invoices: InvoiceItem[];
    total: number;
  }>({
    queryKey: ["finance", "all-invoices", search, tab, orderId, page],
    queryFn: () =>
      fetch(`/api/finance/order-invoices?${p.toString()}`).then((r) =>
        r.ok ? r.json() : { invoices: [], total: 0 }
      ),
  });

  if (status === "loading")
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  if (!session) {
    router.push("/login");
    return null;
  }
  if (session.user.role === "REPRESENTATIVE") {
    router.push("/dashboard");
    return null;
  }

  const invoices = orderData?.invoices || [];

  const isHistorical = (inv: InvoiceItem) => {
    // An invoice is historical if it has no orderId and no orderCoverage
    const hasOrder = inv.orderId || inv.orderCoverage.length > 0;
    return !hasOrder;
  };

  const handleCancelInvoice = async (invoiceId: string) => {
    if (!confirm("确定要取消这张发票申请吗？")) return;
    const res = await fetch(`/api/finance/order-invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["finance", "all-invoices"] });
      if (orderId) queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    } else {
      const d = await res.json();
      alert(d.error || "取消失败");
    }
  };

  const handleSubmitInvoice = async (invoiceId: string) => {
    if (!confirm("确定要提交这张发票申请吗？")) return;
    const res = await fetch(`/api/finance/order-invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REQUESTED" }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["finance", "all-invoices"] });
      if (orderId) queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    } else {
      const d = await res.json();
      alert(d.error || "提交失败");
    }
  };

  const handleRedInvoice = async (invoiceId: string) => {
    const reason = prompt("请输入冲红原因：");
    if (!reason) return;
    const res = await fetch(`/api/finance/order-invoices/${invoiceId}/red`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["finance", "all-invoices"] });
      if (orderId) queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    } else {
      const d = await res.json();
      alert(d.error || "冲红失败");
    }
  };

  const getActions = (inv: InvoiceItem) => {
    const actions: Array<{ label: string; icon: React.ReactNode; onClick: () => void; variant?: "destructive" | "default" }> = [];
    const hasRed = inv.adjustmentsAsOriginal?.some((a) => a.kind === "RED");
    if (!isAdmin) return actions;
    if (inv.status === "DRAFT") {
      actions.push({ label: "前往订单处理", icon: <Eye className="h-3 w-3" />, onClick: () => {
        if (inv.orderId) router.push(`/orders/${inv.orderId}?tab=finance`);
      } });
      actions.push({ label: "提交", icon: <Upload className="h-3 w-3" />, onClick: () => handleSubmitInvoice(inv.id) });
      actions.push({ label: "取消", icon: <Ban className="h-3 w-3" />, onClick: () => handleCancelInvoice(inv.id), variant: "destructive" });
    } else if (inv.status === "REQUESTED") {
      if (inv.orderId) {
        actions.push({ label: "上传发票", icon: <Upload className="h-3 w-3" />, onClick: () => {
          router.push(`/orders/${inv.orderId}?tab=finance&action=issue&invoiceId=${inv.id}`);
        } });
      }
      actions.push({ label: "取消", icon: <Ban className="h-3 w-3" />, onClick: () => handleCancelInvoice(inv.id), variant: "destructive" });
    } else if (inv.status === "ISSUED" && !hasRed) {
      if (inv.orderId && (inv.documents?.length || 0) === 0) {
        actions.push({ label: "上传发票", icon: <Upload className="h-3 w-3" />, onClick: () => {
          router.push(`/orders/${inv.orderId}?tab=finance&action=issue&invoiceId=${inv.id}`);
        } });
      }
      actions.push({ label: "冲红", icon: <RotateCcw className="h-3 w-3" />, onClick: () => handleRedInvoice(inv.id), variant: "destructive" });
    }
    return actions;
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
      <FinancePageHeader
        title="发票工作台"
        description="发票队列与状态台账 — 查看发票申请、开票状态、真实发票与附件"
        backHref="/finance"
      />

      {orderId && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          <span>当前仅查看该订单的发票</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => router.push("/finance/invoices")}
          >
            <X className="h-3 w-3 mr-1" />
            清除筛选
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative max-w-sm min-w-0 w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索发票..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8"
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => { setTab(v as InvoiceTab); setPage(1); }}>
          <TabsList className="flex-wrap h-auto">
            {VALID_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        <FinanceEmptyState
          title={orderId ? "该订单暂无发票" : "暂无发票记录"}
          description="请进入订单详情页创建订单发票。"
          action={
            orderId ? (
              <Link href={`/orders/${orderId}?tab=finance&action=invoice`}>
                <Button size="sm">
                  <Plus className="h-3 w-3 mr-1" />
                  返回订单财务页新建
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : isMobile ? (
        <div className="md:hidden space-y-3">
          {invoices.map((inv) => {
            const actions = getActions(inv);
            return (
              <FinanceMobileCard
                key={inv.id}
                title={
                  inv.buyerOrganizationName ||
                  inv.order?.orderNo ||
                  "未命名"
                }
                badge={
                  <div className="flex items-center gap-1">
                    <InvoiceStatusBadge status={inv.status} />
                    {inv.adjustmentsAsOriginal?.some((a) => a.kind === "RED") && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-destructive/40 text-destructive">
                        已冲红
                      </span>
                    )}
                    {isHistorical(inv) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground">
                        历史
                      </span>
                    )}
                  </div>
                }
                metrics={[
                  {
                    label: "金额",
                    value: <MoneyText value={inv.totalAmount} />,
                  },
                  {
                    label: "类型",
                    value: inv.invoiceType === "SPECIAL" ? "专票" : "普票",
                  },
                  {
                    label: "附件",
                    value: `${inv.documents?.length || 0} 个`,
                  },
                ]}
                subtitle={
                  <div className="space-y-0.5">
                    {inv.order?.orderNo && <p>订单：{inv.order.orderNo}</p>}
                    <p>{new Date(inv.createdAt).toLocaleDateString("zh-CN")}</p>
                  </div>
                }
                primaryAction={
                  inv.orderId
                    ? {
                        label: "查看订单",
                        onClick: () =>
                          router.push(`/orders/${inv.orderId}?tab=finance`),
                        icon: <Eye className="h-3.5 w-3.5 mr-1" />,
                      }
                    : undefined
                }
                moreActions={actions.slice(0, 3).map((a) => ({
                  label: a.label,
                  onClick: a.onClick,
                  destructive: a.variant === "destructive",
                }))}
              />
            );
          })}
        </div>
      ) : (
        <FinanceDataTable
          columns={[
            {
              key: "status",
              header: "状态",
              align: "center",
              render: (inv: InvoiceItem) => (
                <div className="flex items-center justify-center gap-1">
                  <InvoiceStatusBadge status={inv.status} />
                  {inv.adjustmentsAsOriginal?.some((a) => a.kind === "RED") && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-destructive/40 text-destructive">
                      已冲红
                    </span>
                  )}
                  {isHistorical(inv) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground">
                      历史
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "buyerOrganizationName",
              header: "购方单位",
              render: (inv: InvoiceItem) =>
                inv.buyerOrganizationName || "-",
            },
            {
              key: "orderNo",
              header: "订单号",
              render: (inv: InvoiceItem) => inv.order?.orderNo || "-",
            },
            {
              key: "totalAmount",
              header: "金额",
              align: "right",
              money: true,
            },
            {
              key: "invoiceType",
              header: "发票类型",
              align: "center",
              render: (inv: InvoiceItem) =>
                inv.invoiceType === "SPECIAL" ? "专票" : "普票",
            },
            {
              key: "actualInvoiceNo",
              header: "实际发票号",
              render: (inv: InvoiceItem) => inv.actualInvoiceNo || "-",
            },
            {
              key: "createdAt",
              header: "创建时间",
              render: (inv: InvoiceItem) =>
                new Date(inv.createdAt).toLocaleDateString("zh-CN"),
            },
            {
              key: "attachments",
              header: "附件",
              align: "center",
              render: (inv: InvoiceItem) => inv.documents?.length || 0,
            },
            {
              key: "actions",
              header: "操作",
              align: "center",
              render: (inv: InvoiceItem) => {
                const actions = getActions(inv);
                return (
                  <div className="flex items-center gap-1 justify-center">
                    {inv.orderId && (
                      <Link
                        href={`/orders/${inv.orderId}?tab=finance`}
                        className="text-primary hover:underline text-xs"
                      >
                        查看
                      </Link>
                    )}
                    {actions.map((a) => (
                      <Button
                        key={a.label}
                        size="sm"
                        variant={a.variant === "destructive" ? "ghost" : "ghost"}
                        className={`h-6 text-xs ${a.variant === "destructive" ? "text-destructive hover:text-destructive" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          a.onClick();
                        }}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                );
              },
            },
          ]}
          data={invoices}
          keyExtractor={(inv) => inv.id}
        />
      )}

      {(orderData?.total ?? 0) > pageSize && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">共 {orderData?.total} 条</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= Math.ceil((orderData?.total ?? 0) / pageSize)} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          </div>
        </div>
      )}

      <InvoiceFormDialog
        open={!!editInvoiceId}
        onOpenChange={(open) => {
          if (!open) {
            const params = new URLSearchParams(searchParams.toString());
            params.delete("edit");
            router.push(`/finance/invoices?${params.toString()}`);
          }
        }}
        editingInvoice={editingInvoice || null}
        editingInvoiceId={editInvoiceId}
        mode={editInvoiceId ? "edit" : "create"}
        createUrl="/api/finance/order-invoices"
        patchUrlPrefix="/api/finance/order-invoices"
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["finance", "all-invoices"] });
          if (orderId) queryClient.invalidateQueries({ queryKey: ["order", orderId] });
        }}
      />
    </div>
  );
}
