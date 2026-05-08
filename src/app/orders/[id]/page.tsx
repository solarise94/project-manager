"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectDisplay } from "@/components/ui/select";
import { ProjectBindDialog } from "@/components/finance/project-bind-dialog";
import { FolderTree, Receipt, Banknote, UserRound, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { OrderEditDialog } from "@/components/orders/order-edit-dialog";
import { canAccessOrders } from "@/lib/role-guards";

const SOURCE_LABELS: Record<string, string> = { MANUAL: "手动", PINGOODMICE: "拼好鼠", OTHER_IMPORT: "其他导入" };
const STATUS_LABELS: Record<string, string> = { DRAFT: "草稿", CONFIRMED: "已确认", CANCELLED: "已取消", CLOSED: "已关闭" };
const CATEGORY_LABELS: Record<string, string> = { SERVICE: "服务", PRODUCT: "商品", MIXED: "混合", UNKNOWN: "未分类" };
const TREATMENT_LABELS: Record<string, string> = { AUTO: "自动", STANDALONE: "独立计入", PROJECT_INCLUDED: "并入项目", EXCLUDED: "排除" };
const DELIVERY_LABELS: Record<string, string> = { PENDING: "未交付", PARTIAL: "部分交付", DELIVERED: "已交付", WAIVED: "无需交付" };
const MATCH_LABELS: Record<string, string> = { UNMATCHED: "未匹配", AUTO_MATCHED: "自动匹配", MANUAL_MATCHED: "人工匹配", CONFLICT: "冲突" };
const RELATION_LABELS: Record<string, string> = { GENERATED: "生成", LINKED: "关联", SPLIT: "拆分", SUPPLEMENT: "补充" };

export default function OrderDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { status: authStatus, data: session } = useSession();
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [showManualBind, setShowManualBind] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/orders/${id}`);
    if (res.status === 401) { router.push("/login"); return; }
    if (res.status === 403) { router.push("/dashboard"); return; }
    if (res.ok) { const d = await res.json(); setOrder(d?.order || null); }
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !id || !canAccessOrders(session?.user?.role)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrder();
  }, [id, authStatus, fetchOrder, session?.user?.role]);

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
        {projectLinks.length > 0 ? (
          <Link href={`/projects/${(projectLinks[0].project as Record<string, unknown>)?.id}`}>
            <Button size="sm" variant="outline"><FolderTree className="h-3 w-3 mr-1" />打开项目{projectLinks.length > 1 ? ` (+${projectLinks.length - 1})` : ""}</Button>
          </Link>
        ) : (
          isAdmin && <Button size="sm" variant="outline" onClick={() => setProjectDialogOpen(true)}><FolderTree className="h-3 w-3 mr-1" />关联项目</Button>
        )}
        <Link href={`/finance/invoices?orderId=${id}`}>
          <Button size="sm" variant="outline"><Receipt className="h-3 w-3 mr-1" />发票</Button>
        </Link>
        <Link href={`/finance/costs?orderId=${id}&customerId=${cust?.id || ""}`}>
          <Button size="sm" variant="outline"><Banknote className="h-3 w-3 mr-1" />成本</Button>
        </Link>
        {crmHref ? (
          <Link href={crmHref}><Button size="sm" variant="outline"><UserRound className="h-3 w-3 mr-1" />CRM 档案</Button></Link>
        ) : (
          <Link href="/crm/customers"><Button size="sm" variant="outline"><UserRound className="h-3 w-3 mr-1" />CRM 客户池</Button></Link>
        )}
        {(order.source as string) === "PINGOODMICE" && (order.externalOrderNo as string) && (
          <Link href={`/finance/order-matching?search=${encodeURIComponent(order.externalOrderNo as string)}`}>
            <Button size="sm" variant="outline">匹配页</Button>
          </Link>
        )}
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
                  <div className="pt-2 border-t">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => setShowManualBind(!showManualBind)}>
                      {showManualBind ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                      手动绑定 / 解除
                    </Button>
                    {showManualBind && (
                      <div className="mt-2 space-y-2">
                        <Button variant="outline" size="sm" onClick={() => saveField("customerId", null)} disabled={saving}>解除绑定</Button>
                        <div className="flex gap-2 items-center mt-1">
                          <Input placeholder="输入客户ID绑定..." className="max-w-[250px] text-xs" id="custId" />
                          <Button size="sm" variant="outline" onClick={() => { const el = document.getElementById("custId") as HTMLInputElement; if (el?.value) saveField("customerId", el.value); }} disabled={saving}>绑定</Button>
                        </div>
                      </div>
                    )}
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
                    <Input placeholder="输入客户ID绑定..." className="max-w-[250px] text-xs" id="custIdNoCust" />
                    <Button size="sm" onClick={() => { const el = document.getElementById("custIdNoCust") as HTMLInputElement; if (el?.value) saveField("customerId", el.value); }} disabled={saving}>绑定</Button>
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

          {/* Financial action cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Link href={`/finance/invoices?orderId=${id}`}>
              <Card className="p-3 hover:bg-muted/50 transition-colors cursor-pointer text-sm">
                <div className="flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" /><span className="font-medium">发票</span></div>
                <div className="text-xs text-muted-foreground mt-1">{(order.invoiceRequests as Array<Record<string, unknown>>)?.length || 0} 直接, {(order.invoiceCoverage as Array<Record<string, unknown>>)?.length || 0} 合并</div>
              </Card>
            </Link>
            <Link href={`/finance/costs?orderId=${id}&customerId=${cust?.id || ""}`}>
              <Card className="p-3 hover:bg-muted/50 transition-colors cursor-pointer text-sm">
                <div className="flex items-center gap-2"><Banknote className="h-4 w-4 text-primary" /><span className="font-medium">成本</span></div>
                <div className="text-xs text-muted-foreground mt-1">{(order.financeCosts as Array<Record<string, unknown>>)?.length || 0} 条记录</div>
              </Card>
            </Link>
            {!!cust?.id && (
              <Link href={`/finance/customers/${cust!.id}`}>
                <Card className="p-3 hover:bg-muted/50 transition-colors cursor-pointer text-sm">
                  <div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" /><span className="font-medium">客户财务</span></div>
                  <div className="text-xs text-muted-foreground mt-1">{cust!.name as string}</div>
                </Card>
              </Link>
            )}
          </div>
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
    </div>
  );
}
