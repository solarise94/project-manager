"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, Eye, Pencil, Trash2, Download, FileCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { Badge } from "@/components/ui/badge";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { ReceiptFormDialog } from "@/components/finance/receipt-form-dialog";

interface ReceiptItem {
  id: string;
  amount: number;
  receivedAt: string;
  source: string;
  remark: string | null;
  customer: { id: string; name: string } | null;
  order: { id: string; orderNo: string } | null;
  createdBy: { id: string; name: string } | null;
  deleted: boolean;
  deletedAt: string | null;
  deletedById: string | null;
  deletedByName: string | null;
  deleteReason: string | null;
  allocationCount: number;
  allocations?: Array<{
    id: string;
    invoiceId: string;
    amount: number;
    invoice?: { actualInvoiceNo: string | null } | null;
    order?: { orderNo: string | null } | null;
  }>;
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "人工录入",
  PINGOODMICE_ORDER: "平台订单",
  BANK: "银行转账",
  OTHER: "其他",
};

export default function InvoiceReceiptDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!session) {
    router.push("/login");
    return null;
  }
  if (session.user.role === "REPRESENTATIVE") {
    router.push("/dashboard");
    return null;
  }

  return <InvoiceReceiptDetailContent />;
}

function InvoiceReceiptDetailContent() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deletedFilter, setDeletedFilter] = useState<"active" | "all" | "deleted">("active");
  const [deleteTarget, setDeleteTarget] = useState<ReceiptItem | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [editingReceipt, setEditingReceipt] = useState<ReceiptItem | null>(null);
  const [viewingAllocations, setViewingAllocations] = useState<ReceiptItem | null>(null);
  const [voucherFilter, setVoucherFilter] = useState<"all" | "voucher">("all");
  const pageSize = 20;
  const isMobile = useMediaQuery("(max-width: 767px)");

  const { data, isLoading } = useQuery<{
    receipts: ReceiptItem[];
    total: number;
  }>({
    queryKey: ["finance", "receipts", search, page, deletedFilter, voucherFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (deletedFilter === "all" && isAdmin) params.set("includeDeleted", "1");
      if (deletedFilter === "deleted" && isAdmin) params.set("deletedOnly", "1");
      if (voucherFilter === "voucher") params.set("hasAllocations", "1");
      const res = await fetch(`/api/finance/receipts?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (payload: { id: string; reason?: string }) => {
      const res = await fetch(`/api/finance/receipts/${payload.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: payload.reason || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "删除失败" }));
        throw new Error(err.error || "删除失败");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance", "receipts"] });
      queryClient.invalidateQueries({ queryKey: ["finance", "summary"] });
      setDeleteTarget(null);
      setDeleteReason("");
    },
  });

  const receipts = data?.receipts || [];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title="订单回款流水"
        description="发票与回款流水查询（仅查询，新增回款请从订单详情页操作）"
        backHref="/finance"
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm min-w-0 w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索客户/订单号/外部订单号..."
            className="pl-8 w-full"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={voucherFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => { setVoucherFilter("all"); setPage(1); }}
          >
            全部回款
          </Button>
          <Button
            variant={voucherFilter === "voucher" ? "default" : "outline"}
            size="sm"
            onClick={() => { setVoucherFilter("voucher"); setPage(1); }}
          >
            <FileCheck className="h-3.5 w-3.5 mr-1" />
            凭证匹配
          </Button>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-1">
            <Button
              variant={deletedFilter === "active" ? "default" : "outline"}
              size="sm"
              onClick={() => { setDeletedFilter("active"); setPage(1); }}
            >
              有效
            </Button>
            <Button
              variant={deletedFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => { setDeletedFilter("all"); setPage(1); }}
            >
              全部
            </Button>
            <Button
              variant={deletedFilter === "deleted" ? "default" : "outline"}
              size="sm"
              onClick={() => { setDeletedFilter("deleted"); setPage(1); }}
            >
              已删除
            </Button>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const params = new URLSearchParams();
            if (search) params.set("search", search);
            if (voucherFilter === "voucher") params.set("hasAllocations", "1");
            window.open(`/api/finance/receipts/export?${params.toString()}`, "_blank");
          }}
        >
          <Download className="h-3.5 w-3.5 mr-1" />
          导出
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : receipts.length === 0 ? (
        <FinanceEmptyState
          title="暂无到款记录"
          description={deletedFilter === "deleted" ? "暂无已删除的回款记录。" : "暂无符合条件的回款流水。"}
        />
      ) : isMobile ? (
        <div className="md:hidden space-y-3">
          {receipts.map((r) => (
            <FinanceMobileCard
              key={r.id}
              title={
                <div className="flex items-center gap-2">
                  <span className={r.deleted ? "line-through text-muted-foreground" : ""}>
                    <MoneyText value={r.amount} tone="income" />
                  </span>
                  {r.deleted && <Badge variant="destructive" className="text-xs">已删除</Badge>}
                </div>
              }
              badge={
                <Badge variant="outline">
                  {SOURCE_LABELS[r.source] || r.source}
                </Badge>
              }
              subtitle={
                <div className={`space-y-0.5 ${r.deleted ? "text-muted-foreground" : ""}`}>
                  <p>到款日期：{new Date(r.receivedAt).toLocaleDateString("zh-CN")}</p>
                  <p>客户：{r.customer?.name || "-"}</p>
                  <p>订单：{r.order?.orderNo || "-"}</p>
                  {r.remark && <p>备注：{r.remark}</p>}
                  {r.deleted && r.deleteReason && <p>删除原因：{r.deleteReason}</p>}
                  {r.deleted && r.deletedAt && <p>删除时间：{new Date(r.deletedAt).toLocaleDateString("zh-CN")}</p>}
                  {r.deleted && r.deletedByName && <p>删除人：{r.deletedByName}</p>}
                </div>
              }
              primaryAction={
                !r.deleted && r.order
                  ? {
                      label: "查看订单",
                      onClick: () =>
                        router.push(`/orders/${r.order!.id}?tab=finance`),
                      icon: <Eye className="h-3.5 w-3.5 mr-1" />,
                    }
                  : undefined
              }
              moreActions={
                !r.deleted
                  ? [
                      ...(r.customer
                        ? [
                            {
                              label: "查看客户",
                              onClick: () =>
                                router.push(`/finance/customers/${r.customer!.id}`),
                            },
                          ]
                        : []),
                      ...(isAdmin
                        ? [
                            {
                              label: "编辑",
                              onClick: () => setEditingReceipt(r),
                            },
                            {
                              label: "删除",
                              onClick: () => setDeleteTarget(r),
                              destructive: true as const,
                            },
                          ]
                        : []),
                    ]
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <FinanceDataTable
          columns={[
            {
              key: "receivedAt",
              header: "到款日期",
              render: (r) =>
                new Date(r.receivedAt).toLocaleDateString("zh-CN"),
            },
            {
              key: "orderNo",
              header: "订单号",
              render: (r) => r.order?.orderNo || "-",
            },
            {
              key: "customer",
              header: "客户",
              render: (r) => r.customer?.name || "-",
            },
            {
              key: "amount",
              header: "金额",
              align: "right",
              render: (r) => (
                <span className={r.deleted ? "line-through text-muted-foreground" : ""}>
                  <MoneyText value={r.amount} tone={r.deleted ? undefined : "income"} />
                </span>
              ),
            },
            {
              key: "source",
              header: "来源",
              align: "center",
              render: (r) => (
                <Badge variant="outline">
                  {SOURCE_LABELS[r.source] || r.source}
                </Badge>
              ),
            },
            {
              key: "allocationCount",
              header: "核销发票",
              align: "center",
              render: (r) =>
                r.allocationCount > 0 ? (
                  <button
                    className="text-primary hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingAllocations(r);
                    }}
                  >
                    <Badge variant="secondary">{r.allocationCount} 张</Badge>
                  </button>
                ) : (
                  "-"
                ),
            },
            {
              key: "createdBy",
              header: "创建人",
              align: "center",
              render: (r) => r.createdBy?.name || "-",
            },
            {
              key: "remark",
              header: "备注",
              render: (r) => r.remark || "-",
            },
            {
              key: "status",
              header: "状态",
              align: "center",
              render: (r) =>
                r.deleted ? (
                  <div className="text-xs space-y-0.5">
                    <Badge variant="destructive">已删除</Badge>
                    {r.deletedAt && (
                      <p className="text-muted-foreground">
                        {new Date(r.deletedAt).toLocaleDateString("zh-CN")}
                      </p>
                    )}
                    {r.deletedByName && (
                      <p className="text-muted-foreground">{r.deletedByName}</p>
                    )}
                    {r.deleteReason && (
                      <p className="text-muted-foreground max-w-[200px] truncate" title={r.deleteReason}>
                        {r.deleteReason}
                      </p>
                    )}
                  </div>
                ) : null,
            },
            {
              key: "actions",
              header: "操作",
              align: "center",
              render: (r) => (
                <div className="flex items-center justify-center gap-2">
                  {!r.deleted && r.order && (
                    <Link
                      href={`/orders/${r.order.id}?tab=finance`}
                      className="text-primary hover:underline text-xs"
                    >
                      查看订单
                    </Link>
                  )}
                  {!r.deleted && r.customer && (
                    <Link
                      href={`/finance/customers/${r.customer.id}`}
                      className="text-primary hover:underline text-xs"
                    >
                      查看客户
                    </Link>
                  )}
                  {isAdmin && !r.deleted && (
                    <>
                      <button
                        className="text-primary hover:underline text-xs flex items-center gap-0.5"
                        onClick={() => setEditingReceipt(r)}
                      >
                        <Pencil className="h-3 w-3" />
                        编辑
                      </button>
                      <button
                        className="text-red-500 hover:underline text-xs flex items-center gap-0.5"
                        onClick={() => setDeleteTarget(r)}
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
          data={receipts}
          keyExtractor={(r) => r.id}
        />
      )}

      {data && data.total > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            共 {data.total} 条
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= Math.ceil(data.total / pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除到款记录</DialogTitle>
            <DialogDescription>
              删除操作不可撤销。删除后该到款将从所有财务统计中排除，但会保留审计记录。
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-3 py-2">
              <div className="text-sm space-y-1">
                <p>金额：<strong className="text-red-600"><MoneyText value={deleteTarget.amount} tone="income" /></strong></p>
                <p>到款日期：{new Date(deleteTarget.receivedAt).toLocaleDateString("zh-CN")}</p>
                <p>订单：{deleteTarget.order?.orderNo || "-"}</p>
                <p>客户：{deleteTarget.customer?.name || "-"}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="deleteReason">删除原因</Label>
                <Textarea
                  id="deleteReason"
                  placeholder="请输入删除原因（必填）"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteReason(""); }}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteReason.trim() || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id, reason: deleteReason.trim() })}
            >
              {deleteMutation.isPending ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteMutation.isError && (
        <p className="text-red-500 text-sm text-center">{(deleteMutation.error as Error).message}</p>
      )}

      {/* Edit receipt dialog */}
      <ReceiptFormDialog
        open={!!editingReceipt}
        onOpenChange={(open) => { if (!open) setEditingReceipt(null); }}
        defaultOrderId={editingReceipt?.order?.id}
        receipt={editingReceipt ? {
          id: editingReceipt.id,
          amount: editingReceipt.amount,
          receivedAt: editingReceipt.receivedAt,
          source: editingReceipt.source,
          remark: editingReceipt.remark,
          orderId: editingReceipt.order?.id || null,
          allocations: editingReceipt.allocations,
        } : null}
        onSuccess={() => {
          setEditingReceipt(null);
          queryClient.invalidateQueries({ queryKey: ["finance", "receipts"] });
          queryClient.invalidateQueries({ queryKey: ["finance", "summary"] });
        }}
      />

      {/* View allocations dialog */}
      <Dialog open={!!viewingAllocations} onOpenChange={(open) => { if (!open) setViewingAllocations(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>回款核销明细</DialogTitle>
            <DialogDescription>
              回款编号 {viewingAllocations?.id}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {(viewingAllocations?.allocations || []).map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 border-b text-sm">
                <div>
                  <p className="font-medium">{a.invoice?.actualInvoiceNo || a.invoiceId}</p>
                  {a.order?.orderNo && (
                    <p className="text-xs text-muted-foreground">订单: {a.order.orderNo}</p>
                  )}
                </div>
                <MoneyText value={a.amount} tone="income" />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingAllocations(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
