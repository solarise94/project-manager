"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { DraftInputPanel } from "@/components/draft-input-panel";
import { CustomerSelect } from "@/components/customer-select";
import { OrganizationSelect } from "@/components/organization-select";
import { RepresentativeSelect } from "@/components/representative-select";
import { isAdmin } from "@/lib/role-guards";
import { toast } from "sonner";

const ORDER_FIELD_LABELS: Record<string, string> = {
  title: "订单标题", description: "描述", category: "分类",
  customer: "客户", buyerNameSnapshot: "收件人", buyerPhoneSnapshot: "电话",
  buyerWechatSnapshot: "微信", buyerOrgNameSnapshot: "单位", buyerAddressSnapshot: "地址",
  orderedAt: "下单日期", lines: "明细项", totalAmount: "总金额", financeTreatment: "计入口径",
};

function NewOrderForm() {
  const router = useRouter();
  const { status, data: session } = useSession();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("SERVICE");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerOrgName, setCustomerOrgName] = useState("");
  const [representativeId, setRepresentativeId] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [orderedAt, setOrderedAt] = useState(new Date().toISOString().slice(0, 10));
  const [projectAction, setProjectAction] = useState("NONE"); // NONE, GENERATE, LINK
  const [projectId, setProjectId] = useState("");
  const [financeTreatment, setFinanceTreatment] = useState("AUTO");
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerWechat, setBuyerWechat] = useState("");
  const [buyerOrgName, setBuyerOrgName] = useState("");
  const [buyerOrgId, setBuyerOrgId] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [lines, setLines] = useState<{ itemName: string; spec: string; unit: string; quantity: number; unitPrice: number; amount: number }[]>([
    { itemName: "", spec: "", unit: "", quantity: 1, unitPrice: 0, amount: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Prefill from project
  const searchParams = useSearchParams();
  const fromProjectId = searchParams.get("fromProjectId");
  const prefilledProjectIdRef = useRef<string | null>(null);
  const [prefillProjectName, setPrefillProjectName] = useState<string | null>(null);
  const [prefillError, setPrefillError] = useState(false);

  useEffect(() => {
    if (!fromProjectId || prefilledProjectIdRef.current === fromProjectId) return;
    prefilledProjectIdRef.current = fromProjectId;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${fromProjectId}`);
        if (!res.ok) throw new Error("Failed to load project");
        const data = await res.json();
        const project = data.project || data;
        if (!project) throw new Error("Project not found");

        const qty = Number(project.quantity) > 0 ? Number(project.quantity) : 1;
        const budget = project.budgetAmount ? Number(project.budgetAmount) : 0;

        setTitle(project.name || "");
        setCategory("SERVICE");
        setCustomerId(project.customerId || project.cust?.id || "");
        setCustomerName(project.client || project.cust?.name || "");
        setCustomerOrgName(project.organization || project.cust?.organization || "");
        setBuyerName(project.client || project.cust?.name || "");
        setBuyerOrgName(project.organization || project.cust?.organization || "");
        setBuyerOrgId(project.organizationId || project.cust?.organizationId || "");
        setRepresentativeId(project.representativeId || "");
        setProjectAction("LINK");
        setProjectId(project.id);
        setFinanceTreatment("PROJECT_INCLUDED");
        setLines([{
          itemName: project.projectContent || project.projectType || project.name || "",
          spec: project.projectType || "",
          unit: "项",
          quantity: qty,
          unitPrice: qty > 0 ? budget / qty : 0,
          amount: budget,
        }]);
        setPrefillProjectName(project.name || null);
      } catch {
        setPrefillError(true);
      }
    })();
  }, [fromProjectId]);

  const handleDraftApply = useCallback(async (fields: Record<string, unknown>) => {
    if (fields.title) setTitle(String(fields.title));
    if (fields.description) setDescription(String(fields.description));
    if (fields.category && ["SERVICE", "PRODUCT", "MIXED"].includes(String(fields.category))) {
      setCategory(String(fields.category));
    }
    if (fields.customer && typeof fields.customer === "object") {
      const cust = fields.customer as Record<string, unknown>;
      if (cust.matched && cust.id) {
        // Existing customer — fill directly
        setCustomerId(String(cust.id));
        setCustomerName(String(cust.name || ""));
        setCustomerOrgName(String(cust.organization || ""));
        if (cust.name) setBuyerName(String(cust.name));
        if (cust.organization) setBuyerOrgName(String(cust.organization));
        if (cust.organizationId) setBuyerOrgId(String(cust.organizationId));
      } else if (cust.shouldCreate && cust.name) {
        // New customer — create via API then fill
        const createCustomerFromDraft = async () => {
          const orgEntity = typeof fields.buyerOrgNameSnapshot === "object" && fields.buyerOrgNameSnapshot !== null
            ? (fields.buyerOrgNameSnapshot as Record<string, unknown>)
            : null;
          const orgName = orgEntity ? String(orgEntity.name || "") : (typeof fields.buyerOrgNameSnapshot === "string" ? String(fields.buyerOrgNameSnapshot) : "");
          const orgId = orgEntity ? String(orgEntity.id || "") : "";

          const res = await fetch("/api/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: String(cust.name),
              principal: (cust.principal as string)?.trim() || (fields.buyerPhoneSnapshot as string)?.trim() || undefined,
              wechat: (cust.wechat as string)?.trim() || (fields.buyerWechatSnapshot as string)?.trim() || undefined,
              address: (cust.address as string)?.trim() || (fields.buyerAddressSnapshot as string)?.trim() || undefined,
              organization: (cust.organization as string)?.trim() || orgName || undefined,
              organizationId: (cust.organizationId as string) || orgId || undefined,
              organizationRawInput: (cust.organization as string)?.trim() || orgName || undefined,
            }),
          });
          return res;
        };

        try {
          const res = await createCustomerFromDraft();
          if (res.ok) {
            const data = await res.json();
            const created = data.customer;
            if (created?.id) {
              setCustomerId(String(created.id));
              setCustomerName(String(created.name || cust.name));
              if (created.organization) setCustomerOrgName(String(created.organization));
              if (created.organizationId) setBuyerOrgId(String(created.organizationId));
              if (created.principal) setBuyerPhone(String(created.principal));
              if (created.wechat) setBuyerWechat(String(created.wechat));
              if (created.address) setBuyerAddress(String(created.address));
              // Rep: use returned value or explicitly clear
              setRepresentativeId(created.representativeId ? String(created.representativeId) : "");
              setRepresentativeName(created.representativeName ? String(created.representativeName) : "");
              setBuyerName(String(cust.name));
              if (cust.organization) setBuyerOrgName(String(cust.organization as string));
              // Invalidate customer list cache so pickers reflect new customer
              queryClient.invalidateQueries({ queryKey: ["customers-list"] });
              toast.success(`已创建客户 "${String(cust.name)}"`);
            }
          } else {
            const err = await res.json().catch(() => ({}));
            toast.error(err.error || "客户创建失败，请在表单中手动选择");
            setCustomerId("");
            setCustomerName("");
            setRepresentativeId("");
            setRepresentativeName("");
            setBuyerName(String(cust.name));
          }
        } catch {
          toast.error("客户创建失败，请在表单中手动选择");
          setCustomerId("");
          setCustomerName("");
          setRepresentativeId("");
          setRepresentativeName("");
          setBuyerName(String(cust.name));
        }
      } else if (cust.name) {
        // Unmatched, not marked for creation — just fill buyer name
        setBuyerName(String(cust.name));
      }
    }
    if (fields.buyerNameSnapshot) setBuyerName(String(fields.buyerNameSnapshot));
    if (fields.buyerPhoneSnapshot) setBuyerPhone(String(fields.buyerPhoneSnapshot));
    if (fields.buyerWechatSnapshot) setBuyerWechat(String(fields.buyerWechatSnapshot));
    if (fields.buyerOrgNameSnapshot) {
      if (typeof fields.buyerOrgNameSnapshot === "object" && fields.buyerOrgNameSnapshot !== null) {
        const org = fields.buyerOrgNameSnapshot as Record<string, unknown>;
        setBuyerOrgName(String(org.name || ""));
        setBuyerOrgId(String(org.id || ""));
      } else {
        setBuyerOrgName(String(fields.buyerOrgNameSnapshot));
        setBuyerOrgId("");
      }
    }
    if (fields.buyerAddressSnapshot) setBuyerAddress(String(fields.buyerAddressSnapshot));
    if (fields.orderedAt) {
      const d = String(fields.orderedAt);
      if (d.match(/^\d{4}-\d{2}-\d{2}/)) setOrderedAt(d.slice(0, 10));
    }
    if (fields.totalAmount) {
      const amt = Number(fields.totalAmount);
      if (!Number.isNaN(amt)) setTotalAmount(String(amt));
    }
    if (fields.lines) {
      const rawLines = fields.lines;
      if (Array.isArray(rawLines) && rawLines.length > 0) {
        setLines((rawLines as Array<Record<string, unknown>>).map((l) => ({
          itemName: String(l.itemName || l.name || ""),
          spec: String(l.spec || ""),
          unit: String(l.unit || "项"),
          quantity: Number(l.quantity) || 1,
          unitPrice: Number(l.unitPrice) || 0,
          amount: Number(l.amount) || 0,
        })));
      } else if (typeof rawLines === "string" && rawLines.trim()) {
        const amt = fields.totalAmount ? Number(fields.totalAmount) : 0;
        setLines([{ itemName: rawLines.trim(), spec: "", unit: "项", quantity: 1, unitPrice: Number.isNaN(amt) ? 0 : amt, amount: Number.isNaN(amt) ? 0 : amt }]);
      }
    } else if (fields.totalAmount && !fields.lines) {
      // AI extracted totalAmount but no structured lines — auto-generate one default line
      const amt = Number(fields.totalAmount);
      if (!Number.isNaN(amt) && amt > 0) {
        const titleFromFields = fields.title ? String(fields.title) : "订单服务";
        setLines([{ itemName: titleFromFields, spec: "", unit: "项", quantity: 1, unitPrice: amt, amount: amt }]);
      }
    }
    if (fields.financeTreatment) setFinanceTreatment(String(fields.financeTreatment));
    toast.success("已从草稿填充订单信息，请核对后提交");
  }, [queryClient]);

  if (status === "loading") return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (!isAdmin(session?.user?.role)) { router.push("/dashboard"); return null; }

  const updateLine = (i: number, field: string, value: unknown) => {
    const updated = [...lines];
    updated[i] = { ...updated[i], [field]: value };
    if (field === "quantity" || field === "unitPrice") {
      updated[i].amount = (updated[i].quantity || 0) * (updated[i].unitPrice || 0);
    }
    setLines(updated);
  };

  const addLine = () => setLines([...lines, { itemName: "", spec: "", unit: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const handleSubmit = async (draft: boolean) => {
    setSubmitting(true);
    setError("");
    try {
      const body = {
        title,
        description: description || null,
        category,
        status: draft ? "DRAFT" : "CONFIRMED",
        orderedAt: orderedAt ? new Date(orderedAt).toISOString() : null,
        customerId: customerId || null,
        representativeId: representativeId || null,
        projectAction,
        projectId: projectId || null,
        financeTreatment,
        buyerNameSnapshot: buyerName || null,
        buyerPhoneSnapshot: buyerPhone || null,
        buyerWechatSnapshot: buyerWechat || null,
        buyerOrgNameSnapshot: buyerOrgName || null,
        buyerAddressSnapshot: buyerAddress || null,
        lines: lines.filter(l => l.itemName.trim()),
        totalAmount: totalAmount ? Number(totalAmount) : undefined,
      };
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const d = await res.json();
        router.push(`/orders/${d.order.id}`);
      } else {
        const d = await res.json();
        setError(d.error || "创建失败");
      }
    } catch (e) {
      setError(`提交失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSubmitting(false); }
  };

  const lineTotal = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div><Link href="/orders" className="text-sm text-muted-foreground hover:underline">&larr; 返回</Link><h1 className="text-xl font-bold">新建服务订单</h1></div>
      </div>

      <DraftInputPanel
        formKey="order.create"
        fieldLabels={ORDER_FIELD_LABELS}
        onApply={handleDraftApply}
        fallbackPlugin="order.smart-fill"
      />

      {error && <Card className="p-3 text-sm text-red-600 bg-red-50 border-red-200">{error}</Card>}

      {prefillProjectName && (
        <Card className="p-3 text-sm text-blue-700 bg-blue-50 border-blue-200">
          已从项目「{prefillProjectName}」导入基础信息，创建后会自动绑定到该项目。
        </Card>
      )}
      {prefillError && (
        <Card className="p-3 text-sm text-amber-700 bg-amber-50 border-amber-200">
          项目导入失败，请手动填写订单信息。
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <div><label className="text-sm font-medium">订单标题 *</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 单细胞测序服务" /></div>
        <div><label className="text-sm font-medium">描述</label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="订单描述（可选）" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-sm font-medium">分类</label><select className="w-full border rounded px-2 py-1.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}><option value="SERVICE">服务</option><option value="PRODUCT">商品</option><option value="MIXED">混合</option></select></div>
          <div><label className="text-sm font-medium">下单日期</label><Input type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">客户</label>
            <CustomerSelect
              value={customerId}
              displayValue={customerName}
              onChange={(id, name, org, organizationId, customer) => {
                setCustomerId(id || "");
                setCustomerName(name || "");
                setCustomerOrgName(org || "");

                if (id && customer) {
                  setBuyerName(customer.name || "");
                  setBuyerPhone(customer.principal || "");
                  setBuyerWechat(customer.wechat || "");
                  setBuyerAddress(customer.address || "");
                  setBuyerOrgName(customer.organization || "");
                  setBuyerOrgId(customer.organizationId || "");
                  setRepresentativeId(customer.representativeId || "");
                  setRepresentativeName(customer.representativeName || "");
                } else {
                  // Customer cleared — clear representative, keep buyer snapshots
                  setRepresentativeId("");
                  setRepresentativeName("");
                }
              }}
              quickCreateDefaults={{
                name: buyerName,
                principal: buyerPhone,
                wechat: buyerWechat,
                organization: buyerOrgName,
                organizationId: buyerOrgId,
                address: buyerAddress,
              }}
            />
          </div>
          <div>
            <label className="text-sm font-medium">代表</label>
            {customerId ? (
              <>
                <Input
                  value={representativeName || representativeId || "由客户 CRM 负责人同步"}
                  disabled
                  className="text-muted-foreground"
                />
                {!representativeId && !representativeName && (
                  <p className="text-xs text-muted-foreground mt-1">无匹配代表</p>
                )}
              </>
            ) : (
              <RepresentativeSelect
                value={representativeId}
                displayValue={representativeName}
                onChange={(id, name) => {
                  setRepresentativeId(id || "");
                  setRepresentativeName(name || "");
                }}
              />
            )}
          </div>
        </div>
        {(customerName || customerOrgName) && (
          <div className="text-xs text-muted-foreground">
            已选客户：{customerName || customerId}{customerOrgName ? ` / ${customerOrgName}` : ""}
          </div>
        )}
      </Card>

      {/* Buyer Snapshot */}
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">买方信息（快照）</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-sm font-medium">收件人</label><Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="收件人姓名" /></div>
          <div><label className="text-sm font-medium">电话</label><Input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} placeholder="联系电话" /></div>
          <div><label className="text-sm font-medium">微信</label><Input value={buyerWechat} onChange={(e) => setBuyerWechat(e.target.value)} placeholder="微信号" /></div>
          <div>
            <label className="text-sm font-medium">单位</label>
            <OrganizationSelect
              value={buyerOrgId}
              displayValue={buyerOrgName}
              onChange={(id, name) => {
                setBuyerOrgId(id || "");
                setBuyerOrgName(name || "");
              }}
            />
          </div>
        </div>
        <div><label className="text-sm font-medium">地址</label><Input value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} placeholder="收货地址" /></div>
      </Card>

      {/* Lines */}
      <Card className="p-4 space-y-3">
        <div className="flex justify-between items-center"><h3 className="font-medium">订单明细</h3><Button variant="outline" size="sm" onClick={addLine}>+ 添加行</Button></div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-6 gap-2 items-end border-b pb-2">
            <div className="col-span-2"><label className="text-xs text-muted-foreground">名称</label><Input value={l.itemName} onChange={(e) => updateLine(i, "itemName", e.target.value)} placeholder="服务名称" /></div>
            <div><label className="text-xs text-muted-foreground">数量</label><Input type="number" value={l.quantity || ""} onChange={(e) => updateLine(i, "quantity", Number(e.target.value))} /></div>
            <div><label className="text-xs text-muted-foreground">单价</label><Input type="number" value={l.unitPrice || ""} onChange={(e) => updateLine(i, "unitPrice", Number(e.target.value))} /></div>
            <div><label className="text-xs text-muted-foreground">金额</label><div className="text-sm py-1.5 font-medium">¥{l.amount.toLocaleString()}</div></div>
            <div className="flex items-end"><Button variant="outline" size="sm" onClick={() => removeLine(i)} disabled={lines.length <= 1}>×</Button></div>
          </div>
        ))}
        <div className="text-right font-medium">合计: ¥{lineTotal.toLocaleString()}</div>
      </Card>

      {/* Project options */}
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">项目选项</h3>
        <select className="w-full border rounded px-2 py-1.5 text-sm" value={projectAction} onChange={(e) => setProjectAction(e.target.value)}>
          <option value="NONE">仅创建订单</option>
          <option value="GENERATE">创建订单并生成项目</option>
          <option value="LINK">创建订单并绑定已有项目</option>
        </select>
        {projectAction === "LINK" && <Input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="输入项目ID" />}
      </Card>

      {/* Finance */}
      <Card className="p-4 space-y-3">
        <h3 className="font-medium">财务设置</h3>
        <select className="w-full border rounded px-2 py-1.5 text-sm" value={financeTreatment} onChange={(e) => setFinanceTreatment(e.target.value)}>
          <option value="AUTO">自动判断</option><option value="STANDALONE">独立计入</option><option value="PROJECT_INCLUDED">并入项目</option><option value="EXCLUDED">排除</option>
        </select>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => handleSubmit(true)} disabled={submitting || !title.trim()}>保存草稿</Button>
        <Button onClick={() => handleSubmit(false)} disabled={submitting || !title.trim()}>确认创建</Button>
      </div>
    </div>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">加载中...</div>}>
      <NewOrderForm />
    </Suspense>
  );
}
