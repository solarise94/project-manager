"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectDisplay } from "@/components/ui/select";
import { ProjectBindDialog } from "@/components/finance/project-bind-dialog";
import { CustomerMatchDialog } from "@/components/finance/customer-match-dialog";
import { InvoiceFormDialog } from "@/components/invoice-form-dialog";
import type { InvoiceRecord } from "@/components/invoice-form-dialog";
import { CostFormDialog } from "@/components/finance/cost-form-dialog";
import { ReceiptFormDialog } from "@/components/finance/receipt-form-dialog";
import { UploadIssuedInvoiceDialog } from "@/components/finance/upload-issued-invoice-dialog";
import { FolderTree, Receipt, Banknote, UserRound, Pencil, Link2, Plus, Upload, RotateCcw, Ban, Eye } from "lucide-react";
import { OrderEditDialog } from "@/components/orders/order-edit-dialog";
import { canAccessOrders } from "@/lib/role-guards";
import { getCustomerOrganizationName } from "@/lib/customer-organization";

const SOURCE_LABELS: Record<string, string> = { MANUAL: "手动", PINGOODMICE: "拼好鼠", OTHER_IMPORT: "其他导入" };
const STATUS_LABELS: Record<string, string> = { DRAFT: "草稿", CONFIRMED: "已确认", CANCELLED: "已取消", CLOSED: "已关闭" };
const CATEGORY_LABELS: Record<string, string> = { SERVICE: "服务", PRODUCT: "商品", MIXED: "混合", UNKNOWN: "未分类" };
const TREATMENT_LABELS: Record<string, string> = { AUTO: "自动", STANDALONE: "独立计入", PROJECT_INCLUDED: "并入项目", EXCLUDED: "排除" };
const DELIVERY_LABELS: Record<string, string> = { PENDING: "未交付", PARTIAL: "部分交付", DELIVERED: "已交付", WAIVED: "无需交付" };
const MATCH_LABELS: Record<string, string> = { UNMATCHED: "未匹配", AUTO_MATCHED: "自动匹配", MANUAL_MATCHED: "人工匹配", CONFLICT: "冲突" };
const RELATION_LABELS: Record<string, string> = { GENERATED: "生成", LINKED: "关联", SPLIT: "拆分", SUPPLEMENT: "补充" };

export default function OrderDetailPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { status: authStatus, data: session } = useSession();
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [invoices, setInvoices] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab") || "";
  const urlAction = searchParams.get("action") || "";

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [customerMatchOpen, setCustomerMatchOpen] = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(urlAction === "invoice");
  const [costDialogOpen, setCostDialogOpen] = useState(urlAction === "cost");
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [refundingAdvanceId, setRefundingAdvanceId] = useState<string | null>(null);
  const [advances, setAdvances] = useState<Array<Record<string, unknown>>>([]);
  const [advanceForm, setAdvanceForm] = useState({ amount: "", remark: "" });
  const [refundForm, setRefundForm] = useState({ amount: "", remark: "", receiptId: "" });
  const [eligibleReceipts, setEligibleReceipts] = useState<Array<Record<string, unknown>>>([]);
  const [advanceSubmitting, setAdvanceSubmitting] = useState(false);

  // Edit invoice state (for DRAFT edit and reissue → review)
  const editFromUrl = urlAction === "edit-invoice" ? searchParams.get("invoiceId") : null;
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(editFromUrl);
  const [reissueFromInvoiceId, setReissueFromInvoiceId] = useState<string | null>(null);
  const [reissueReason, setReissueReason] = useState<string | null>(null);
  const { data: editingInvoice, error: editError } = useQuery<InvoiceRecord>({
    queryKey: ["order", "invoice", editingInvoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/finance/order-invoices/${editingInvoiceId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `加载失败 (${res.status})`);
      }
      return (await res.json()).invoice;
    },
    enabled: !!editingInvoiceId,
    retry: false,
  });
  useEffect(() => {
    if (!editError || !editingInvoiceId) return;
    alert(editError.message || "发票详情加载失败");
    /* eslint-disable react-hooks/set-state-in-effect */
    setEditingInvoiceId(null);
    setReissueFromInvoiceId(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (urlAction) router.replace(`/orders/${id}?tab=${urlTab || "overview"}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editError, editingInvoiceId]);

  // Issue invoice state (for REQUESTED → ISSUED upload)
  const issueFromUrl = urlAction === "issue" ? searchParams.get("invoiceId") : null;
  const [issueInvoiceId, setIssueInvoiceId] = useState<string | null>(issueFromUrl);

  // Strip action= param from URL when dialogs close to prevent re-opening on refresh
  const handleInvoiceOpenChange = (open: boolean) => {
    setInvoiceDialogOpen(open);
    if (!open && urlAction) router.replace(`/orders/${id}?tab=${urlTab || "overview"}`, { scroll: false });
  };
  const handleCostOpenChange = (open: boolean) => {
    setCostDialogOpen(open);
    if (!open && urlAction) router.replace(`/orders/${id}?tab=${urlTab || "overview"}`, { scroll: false });
  };
  const handleEditInvoiceOpenChange = (open: boolean) => {
    if (!open) {
      setEditingInvoiceId(null);
      setReissueFromInvoiceId(null);
      setReissueReason(null);
      if (urlAction) router.replace(`/orders/${id}?tab=${urlTab || "overview"}`, { scroll: false });
    }
  };
  const handleIssueInvoiceOpenChange = (open: boolean) => {
    if (!open) {
      setIssueInvoiceId(null);
      if (urlAction) router.replace(`/orders/${id}?tab=${urlTab || "overview"}`, { scroll: false });
    }
  };

  const fetchAdvances = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/finance/advances?orderId=${id}`);
    if (res.ok) {
      const d = await res.json();
      setAdvances((d.advances || []) as Array<Record<string, unknown>>);
    }
  }, [id]);

  const createAdvance = async () => {
    const amt = parseFloat(advanceForm.amount);
    if (!amt || amt <= 0) return;
    setAdvanceSubmitting(true);
    try {
      const res = await fetch("/api/finance/advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, amount: amt, remark: advanceForm.remark || null }),
      });
      if (res.ok) { setAdvanceDialogOpen(false); setAdvanceForm({ amount: "", remark: "" }); fetchAdvances(); }
    } finally { setAdvanceSubmitting(false); }
  };

  const fetchEligibleReceipts = async (advanceId: string) => {
    const res = await fetch(`/api/finance/advances/${advanceId}/eligible-receipts`);
    if (res.ok) {
      const d = await res.json();
      setEligibleReceipts((d.eligible || []) as Array<Record<string, unknown>>);
    }
  };

  const openRefundDialog = (advanceId: string, maxAmount: number) => {
    setRefundingAdvanceId(advanceId);
    setRefundForm({ amount: String(maxAmount), remark: "", receiptId: "" });
    setEligibleReceipts([]);
    fetchEligibleReceipts(advanceId);
  };

  const createRefund = async () => {
    let amt = parseFloat(refundForm.amount);
    if (!amt || amt <= 0 || !refundingAdvanceId) return;
    if (!refundForm.receiptId) { alert("请先选择对应回款记录"); return; }
    const selected = eligibleReceipts.find((e) => e.id === refundForm.receiptId);
    if (!selected) { alert("所选回款记录无效"); return; }
    const maxAvailable = (selected.availableForRefund as number) || 0;
    if (amt > maxAvailable) {
      if (!confirm(`退款金额超过该回款可用余额（¥${maxAvailable.toLocaleString()}），已自动调整为上限并继续提交。`)) return;
      amt = maxAvailable;
      setRefundForm((prev) => ({ ...prev, amount: String(maxAvailable) }));
    }
    setAdvanceSubmitting(true);
    try {
      const res = await fetch(`/api/finance/advances/${refundingAdvanceId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt, remark: refundForm.remark || null, settledByReceiptId: refundForm.receiptId }),
      });
      if (res.ok) { setRefundingAdvanceId(null); setRefundForm({ amount: "", remark: "", receiptId: "" }); setEligibleReceipts([]); fetchAdvances(); }
      else { const d = await res.json(); alert(d.error || "退款失败"); }
    } finally { setAdvanceSubmitting(false); }
  };

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/orders/${id}`);
    if (res.status === 401) { router.push("/login"); return; }
    if (res.status === 403) { router.push("/dashboard"); return; }
    if (res.ok) { const d = await res.json(); setOrder(d?.order || null); setInvoices((d?.invoices || []) as Array<Record<string, unknown>>); }
    setLoading(false);
  }, [id, router]);

  const handleCancelInvoice = async (invoiceId: string) => {
    if (!confirm("确定要取消这张发票申请吗？")) return;
    const res = await fetch(`/api/finance/order-invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      fetchOrder();
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
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      fetchOrder();
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
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      fetchOrder();
    } else {
      const d = await res.json();
      alert(d.error || "冲红失败");
    }
  };

  const handleReissueInvoice = async (invoiceId: string) => {
    const reason = prompt("请输入重开原因（可选）：");
    if (reason === null) return; // user cancelled the prompt
    setReissueFromInvoiceId(invoiceId);
    setReissueReason(reason || null);
    setEditingInvoiceId(invoiceId);
  };

  useEffect(() => {
    if (authStatus !== "authenticated" || !id || !canAccessOrders(session?.user?.role)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrder();
    fetchAdvances();
  }, [id, authStatus, fetchOrder, fetchAdvances, session?.user?.role]);

  const isAdmin = session?.user?.role === "ADMIN";

  if (authStatus === "loading") return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (authStatus === "unauthenticated") { router.push("/login"); return null; }
  if (!canAccessOrders(session?.user?.role)) { router.push("/dashboard"); return null; }
  if (loading) return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (!order) return <div className="p-8 text-muted-foreground">订单不存在</div>;

  const badgeVariant = (v: string) => {
    const m: Record<string, string> = { CONFIRMED: "default", DRAFT: "secondary", CANCELLED: "destructive", CLOSED: "outline", DELIVERED: "default", PENDING: "secondary", PARTIAL: "outline", WAIVED: "outline" };
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
  const custOrgName = cust ? getCustomerOrganizationName({ organization: cust.organization as string | null, org: cust.org as { canonicalName: string } | null | undefined }) : null;
  const rep = order.representative as Record<string, unknown> | null;
  const lines = (order.lines || []) as Array<Record<string, unknown>>;
  const projectLinks = (order.projectLinks || []) as Array<Record<string, unknown>>;
  const sourceRecords = (order.sourceRecords || []) as Array<Record<string, unknown>>;
  const statusHistory = (order.statusHistory || []) as Array<Record<string, unknown>>;
  const counts = order._count as Record<string, number> | null;
  const effectiveAmount = (order.financeAmountOverride as number) ?? (order.totalAmount as number) ?? 0;
  const crmProfile = cust?.crmProfile as Record<string, unknown> | null | undefined;

  const crmHref = crmProfile?.sourceCustomerId
    ? `/crm/customers/${crmProfile.sourceCustomerId}`
    : cust?.name ? `/crm/customers?search=${encodeURIComponent(cust.name as string)}` : null;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
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
          <Badge variant={badgeVariant(order.status as string)}>{STATUS_LABELS[order.status as string] || (order.status as string)}</Badge>
          <Badge variant={badgeVariant(order.deliveryStatus as string)}>交付: {DELIVERY_LABELS[order.deliveryStatus as string] || (order.deliveryStatus as string)}</Badge>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setEditDialogOpen(true)}>
            <Pencil className="h-3 w-3 mr-1" />编辑订单
          </Button>
        )}
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setCustomerMatchOpen(true)}>
            <Link2 className="h-3 w-3 mr-1" />{cust ? "重绑客户" : "绑定客户"}
          </Button>
        )}
        {projectLinks.length > 0 ? (
          <Link href={`/projects/${(projectLinks[0].project as Record<string, unknown>)?.id}`}>
            <Button size="sm" variant="outline"><FolderTree className="h-3 w-3 mr-1" />打开项目{projectLinks.length > 1 ? ` (+${projectLinks.length - 1})` : ""}</Button>
          </Link>
        ) : (
          isAdmin && <Button size="sm" variant="outline" onClick={() => setProjectDialogOpen(true)}><FolderTree className="h-3 w-3 mr-1" />关联项目</Button>
        )}
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setInvoiceDialogOpen(true)}>
            <Receipt className="h-3 w-3 mr-1" />新建发票
          </Button>
        )}
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setCostDialogOpen(true)}>
            <Banknote className="h-3 w-3 mr-1" />新增成本
          </Button>
        )}
        {crmHref ? (
          <Link href={crmHref}><Button size="sm" variant="outline"><UserRound className="h-3 w-3 mr-1" />CRM 档案</Button></Link>
        ) : (
          <Link href="/crm/customers"><Button size="sm" variant="outline"><UserRound className="h-3 w-3 mr-1" />客户档案库</Button></Link>
        )}
        {(order.source as string) === "PINGOODMICE" && (order.externalOrderNo as string) && (
          <Link href={`/finance/order-matching?search=${encodeURIComponent(order.externalOrderNo as string)}`}>
            <Button size="sm" variant="outline">匹配页</Button>
          </Link>
        )}
      </div>

      <Tabs defaultValue={urlTab || "overview"}>
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
            <div><span className="text-muted-foreground">来源</span><div>{SOURCE_LABELS[order.source as string] || (order.source as string)}</div></div>
            <div><span className="text-muted-foreground">分类</span><div><Badge variant="outline">{CATEGORY_LABELS[order.category as string] || (order.category as string)}</Badge></div></div>
            <div><span className="text-muted-foreground">订单金额</span><div className="font-medium">¥{(order.totalAmount as number || 0).toLocaleString()}</div></div>
            <div><span className="text-muted-foreground">有效财务金额</span><div className="font-medium">¥{effectiveAmount.toLocaleString()}</div></div>
            <div><span className="text-muted-foreground">下单日期</span><div>{(order.orderedAt as string)?.slice(0, 10) || "-"}</div></div>
            <div><span className="text-muted-foreground">确认日期</span><div>{(order.confirmedAt as string)?.slice(0, 10) || "-"}</div></div>
            <div><span className="text-muted-foreground">交付日期</span><div>{(order.deliveredAt as string)?.slice(0, 10) || "-"}</div></div>
            <div><span className="text-muted-foreground">计入口径</span><div><Badge variant="outline">{TREATMENT_LABELS[order.financeTreatment as string] || (order.financeTreatment as string)}</Badge></div></div>
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
            <div><span className="text-muted-foreground">匹配状态: </span><Badge variant="outline">{MATCH_LABELS[order.customerMatchStatus as string] || (order.customerMatchStatus as string)}</Badge></div>
            {cust ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">客户主数据:</span>
                  <Link href={`/customers?search=${encodeURIComponent(cust.name as string)}`} className="text-primary hover:underline font-medium">
                    {cust.name as string} ({cust.customerCode as string})
                  </Link>
                </div>
                {crmHref && (
                  <div>
                    <span className="text-muted-foreground">CRM 档案: </span>
                    <Link href={crmHref} className="text-primary hover:underline">
                      {crmProfile?.sourceCustomerId ? `查看 CRM 档案` : "搜索 CRM"}
                    </Link>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <div>收件人快照: {order.buyerNameSnapshot as string || "-"}</div>
                  <div>电话快照: {order.buyerPhoneSnapshot as string || "-"}</div>
                  <div>微信快照: {order.buyerWechatSnapshot as string || "-"}</div>
                  <div>单位快照: {order.buyerOrgNameSnapshot as string || "-"}</div>
                </div>
                {isAdmin && (
                  <div className="pt-2 border-t flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setCustomerMatchOpen(true)} disabled={saving}>重新绑定客户</Button>
                    <Button variant="outline" size="sm" onClick={() => saveField("customerId", null)} disabled={saving}>解除绑定</Button>
                  </div>
                )}
              </>
            ) : (
              <div>
                <div className="text-sm text-muted-foreground mb-2">暂无绑定客户</div>
                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground mb-2">
                  <div>收件人快照: {order.buyerNameSnapshot as string || "-"}</div>
                  <div>电话快照: {order.buyerPhoneSnapshot as string || "-"}</div>
                  <div>微信快照: {order.buyerWechatSnapshot as string || "-"}</div>
                  <div>单位快照: {order.buyerOrgNameSnapshot as string || "-"}</div>
                </div>
                {isAdmin && (
                  <div className="flex gap-2 items-center">
                    <Button size="sm" onClick={() => setCustomerMatchOpen(true)} disabled={saving}>
                      <Link2 className="h-3 w-3 mr-1" />绑定 / 新增客户
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="projects" className="space-y-3 mt-3">
          {projectLinks.length === 0 ? (
            <div className="text-muted-foreground text-sm space-y-2">
              <div>暂无关联项目</div>
              {isAdmin && <Button size="sm" variant="outline" onClick={() => setProjectDialogOpen(true)}><FolderTree className="h-3 w-3 mr-1" />关联项目</Button>}
            </div>
          ) : projectLinks.map((l: Record<string, unknown>) => {
            const prj = l.project as Record<string, unknown>;
            return (
              <Card key={l.id as string} className="p-3 text-sm flex justify-between items-center">
                <div>
                  <div className="font-medium"><Link href={`/projects/${prj?.id}`} className="text-primary hover:underline">{prj?.name as string}</Link></div>
                  <div className="text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs mr-1">{RELATION_LABELS[l.relationType as string] || (l.relationType as string) || "关联"}</Badge>
                    <Badge variant="outline" className="text-xs">{TREATMENT_LABELS[l.treatment as string] || (l.treatment as string)}</Badge>
                    {l.allocatedAmount != null ? ` 分摊: ¥${(l.allocatedAmount as number).toLocaleString()}` : ""}
                    {l.isPrimary ? " ★主" : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Link href={`/projects/${prj?.id}`}><Button variant="outline" size="sm">打开项目</Button></Link>
                  {isAdmin && <Button variant="outline" size="sm" onClick={async () => { await fetch(`/api/orders/${id}/project-links/${l.id}`, { method: "DELETE" }); fetchOrder(); }}>解绑</Button>}
                </div>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="finance" className="space-y-3 mt-3">
          {/* Financial settings */}
          <Card className="p-4 text-sm space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24 shrink-0">分类:</span>
              {isAdmin ? (
                <Select value={(order.category as string) || "UNKNOWN"} onValueChange={(v) => { if (v) saveField("category", v); }}>
                  <SelectTrigger className="w-32"><SelectDisplay label="未分类" valueLabel={CATEGORY_LABELS[(order.category as string)] || (order.category as string)} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNKNOWN">未分类</SelectItem>
                    <SelectItem value="PRODUCT">商品</SelectItem>
                    <SelectItem value="SERVICE">服务</SelectItem>
                    <SelectItem value="MIXED">混合</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span>{CATEGORY_LABELS[(order.category as string)] || (order.category as string) || "未分类"}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24 shrink-0">计入口径:</span>
              {isAdmin ? (
                <Select value={(order.financeTreatment as string) || "AUTO"} onValueChange={(v) => { if (v) saveField("financeTreatment", v); }}>
                  <SelectTrigger className="w-40"><SelectDisplay label="自动" valueLabel={TREATMENT_LABELS[(order.financeTreatment as string)] || (order.financeTreatment as string)} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTO">自动</SelectItem>
                    <SelectItem value="STANDALONE">独立计入</SelectItem>
                    <SelectItem value="PROJECT_INCLUDED">并入项目</SelectItem>
                    <SelectItem value="EXCLUDED">排除</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span>{TREATMENT_LABELS[(order.financeTreatment as string)] || (order.financeTreatment as string) || "自动"}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24 shrink-0">金额覆盖:</span>
              {isAdmin ? (
                <Input className="w-40" type="number" placeholder={String(order.totalAmount || 0)} defaultValue={(order.financeAmountOverride as number) || ""} onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; saveField("financeAmountOverride", v); }} />
              ) : (
                <span>{(order.financeAmountOverride as number) ?? (order.totalAmount as number) ?? 0}</span>
              )}
            </div>
            {(order.financeNote as string) && <div><span className="text-muted-foreground">备注: </span>{order.financeNote as string}</div>}
          </Card>

          {/* Invoices section */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">发票</h3>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setInvoiceDialogOpen(true)}>
                  <Plus className="h-3 w-3 mr-1" />新建订单发票
                </Button>
              )}
            </div>
            {invoices.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center space-y-2">
                <p>暂无发票申请</p>
                {isAdmin && (
                  <Button size="sm" onClick={() => setInvoiceDialogOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" />新建订单发票
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {invoices.map((inv: Record<string, unknown>) => {
                  const invStatus = (inv.status as string) || "";
                  const statusLabel: Record<string, string> = { DRAFT: "草稿", REQUESTED: "待开票", ISSUED: "已开票", CANCELLED: "已取消" };
                  const hasRed = (inv.adjustments as Array<Record<string, unknown>>)?.some((a) => a.kind === "RED");
                  const docCount = (inv._documentCount as number) || 0;
                  const actions: Array<{ label: string; icon: React.ReactNode; onClick: () => void; destructive?: boolean }> = [];
                   if (isAdmin) {
                    if (invStatus === "DRAFT") {
                      actions.push({ label: "编辑", icon: <Pencil className="h-3 w-3" />, onClick: () => setEditingInvoiceId(inv.id as string) });
                      actions.push({ label: "提交", icon: <Upload className="h-3 w-3" />, onClick: () => handleSubmitInvoice(inv.id as string) });
                      actions.push({ label: "取消", icon: <Ban className="h-3 w-3" />, onClick: () => handleCancelInvoice(inv.id as string), destructive: true });
                    } else if (invStatus === "REQUESTED") {
                      actions.push({ label: "登记已开票", icon: <Upload className="h-3 w-3" />, onClick: () => setIssueInvoiceId(inv.id as string) });
                      actions.push({ label: "取消", icon: <Ban className="h-3 w-3" />, onClick: () => handleCancelInvoice(inv.id as string), destructive: true });
                    } else if (invStatus === "ISSUED" && !hasRed) {
                      if (docCount === 0) {
                        actions.push({ label: "补传附件", icon: <Upload className="h-3 w-3" />, onClick: () => setIssueInvoiceId(inv.id as string) });
                      }
                      actions.push({ label: "冲红", icon: <RotateCcw className="h-3 w-3" />, onClick: () => handleRedInvoice(inv.id as string), destructive: true });
                      actions.push({ label: "重开", icon: <RotateCcw className="h-3 w-3" />, onClick: () => handleReissueInvoice(inv.id as string) });
                    }
                  }
                  return (
                    <div key={inv.id as string} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{(inv.invoiceType as string) === "SPECIAL" ? "专票" : "普票"}</span>
                        <span className="text-muted-foreground">{(inv.contentSummary as string) || "—"}</span>
                        {(inv.linkType as string) === "COVERAGE" && (
                          <Badge variant="outline" className="text-xs">合并</Badge>
                        )}
                        {(inv.isLegacyLinked as boolean) && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">历史</Badge>
                        )}
                        {hasRed && (
                          <Badge variant="outline" className="text-xs text-destructive">已冲红</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">¥{((inv.totalAmount as number) || 0).toLocaleString()}</span>
                        <Badge variant="outline" className="text-xs">{statusLabel[invStatus] || invStatus}</Badge>
                        <Link href={`/finance/invoices?orderId=${id}`} className="text-primary hover:underline text-xs">
                          <Eye className="h-3 w-3 inline mr-0.5" />查看
                        </Link>
                        {actions.map((a) => (
                          <Button
                            key={a.label}
                            size="sm"
                            variant="ghost"
                            className={`h-6 text-xs ${a.destructive ? "text-destructive hover:text-destructive" : ""}`}
                            onClick={(e) => { e.stopPropagation(); a.onClick(); }}
                          >
                            {a.icon}
                            {a.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Receipts section */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">回款</h3>
              {(isAdmin || session?.user?.role === "USER") && (
                <Button size="sm" variant="outline" onClick={() => setReceiptDialogOpen(true)}>
                  <Plus className="h-3 w-3 mr-1" />新增回款
                </Button>
              )}
            </div>
            {(() => {
              const receipts = (order.receipts as Array<Record<string, unknown>>) || [];
              if (receipts.length === 0) return <div className="text-sm text-muted-foreground py-4 text-center">暂无回款记录</div>;
              return (
                <div className="space-y-2">
                  {receipts.map((r: Record<string, unknown>) => (
                    <div key={r.id as string} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">¥{(r.amount as number || 0).toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground">{(r.source as string) || "人工录入"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {(r.remark as string) && <span>{(r.remark as string)}</span>}
                        <span>{(r.receivedAt as string)?.slice(0, 10) || ""}</span>
                        {Boolean(r.createdBy) && <span>{String(((r.createdBy as Record<string, unknown> | null) || {}).name || "")}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>

          {/* Costs section */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">成本</h3>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setCostDialogOpen(true)}>
                  <Plus className="h-3 w-3 mr-1" />新增成本
                </Button>
              )}
            </div>
            {(() => {
              const costs = (order.financeCosts as Array<Record<string, unknown>>) || [];
              if (costs.length === 0) {
                return (
                  <div className="text-sm text-muted-foreground py-6 text-center space-y-2">
                    <p>暂无成本记录</p>
                    {isAdmin && (
                      <Button size="sm" onClick={() => setCostDialogOpen(true)}>
                        <Plus className="h-3 w-3 mr-1" />新增订单成本
                      </Button>
                    )}
                  </div>
                );
              }
              return (
                <div className="space-y-2">
                  {costs.map((c: Record<string, unknown>, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                      <div>
                        <Badge variant="outline" className="text-xs mr-2">{(c.costType as string) || "其他"}</Badge>
                        <span className="text-muted-foreground">{(c.remark as string) || "—"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">¥{(c.amount as number || 0).toLocaleString()}</span>
                        <span>{(c.createdAt as string)?.slice(0, 10) || ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>

          {/* Advances section */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">客户垫付</h3>
              {(isAdmin || session?.user?.role === "USER") && (
                <Button size="sm" variant="outline" onClick={() => setAdvanceDialogOpen(true)}>
                  <Plus className="h-3 w-3 mr-1" />新增垫付
                </Button>
              )}
            </div>
            {advances.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                <p>暂无垫付记录</p>
              </div>
            ) : (
              <div className="space-y-2">
                {advances.map((a: Record<string, unknown>) => {
                  const refunds = (a.refunds as Array<Record<string, unknown>>) || [];
                  const totalRefunded = refunds.reduce((s, r) => s + (r.amount as number || 0), 0);
                  const remaining = (a.amount as number || 0) - totalRefunded;
                  const statusLabel = { HELD: "未退", PARTIAL_REFUNDED: "部分已退", REFUNDED: "已退", WRITTEN_OFF: "已核销" }[a.status as string] || (a.status as string);
                  return (
                    <div key={a.id as string} className="border rounded p-3 text-sm space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">¥{(a.amount as number || 0).toLocaleString()}</span>
                          <Badge variant="outline" className="text-xs">{statusLabel}</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">{(a.advancedAt as string)?.slice(0, 10) || ""}</span>
                      </div>
                      {(a.remark as string) && <div className="text-xs text-muted-foreground">备注: {a.remark as string}</div>}
                      {refunds.length > 0 && (
                        <div className="text-xs text-muted-foreground pl-2 border-l-2">
                          {refunds.map((r: Record<string, unknown>, ri: number) => (
                            <div key={ri}>退款 ¥{(r.amount as number || 0).toLocaleString()} ({(r.refundedAt as string)?.slice(0, 10) || ""})</div>
                          ))}
                        </div>
                      )}
                      {remaining > 0 && (isAdmin || session?.user?.role === "USER") && (
                        <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => openRefundDialog(a.id as string, remaining)}>
                          退款 (剩余 ¥{remaining.toLocaleString()})
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Customer finance link */}
          {!!cust?.id && (
            <Link href={`/finance/customers/${cust!.id}`}>
              <Card className="p-3 hover:bg-muted/50 transition-colors cursor-pointer text-sm">
                <div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" /><span className="font-medium">客户财务总览</span></div>
                <div className="text-xs text-muted-foreground mt-1">{cust!.name as string}</div>
              </Card>
            </Link>
          )}
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
                {h.oldStatus ? <Badge variant="outline" className="text-xs mr-1">{STATUS_LABELS[h.oldStatus as string] || (h.oldStatus as string)}</Badge> : null}
                {h.oldStatus ? " → " : ""}
                <Badge variant="outline" className="text-xs">{STATUS_LABELS[h.newStatus as string] || (h.newStatus as string)}</Badge>
                {h.note ? <span className="text-xs text-muted-foreground ml-2">{h.note as string}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">{(h.createdAt as string)?.slice(0, 16)}</div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {projectDialogOpen && (
        <ProjectBindDialog
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
          orderId={id}
          onBound={() => { fetchOrder(); setProjectDialogOpen(false); }}
        />
      )}
      <OrderEditDialog
        orderId={id}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onUpdated={() => fetchOrder()}
      />
      {customerMatchOpen && (
        <CustomerMatchDialog
          open={customerMatchOpen}
          onOpenChange={setCustomerMatchOpen}
          orderId={id}
          userId={session?.user?.id}
          orderPrefill={{
            receiverName: (order.buyerNameSnapshot as string) || null,
            receiverPhone: (order.buyerPhoneSnapshot as string) || null,
            orderUser: (order.buyerWechatSnapshot as string) || null,
            receiverAddress: (order.buyerAddressSnapshot as string) || null,
            storeName: (order.buyerOrgNameSnapshot as string) || null,
          }}
          onBound={() => fetchOrder()}
        />
      )}

      {/* Invoice dialog */}
      <InvoiceFormDialog
        open={invoiceDialogOpen}
        onOpenChange={handleInvoiceOpenChange}
        editingInvoice={null}
        createUrl="/api/finance/order-invoices"
        patchUrlPrefix="/api/finance/order-invoices"
        extraPayload={{ orderId: id, coveredOrderIds: [] }}
        showProjectCode={false}
        aiDraftUrl={null}
        defaultValues={{
          contactName: ((order.buyerNameSnapshot || cust?.name) as string) || undefined,
          buyerOrgName: ((order.buyerOrgNameSnapshot || custOrgName) as string) || undefined,
          buyerOrgId: (cust?.organizationId as string) || undefined,
          contentSummary: (order.title as string) || undefined,
          invoiceType: "NORMAL",
          items: (lines as Array<Record<string, unknown>>).length > 0
            ? (lines as Array<Record<string, unknown>>).map((l) => ({
                itemName: String(l.itemName || ""),
                spec: String(l.spec || ""),
                unit: String(l.unit || ""),
                quantity: String(l.quantity || ""),
                amount: String(l.amount || ""),
              }))
            : [{ itemName: (order.title as string) || "订单服务", spec: "", unit: "项", quantity: "1", amount: String(order.totalAmount || 0) }],
        }}
        onSuccess={() => fetchOrder()}
      />

      {/* Edit invoice dialog (DRAFT edit / reissue review) */}
      <InvoiceFormDialog
        open={!!editingInvoiceId}
        onOpenChange={handleEditInvoiceOpenChange}
        editingInvoice={editingInvoice || null}
        editingInvoiceId={editingInvoiceId}
        mode="edit"
        createUrl="/api/finance/order-invoices"
        patchUrlPrefix="/api/finance/order-invoices"
        extraPayload={undefined}
        showProjectCode={false}
        aiDraftUrl={null}
        reissueFromInvoiceId={reissueFromInvoiceId}
        reissueReason={reissueReason}
        onSuccess={() => { fetchOrder(); setEditingInvoiceId(null); setReissueFromInvoiceId(null); setReissueReason(null); }}
      />

      {/* Issue invoice dialog (REQUESTED → ISSUED upload) */}
      <UploadIssuedInvoiceDialog
        open={!!issueInvoiceId}
        onOpenChange={handleIssueInvoiceOpenChange}
        invoiceId={issueInvoiceId || ""}
        onSuccess={() => { fetchOrder(); queryClient.invalidateQueries({ queryKey: ["order", id] }); }}
      />

      {/* Cost dialog */}
      <CostFormDialog
        open={costDialogOpen}
        onOpenChange={handleCostOpenChange}
        defaultOrderId={id}
        defaultCustomerId={(cust?.id as string) || undefined}
        defaultProjectId={projectLinks.length === 1 ? ((projectLinks[0].project as Record<string, unknown>)?.id as string) : undefined}
        defaultAmount={(order.financeAmountOverride ?? order.totalAmount) as number | undefined}
        onCreated={() => fetchOrder()}
      />

      {/* Receipt dialog */}
      <ReceiptFormDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        defaultOrderId={id}
        onCreated={() => { fetchOrder(); fetchAdvances(); }}
      />

      {/* Advance create dialog */}
      <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>新增垫付</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>金额</Label>
              <Input type="number" step="0.01" value={advanceForm.amount} onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>备注</Label>
              <Input value={advanceForm.remark} onChange={(e) => setAdvanceForm({ ...advanceForm, remark: e.target.value })} placeholder="选填" />
            </div>
            <Button className="w-full" onClick={createAdvance} disabled={advanceSubmitting || !advanceForm.amount}>
              {advanceSubmitting ? "提交中..." : "确认"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Advance refund dialog */}
      <Dialog open={!!refundingAdvanceId} onOpenChange={(v) => { if (!v) { setRefundingAdvanceId(null); setEligibleReceipts([]); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>登记退款</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {eligibleReceipts.length === 0 && refundingAdvanceId && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                暂无可用回款记录。请先在本订单财务页新增回款。
              </div>
            )}
            <div className="space-y-1">
              <Label>对应回款</Label>
              <Select value={refundForm.receiptId} onValueChange={(v) => {
                const selected = eligibleReceipts.find((e) => e.id === v);
                const max = selected ? (selected.availableForRefund as number) : parseFloat(refundForm.amount);
                setRefundForm({ ...refundForm, receiptId: v || "", amount: String(Math.min(parseFloat(refundForm.amount) || max, max)) });
              }}>
                <SelectTrigger>
                  <span>{refundForm.receiptId
                    ? (() => { const r = eligibleReceipts.find((e) => e.id === refundForm.receiptId); return r ? `¥${(r.amount as number).toLocaleString()} (${(r.receivedAt as string)?.slice(0, 10) || ""})` : "选择回款"; })()
                    : <span className="text-muted-foreground">请选择回款记录</span>}</span>
                </SelectTrigger>
                <SelectContent>
                  {eligibleReceipts.map((r: Record<string, unknown>) => (
                    <SelectItem key={r.id as string} value={r.id as string}>
                      ¥{(r.amount as number).toLocaleString()} — {((r as Record<string, unknown>).customerName as string) || (r.orderNo as string) || (r.projectName as string) || ""} — 可退 ¥{(r.availableForRefund as number).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>退款金额</Label>
              <Input type="number" step="0.01" value={refundForm.amount} onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>备注</Label>
              <Input value={refundForm.remark} onChange={(e) => setRefundForm({ ...refundForm, remark: e.target.value })} placeholder="选填" />
            </div>
            <Button className="w-full" onClick={createRefund} disabled={advanceSubmitting || !refundForm.amount || !refundForm.receiptId}>
              {advanceSubmitting ? "提交中..." : "确认退款"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
