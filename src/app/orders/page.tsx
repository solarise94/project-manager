"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ProjectBindDialog } from "@/components/finance/project-bind-dialog";
import { InvoiceFormDialog } from "@/components/invoice-form-dialog";
import { FolderTree, Receipt, UserRound, Filter, X, FileText, Trash2 } from "lucide-react";
import { canAccessOrders } from "@/lib/role-guards";
import { getOrderSourcePublicLabel, getOrderSourceDisplay } from "@/lib/orders/source-labels";
import { toast } from "sonner";

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<string, string> = { DRAFT: "草稿", CONFIRMED: "已确认", CANCELLED: "已取消", CLOSED: "已关闭" };
const CATEGORY_LABELS: Record<string, string> = { SERVICE: "服务", PRODUCT: "商品", MIXED: "混合", UNKNOWN: "未分类" };
const TREATMENT_LABELS: Record<string, string> = { AUTO: "自动", STANDALONE: "独立计入", PROJECT_INCLUDED: "并入项目", EXCLUDED: "排除" };
const DELIVERY_LABELS: Record<string, string> = { PENDING: "未交付", PARTIAL: "部分交付", DELIVERED: "已交付", WAIVED: "无需交付" };
const MATCH_LABELS: Record<string, string> = { UNMATCHED: "未匹配", AUTO_MATCHED: "自动匹配", MANUAL_MATCHED: "人工匹配", CONFLICT: "冲突" };

const FILTER_OPTIONS: Record<string, { value: string; label: string }[]> = {
  source: [{ value: "", label: "全部来源" }, { value: "MANUAL", label: "手动" }, { value: "PINGOODMICE", label: "平台导入" }, { value: "OTHER_IMPORT", label: "外部导入" }],
  status: [{ value: "", label: "全部状态" }, { value: "DRAFT", label: "草稿" }, { value: "CONFIRMED", label: "已确认" }, { value: "CANCELLED", label: "已取消" }, { value: "CLOSED", label: "已关闭" }],
  deliveryStatus: [{ value: "", label: "全部交付" }, { value: "PENDING", label: "未交付" }, { value: "PARTIAL", label: "部分交付" }, { value: "DELIVERED", label: "已交付" }, { value: "WAIVED", label: "无需交付" }],
  category: [{ value: "", label: "全部分类" }, { value: "SERVICE", label: "服务" }, { value: "PRODUCT", label: "商品" }, { value: "MIXED", label: "混合" }, { value: "UNKNOWN", label: "未分类" }],
  customerMatchStatus: [{ value: "", label: "全部匹配" }, { value: "UNMATCHED", label: "未匹配" }, { value: "AUTO_MATCHED", label: "自动匹配" }, { value: "MANUAL_MATCHED", label: "人工匹配" }, { value: "CONFLICT", label: "冲突" }],
  financeTreatment: [{ value: "", label: "全部口径" }, { value: "AUTO", label: "自动" }, { value: "STANDALONE", label: "独立计入" }, { value: "PROJECT_INCLUDED", label: "并入项目" }, { value: "EXCLUDED", label: "排除" }],
};

const BADGE_VARIANT: Record<string, string> = { CONFIRMED: "default", DRAFT: "secondary", CANCELLED: "destructive", CLOSED: "outline", DELIVERED: "default", PENDING: "secondary", PARTIAL: "outline", WAIVED: "outline" };

function FilterSelect({ value, onChange, opts, className }: { value: string; onChange: (v: string) => void; opts: { value: string; label: string }[]; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => { if (v != null) onChange(v); }}>
      <SelectTrigger className={`h-9 text-xs ${className || ""}`}>
        <SelectDisplay label={opts[0].label} valueLabel={opts.find(o => o.value === value)?.label} />
      </SelectTrigger>
      <SelectContent>
        {opts.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
      </SelectContent>
    </Select>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function getOrderCrmLink(order: Record<string, any>): { href: string | null; label: string } {
  const cust = order.customer as Record<string, any> | null;
  const crmProfile = cust?.crmProfile as Record<string, any> | null | undefined;
  if (crmProfile?.sourceCustomerId) {
    return { href: `/crm/customers/${crmProfile.sourceCustomerId}`, label: "CRM" };
  }
  if (cust?.name) {
    return { href: `/crm/customers?search=${encodeURIComponent(cust.name)}`, label: "CRM" };
  }
  return { href: null, label: "未绑定" };
}

interface OrderRow {
  id: string;
  orderNo: string;
  externalOrderNo?: string;
  title: string;
  buyerNameSnapshot?: string | null;
  buyerOrgNameSnapshot?: string | null;
  financeAmountOverride?: number | null;
  totalAmount?: number | null;
  _count?: { lines?: number; receipts?: number };
  invoiceRequests?: Array<{ status: string }>;
  invoiceCoverage?: Array<{ invoiceRequest?: { status?: string } }>;
  mergeSources?: Array<{ targetOrderId: string }>;
  mergedIntoId?: string | null;
}

function getOrderEffectiveInvoiceStatus(o: OrderRow): boolean {
  if (o.invoiceRequests && o.invoiceRequests.length > 0) return true;
  if (o.invoiceCoverage && o.invoiceCoverage.some((c) => c.invoiceRequest?.status !== "CANCELLED")) return true;
  return false;
}

function buildBatchInvoiceDefaults(selected: OrderRow[]) {
  const names = [...new Set(selected.map((o) => o.buyerNameSnapshot).filter(Boolean))];
  const orgs = [...new Set(selected.map((o) => o.buyerOrgNameSnapshot).filter(Boolean))];
  const products = [...new Set(selected.map((o) => o.title).filter(Boolean))];
  const master = selected[0];

  return {
    contactName: names[0] || "",
    buyerOrgName: orgs[0] || "",
    contentSummary: products.join("、"),
    remark: `合并开票订单：${selected.map((o) => o.externalOrderNo || o.orderNo).join("、")}`,
    items: selected.map((o) => ({
      itemName: o.title || o.externalOrderNo || o.orderNo,
      spec: "",
      unit: "",
      quantity: String(o._count?.lines || 1),
      amount: String((o.financeAmountOverride || o.totalAmount) || 0),
    })),
    masterOrderId: master.id,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function OrdersContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const { data: session, status: authStatus } = useSession();
  const role = session?.user?.role;
  const isAdmin = role === "ADMIN";

  const [search, setSearch] = useState(sp.get("search") || "");
  const [source, setSource] = useState(sp.get("source") || "");
  const [status, setStatus] = useState(sp.get("status") || "");
  const [deliveryStatus, setDeliveryStatus] = useState(sp.get("deliveryStatus") || "");
  const [category, setCategory] = useState(sp.get("category") || "");
  const [matchStatus, setMatchStatus] = useState(sp.get("customerMatchStatus") || "");
  const [treatment, setTreatment] = useState(sp.get("financeTreatment") || "");
  const [page, setPage] = useState(Number(sp.get("page")) || 1);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [projectDialogOrderId, setProjectDialogOrderId] = useState<string | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchInvoiceOpen, setBatchInvoiceOpen] = useState(false);
  const [batchInvoiceDefaults, setBatchInvoiceDefaults] = useState<Record<string, unknown>>({});
  const [batchInvoiceExtraPayload, setBatchInvoiceExtraPayload] = useState<Record<string, unknown>>({});
  const [deleteRunning, setDeleteRunning] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllPage = () => {
    setSelectedIds(new Set(orders.map((o) => o.id as string)));
  };

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Clear selection when filters/page change
  const searchRef = useRef(search);
  const sourceRef = useRef(source);
  const statusRef = useRef(status);
  const deliveryRef = useRef(deliveryStatus);
  const categoryRef = useRef(category);
  const matchRef = useRef(matchStatus);
  const treatmentRef = useRef(treatment);
  const pageRef = useRef(page);

  useEffect(() => {
    const changed =
      search !== searchRef.current || source !== sourceRef.current ||
      status !== statusRef.current || deliveryStatus !== deliveryRef.current ||
      category !== categoryRef.current || matchStatus !== matchRef.current ||
      treatment !== treatmentRef.current || page !== pageRef.current;
    if (changed) {
      clearSelection();
      searchRef.current = search;
      sourceRef.current = source;
      statusRef.current = status;
      deliveryRef.current = deliveryStatus;
      categoryRef.current = category;
      matchRef.current = matchStatus;
      treatmentRef.current = treatment;
      pageRef.current = page;
    }
  }, [search, source, status, deliveryStatus, category, matchStatus, treatment, page, clearSelection]);

  // Sync filters to URL
  useEffect(() => {
    if (!canAccessOrders(role)) return;
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (source) p.set("source", source);
    if (status) p.set("status", status);
    if (deliveryStatus) p.set("deliveryStatus", deliveryStatus);
    if (category) p.set("category", category);
    if (matchStatus) p.set("customerMatchStatus", matchStatus);
    if (treatment) p.set("financeTreatment", treatment);
    if (page > 1) p.set("page", String(page));
    const qs = p.toString();
    router.replace(qs ? `/orders?${qs}` : "/orders", { scroll: false });
  }, [search, source, status, deliveryStatus, category, matchStatus, treatment, page, router, role]);

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

  useEffect(() => {
    if (authStatus !== "authenticated" || !canAccessOrders(role)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrders();
  }, [authStatus, fetchOrders, role]);

  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    setPage(1);
  }, [search, source, status, deliveryStatus, category, matchStatus, treatment]);

  if (authStatus === "loading") return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (authStatus === "unauthenticated") { router.push("/login"); return null; }
  if (!canAccessOrders(role)) { router.push("/dashboard"); return null; }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const getVariant = (v: string) => (BADGE_VARIANT[v] || "secondary") as "default" | "secondary" | "destructive" | "outline";

  const activeFilters = [
    { key: "source", value: source, label: getOrderSourcePublicLabel(source) },
    { key: "status", value: status, label: STATUS_LABELS[status] || status },
    { key: "deliveryStatus", value: deliveryStatus, label: DELIVERY_LABELS[deliveryStatus] || deliveryStatus },
    { key: "category", value: category, label: CATEGORY_LABELS[category] || category },
    { key: "customerMatchStatus", value: matchStatus, label: MATCH_LABELS[matchStatus] || matchStatus },
    { key: "financeTreatment", value: treatment, label: TREATMENT_LABELS[treatment] || treatment },
  ].filter(f => !!f.value);
  const hasAnyFilter = !!search || activeFilters.length > 0;

  function clearFilters() {
    setSearch("");
    setSource("");
    setStatus("");
    setDeliveryStatus("");
    setCategory("");
    setMatchStatus("");
    setTreatment("");
  }

  function removeFilter(key: string) {
    const setters: Record<string, (v: string) => void> = {
      source: setSource, status: setStatus, deliveryStatus: setDeliveryStatus,
      category: setCategory, customerMatchStatus: setMatchStatus, financeTreatment: setTreatment,
    };
    setters[key]?.("");
  }

  // Shared filter controls for both desktop and mobile
  const FilterControls = (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">来源</label>
        <FilterSelect value={source} onChange={setSource} opts={FILTER_OPTIONS.source} className="w-full" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">状态</label>
        <FilterSelect value={status} onChange={setStatus} opts={FILTER_OPTIONS.status} className="w-full" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">交付</label>
        <FilterSelect value={deliveryStatus} onChange={setDeliveryStatus} opts={FILTER_OPTIONS.deliveryStatus} className="w-full" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">分类</label>
        <FilterSelect value={category} onChange={setCategory} opts={FILTER_OPTIONS.category} className="w-full" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">匹配</label>
        <FilterSelect value={matchStatus} onChange={setMatchStatus} opts={FILTER_OPTIONS.customerMatchStatus} className="w-full" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">口径</label>
        <FilterSelect value={treatment} onChange={setTreatment} opts={FILTER_OPTIONS.financeTreatment} className="w-full" />
      </div>
      {hasAnyFilter && (
        <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => { clearFilters(); setFilterSheetOpen(false); }}>
          <X className="h-3 w-3 mr-1" />清除全部筛选
        </Button>
      )}
    </div>
  );

  // ── Batch action helpers ────────────────────────────────────────────────

  function launchBatchInvoice() {
    const selected = orders.filter((o) => selectedIds.has(o.id as string)) as unknown as OrderRow[];
    if (selected.length === 0) return;

    // Pre-flight: reject merged orders
    const merged = selected.filter((o) => o.mergeSources && o.mergeSources.length > 0);
    if (merged.length > 0) {
      toast.error(`以下订单已合并，无法开票：${merged.map((o) => o.externalOrderNo || o.orderNo).join("、")}`);
      return;
    }

    // Pre-flight: reject orders with active invoices
    const already = selected.filter((o) => getOrderEffectiveInvoiceStatus(o));
    if (already.length > 0) {
      toast.error(`以下订单已有有效开票：${already.map((o) => o.externalOrderNo || o.orderNo).join("、")}`);
      return;
    }

    const defaults = buildBatchInvoiceDefaults(selected);
    const allIds = selected.map((o) => o.id);

    setBatchInvoiceDefaults({
      contactName: defaults.contactName,
      buyerOrgName: defaults.buyerOrgName,
      contentSummary: defaults.contentSummary,
      remark: defaults.remark,
      items: defaults.items,
    });
    setBatchInvoiceExtraPayload({
      orderId: defaults.masterOrderId,
      ...(selected.length >= 2 ? { coveredOrderIds: allIds } : {}),
    });
    setBatchInvoiceOpen(true);
  }

  async function handleBatchDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`确认删除 ${ids.length} 条订单？已有开票/回款/成本记录的订单不会被删除。`)) return;

    setDeleteRunning(true);
    try {
      const res = await fetch("/api/orders/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: ids }),
      });
      const data = await res.json();
      if (res.ok) {
        const skipped = data.skipped as Array<{ orderId: string; orderNo: string; reason: string }> || [];
        if (skipped.length > 0) {
          toast.warning(`已删除 ${data.deletedCount} 条，${skipped.length} 条未删除`, {
            description: skipped.map((s) => `${s.orderNo}: ${s.reason}`).join("；"),
            duration: 8000,
          });
        } else {
          toast.success(`已删除 ${data.deletedCount} 条订单`);
        }
        clearSelection();
        fetchOrders();
      } else {
        toast.error(data.error || "批量删除失败");
      }
    } catch {
      toast.error("批量删除请求失败");
    } finally {
      setDeleteRunning(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const showBatchBar = selectedIds.size > 0 && isAdmin;

  return (
    <div className="p-4 md:p-6 2xl:px-8 space-y-4 w-full">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">订单管理</h1>
        {isAdmin && (
          <div className="flex gap-2">
            <Link href="/orders/new"><Button>新建服务订单</Button></Link>
            <Link href="/orders/import"><Button variant="outline">导入订单列表</Button></Link>
          </div>
        )}
      </div>

      {/* Filters — Desktop */}
      <div className="hidden md:block space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[280px] max-w-[480px]">
            <Input placeholder="搜索订单号/客户/电话..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-9" />
          </div>
          <FilterSelect value={source} onChange={setSource} opts={FILTER_OPTIONS.source} />
          <FilterSelect value={status} onChange={setStatus} opts={FILTER_OPTIONS.status} />
          <FilterSelect value={deliveryStatus} onChange={setDeliveryStatus} opts={FILTER_OPTIONS.deliveryStatus} />
          <FilterSelect value={category} onChange={setCategory} opts={FILTER_OPTIONS.category} />
          <FilterSelect value={matchStatus} onChange={setMatchStatus} opts={FILTER_OPTIONS.customerMatchStatus} />
          <FilterSelect value={treatment} onChange={setTreatment} opts={FILTER_OPTIONS.financeTreatment} />
          {hasAnyFilter && (
            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={clearFilters}>
              <X className="h-3 w-3 mr-1" />重置
            </Button>
          )}
        </div>
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeFilters.map((f) => (
              <Badge key={f.key} variant="secondary" className="cursor-pointer text-xs gap-1" onClick={() => removeFilter(f.key)}>
                {f.label}
                <X className="h-3 w-3" />
              </Badge>
            ))}
            {activeFilters.length > 0 && (
              <Button variant="ghost" size="sm" className="h-6 text-xs px-1" onClick={clearFilters}>清除全部</Button>
            )}
          </div>
        )}
      </div>

      {/* Filters — Mobile */}
      <div className="md:hidden flex items-center gap-2">
        <div className="flex-1">
          <Input placeholder="搜索订单号/客户/电话..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-9" />
        </div>
        <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
          <SheetTrigger
            render={
              <Button variant="outline" size="sm" className="h-9 shrink-0">
                <Filter className="h-4 w-4 mr-1" />
                筛选{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
              </Button>
            }
          />
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
          >
            <SheetHeader>
              <SheetTitle>筛选条件</SheetTitle>
            </SheetHeader>
            <div className="mt-4 max-w-full overflow-x-hidden">
              {FilterControls}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Active filter chips — Mobile */}
      {activeFilters.length > 0 && (
        <div className="md:hidden flex flex-wrap gap-1.5">
          {activeFilters.map((f) => (
            <Badge key={f.key} variant="secondary" className="cursor-pointer text-xs gap-1" onClick={() => removeFilter(f.key)}>
              {f.label}
              <X className="h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}

      {/* Summary bar */}
      {!loading && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-2 flex-wrap">
          <span className="font-medium text-foreground">共 {total} 条</span>
          {source && <span>来源: {getOrderSourcePublicLabel(source)}</span>}
          {matchStatus === "UNMATCHED" && <span className="text-amber-600">待匹配</span>}
          {matchStatus === "CONFLICT" && <span className="text-red-600">冲突待确认</span>}
          {hasAnyFilter && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearFilters}>清除筛选</Button>
          )}
        </div>
      )}

      {/* Skeleton loading — Desktop */}
      {loading && (
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[1240px]">
            <thead><tr className="border-b text-left text-muted-foreground">
              <th className="p-2 w-[40px]" />
              <th className="p-2 w-[140px]">订单号</th><th className="p-2 w-[70px]">来源</th><th className="p-2 min-w-[180px]">标题/客户</th><th className="p-2 w-[100px]">金额</th><th className="p-2 w-[70px]">分类</th><th className="p-2 w-[70px]">状态</th><th className="p-2 w-[80px]">口径</th><th className="p-2 min-w-[120px]">项目</th><th className="p-2 w-[200px]">快捷入口</th>
            </tr></thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="p-2"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <div className="md:hidden space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </Card>
        ))}
      </div>}

      {/* Empty state */}
      {!loading && orders.length === 0 && (
        <div className="text-center text-muted-foreground py-12">暂无订单</div>
      )}

      {/* Data table */}
      {!loading && orders.length > 0 && (
        <>
          {/* Mobile: select-all row */}
          {isAdmin && (
            <div className="md:hidden flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="size-4 rounded accent-primary"
                checked={selectedIds.size === orders.length && orders.length > 0}
                onChange={() => selectedIds.size === orders.length ? clearSelection() : selectAllPage()}
              />
              <span>全选本页</span>
              {selectedIds.size > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearSelection}>清空选择</Button>
              )}
            </div>
          )}

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm min-w-[1240px]">
              <thead><tr className="border-b text-left text-muted-foreground">
                {isAdmin && (
                  <th className="p-2 w-[40px]">
                    <input
                      type="checkbox"
                      className="size-4 rounded accent-primary"
                      checked={selectedIds.size === orders.length && orders.length > 0}
                      onChange={() => selectedIds.size === orders.length ? clearSelection() : selectAllPage()}
                    />
                  </th>
                )}
                <th className="p-2 w-[140px]">订单号</th><th className="p-2 w-[70px]">来源</th><th className="p-2 min-w-[180px]">标题/客户</th><th className="p-2 w-[100px] text-right">金额</th><th className="p-2 w-[70px]">分类</th><th className="p-2 w-[70px]">状态</th><th className="p-2 w-[80px]">口径</th><th className="p-2 min-w-[120px]">项目</th><th className="p-2 w-[200px]">快捷入口</th>
              </tr></thead>
              <tbody>
                {orders.map((o: Record<string, unknown>) => {
                  const plinks = (o.projectLinks as Array<Record<string, unknown>>) || [];
                  const cust = o.customer as Record<string, unknown> | null;
                  const crmLink = getOrderCrmLink(o);
                  const orderId = o.id as string;
                  const extNo = (o.externalOrderNo || o.orderNo) as string;
                  const sel = selectedIds.has(orderId);
                  return (
                    <tr key={orderId} className={`border-b hover:bg-muted/50 cursor-pointer ${sel ? "bg-primary/5" : ""}`} onClick={() => router.push(`/orders/${orderId}`)}>
                      {isAdmin && (
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="size-4 rounded accent-primary"
                            checked={sel}
                            onChange={() => toggleSelect(orderId)}
                          />
                        </td>
                      )}
                      <td className="p-2 font-mono text-xs truncate" title={extNo}>{extNo}</td>
                      <td className="p-2 text-xs">{getOrderSourceDisplay(o.source as string, (o as Record<string, unknown>).sourceRemark as string | null)}</td>
                      <td className="p-2 max-w-[220px]">
                        <div className="truncate font-medium" title={o.title as string}>{o.title as string}</div>
                        <div className="text-xs text-muted-foreground truncate" title={(cust?.name || o.buyerNameSnapshot) as string}>{(cust?.name || o.buyerNameSnapshot) as string || "-"}</div>
                      </td>
                      <td className="p-2 text-right tabular-nums">¥{((o.financeAmountOverride || o.totalAmount) as number || 0).toLocaleString()}</td>
                      <td className="p-2"><Badge variant="outline" className="text-xs">{CATEGORY_LABELS[o.category as string] || (o.category as string)}</Badge></td>
                      <td className="p-2"><Badge variant={getVariant(o.status as string)} className="text-xs">{STATUS_LABELS[o.status as string] || (o.status as string)}</Badge></td>
                      <td className="p-2"><Badge variant="outline" className="text-xs">{TREATMENT_LABELS[o.financeTreatment as string] || (o.financeTreatment as string)}</Badge></td>
                      <td className="p-2 text-xs max-w-[140px] truncate" title={plinks.map((l) => (l.project as Record<string, unknown>)?.name).filter(Boolean).join(", ") || undefined}>{plinks.map((l) => (l.project as Record<string, unknown>)?.name).filter(Boolean).join(", ") || "-"}</td>
                      <td className="p-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {plinks.length > 0 ? (
                            <Link href={`/projects/${(plinks[0].project as Record<string, unknown>)?.id}`} onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" variant="outline" className="h-7 text-xs">
                                <FolderTree className="h-3 w-3 mr-0.5" />项目{plinks.length > 1 ? ` +${plinks.length - 1}` : ""}
                              </Button>
                            </Link>
                          ) : (
                            isAdmin && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setProjectDialogOrderId(orderId); }}>
                                <FolderTree className="h-3 w-3 mr-0.5" />关联项目
                              </Button>
                            )
                          )}
                          <Link href={`/finance/invoices?orderId=${orderId}`} onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" className="h-7 text-xs">
                              <Receipt className="h-3 w-3 mr-0.5" />财务
                            </Button>
                          </Link>
                          {crmLink.href ? (
                            <Link href={crmLink.href} onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" variant="outline" className="h-7 text-xs">
                                <UserRound className="h-3 w-3 mr-0.5" />{crmLink.label}
                              </Button>
                            </Link>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled>{crmLink.label}</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {orders.map((o: Record<string, unknown>) => {
              const plinks = (o.projectLinks as Array<Record<string, unknown>>) || [];
              const crmLink = getOrderCrmLink(o);
              const orderId = o.id as string;
              const sel = selectedIds.has(orderId);
              return (
                <Card key={orderId} className={`p-3 cursor-pointer ${sel ? "ring-2 ring-primary bg-primary/5" : ""}`} onClick={() => router.push(`/orders/${orderId}`)}>
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <input
                        type="checkbox"
                        className="size-4 rounded accent-primary shrink-0"
                        checked={sel}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(orderId)}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs truncate">{(o.externalOrderNo || o.orderNo) as string}</span>
                        <Badge variant={getVariant(o.status as string)} className="text-xs shrink-0 ml-2">{STATUS_LABELS[o.status as string] || (o.status as string)}</Badge>
                      </div>
                      <div className="text-sm font-medium mt-1 truncate">{o.title as string}</div>
                      <div className="text-xs text-muted-foreground truncate">{((o.customer as Record<string, unknown>)?.name as string) || (o.buyerNameSnapshot as string) || "无客户"}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="font-medium">¥{((o.financeAmountOverride || o.totalAmount) as number || 0).toLocaleString()}</span>
                        <div className="flex gap-1">
                          <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[o.category as string] || (o.category as string)}</Badge>
                          <Badge variant="outline" className="text-xs">{DELIVERY_LABELS[o.deliveryStatus as string] || (o.deliveryStatus as string)}</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 mt-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                    {plinks.length > 0 ? (
                      <Link href={`/projects/${(plinks[0].project as Record<string, unknown>)?.id}`} className="flex-1">
                        <Button size="sm" variant="outline" className="w-full h-7 text-xs">
                          <FolderTree className="h-3 w-3 mr-0.5" />项目{plinks.length > 1 ? ` +${plinks.length - 1}` : ""}
                        </Button>
                      </Link>
                    ) : (
                      isAdmin && (
                        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => setProjectDialogOrderId(orderId)}>
                          <FolderTree className="h-3 w-3 mr-0.5" />关联项目
                        </Button>
                      )
                    )}
                    <Link href={`/finance/invoices?orderId=${orderId}`} className="flex-1">
                      <Button size="sm" variant="outline" className="w-full h-7 text-xs">
                        <Receipt className="h-3 w-3 mr-0.5" />财务
                      </Button>
                    </Link>
                    {crmLink.href ? (
                      <Link href={crmLink.href} className="flex-1">
                        <Button size="sm" variant="outline" className="w-full h-7 text-xs">
                          <UserRound className="h-3 w-3 mr-0.5" />{crmLink.label}
                        </Button>
                      </Link>
                    ) : (
                      <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" disabled>{crmLink.label}</Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Bottom spacer for batch bar */}
          {showBatchBar && <div className="h-20 md:h-16" />}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-muted-foreground">共 {total} 条</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
                <span className="text-sm">第 {page}/{totalPages} 页</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Floating batch action bar — Desktop */}
      {showBatchBar && (
        <div className="hidden md:flex fixed bottom-4 right-4 z-40 items-center gap-3 bg-background border shadow-lg rounded-lg px-4 py-3">
          <span className="text-sm font-medium">已选 {selectedIds.size} 条</span>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={launchBatchInvoice}>
            <FileText className="h-3 w-3 mr-1" />批量开票
          </Button>
          <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={handleBatchDelete} disabled={deleteRunning}>
            <Trash2 className="h-3 w-3 mr-1" />批量删除
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearSelection}>
            <X className="h-3 w-3 mr-1" />清空
          </Button>
        </div>
      )}

      {/* Floating batch action bar — Mobile */}
      {showBatchBar && (
        <div
          className="md:hidden fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 flex items-center gap-2 bg-background border-t shadow-lg px-3 py-2"
        >
          <span className="text-xs font-medium shrink-0">已选 {selectedIds.size}</span>
          <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={launchBatchInvoice}>
            <FileText className="h-3 w-3 mr-1" />开票
          </Button>
          <Button size="sm" variant="destructive" className="h-7 text-xs flex-1" onClick={handleBatchDelete} disabled={deleteRunning}>
            <Trash2 className="h-3 w-3 mr-1" />删除
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={clearSelection}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Invoice form dialog for batch invoice */}
      <InvoiceFormDialog
        open={batchInvoiceOpen}
        onOpenChange={(open) => {
          if (!open) { setBatchInvoiceDefaults({}); setBatchInvoiceExtraPayload({}); }
          setBatchInvoiceOpen(open);
        }}
        editingInvoice={null}
        createUrl="/api/finance/order-invoices"
        patchUrlPrefix="/api/finance/order-invoices"
        onSuccess={() => { setBatchInvoiceOpen(false); clearSelection(); fetchOrders(); }}
        defaultValues={batchInvoiceDefaults}
        extraPayload={batchInvoiceExtraPayload}
        showProjectCode={false}
        aiDraftUrl={null}
      />

      {projectDialogOrderId && (
        <ProjectBindDialog
          open={!!projectDialogOrderId}
          onOpenChange={(open) => { if (!open) setProjectDialogOrderId(null); }}
          orderId={projectDialogOrderId}
          onBound={() => { fetchOrders(); setProjectDialogOrderId(null); }}
        />
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
