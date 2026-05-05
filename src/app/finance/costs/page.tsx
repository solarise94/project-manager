"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectDisplay } from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";

const COST_TYPES = [
  { value: "PROCUREMENT", label: "采购成本" }, { value: "EXPERIMENT", label: "实验成本" },
  { value: "LABOR", label: "人工成本" }, { value: "LOGISTICS", label: "物流成本" },
  { value: "PLATFORM", label: "平台成本" }, { value: "MARKETING", label: "市场获客成本" },
  { value: "ENTERTAINMENT", label: "招待成本" }, { value: "REFUND", label: "退款/冲减" },
  { value: "OTHER", label: "其他" },
];

export default function CostsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  if (status === "loading") return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/finance" className="text-sm text-muted-foreground hover:underline">&larr; 返回财务</Link>
          <h1 className="text-xl font-bold mt-1">成本管理</h1>
        </div>
      </div>
      <CostForm onCreated={() => {}} />
      <CostList />
    </div>
  );
}

function CostForm({ onCreated }: { onCreated: () => void }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const isAdmin = session?.user?.role === "ADMIN";
  const [amount, setAmount] = useState("");
  const [costType, setCostType] = useState("OTHER");
  const [customerId, setCustomerId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [remark, setRemark] = useState("");
  const [open, setOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/finance/costs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), costType, customerId: customerId || null, orderId: orderId || null, projectId: projectId || null, remark: remark || null }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "创建失败"); }
      return res.json();
    },
    onSuccess: () => {
      toast.success("成本已记录");
      queryClient.invalidateQueries({ queryKey: ["finance", "costs"] });
      setAmount(""); setRemark(""); setCustomerId(""); setOrderId(""); setProjectId(""); setOpen(false);
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />新增成本</Button>;

  return (
    <Card className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm font-medium">金额 *</label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
        <div>
          <label className="text-sm font-medium">类型</label>
          <Select value={costType} onValueChange={(v) => { if (v) setCostType(v); }}>
            <SelectTrigger><SelectDisplay label="选择类型" valueLabel={COST_TYPES.find(c => c.value === costType)?.label} /></SelectTrigger>
            <SelectContent>{COST_TYPES.map(c => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="text-sm font-medium">客户ID</label><Input value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="可选" /></div>
        <div><label className="text-sm font-medium">订单ID</label><Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="可选" /></div>
        <div><label className="text-sm font-medium">项目ID</label><Input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="可选" /></div>
      </div>
      <div><label className="text-sm font-medium">备注</label><Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="可选" /></div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !amount}>{createMutation.isPending ? "创建中..." : "保存"}</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>取消</Button>
      </div>
    </Card>
  );
}

function CostList() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<{ costs: Array<Record<string, unknown>>; total: number; totalPages: number }>({
    queryKey: ["finance", "costs", page],
    queryFn: () => fetch(`/api/finance/costs?page=${page}&pageSize=20`).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/finance/costs/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("已删除"); queryClient.invalidateQueries({ queryKey: ["finance", "costs"] }); },
  });

  if (isLoading) return <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-2">
      {data?.costs?.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">暂无成本记录</div>
      ) : (
        data?.costs?.map((c: Record<string, unknown>) => (
          <Card key={c.id as string} className="p-3 text-sm flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">¥{(c.amount as number).toLocaleString()}</span>
                <Badge variant="outline" className="text-xs">{COST_TYPES.find(t => t.value === c.costType)?.label || c.costType as string}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {[(c.customer as Record<string, unknown>)?.name, (c.order as Record<string, unknown>)?.orderNo, (c.project as Record<string, unknown>)?.name].filter(Boolean).join(" / ") || "未关联"}
                {c.remark ? ` — ${c.remark}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">{(c.occurredAt as string)?.slice(0, 10)}</div>
            </div>
            {session?.user?.role === "ADMIN" && (
              <Button variant="ghost" size="sm" onClick={() => { if (confirm("删除此成本记录？")) deleteMutation.mutate(c.id as string); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </Card>
        ))
      )}
      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span className="text-sm py-2">{page}/{data?.totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= (data?.totalPages ?? 0)} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}
    </div>
  );
}
