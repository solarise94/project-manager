"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectDisplay } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StageBadge, AssignmentStatusBadge } from "@/components/crm/badges";
import { CRM_STAGES, STAGE_LABELS, CRM_ASSIGNMENT_STATUS, ASSIGNMENT_STATUS_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmCustomerProfileItem } from "@/lib/crm/types";
import { toast } from "sonner";
import Link from "next/link";
import { Search, UserCog, Undo2, Layers } from "lucide-react";

export default function CustomerPoolPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;
  if (session?.user?.role === "REPRESENTATIVE") { router.push("/crm"); return null; }

  return <CustomerPool />;
}

function CustomerPool() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("ALL");
  const [assignmentStatus, setAssignmentStatus] = useState("");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stage !== "ALL") params.set("stage", stage);
  if (assignmentStatus) params.set("assignmentStatus", assignmentStatus);

  const { data, isLoading } = useQuery<{ profiles: CrmCustomerProfileItem[] }>({
    queryKey: ["crm-customer-pool", search, stage, assignmentStatus],
    queryFn: () => fetch(`/api/crm/customer-pool?${params}`).then((r) => r.json()),
  });

  const profiles = data?.profiles || [];

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/customer-pool/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error("扫描失败");
      return res.json();
    },
    onSuccess: (d: { markedCount: number }) => {
      toast.success(`扫描完成，${d.markedCount} 个客户标记为待收回`);
      queryClient.invalidateQueries({ queryKey: ["crm-customer-pool"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">客户流转池</h1>
          <p className="text-sm text-muted-foreground">管理客户分配、收回和长期未拜访客户</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
          <Layers className="h-4 w-4 mr-1" />
          {scanMutation.isPending ? "扫描中..." : "扫描长期未拜访"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索客户名称、编号、单位..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stage} onValueChange={(v) => setStage(v || "ALL")}>
          <SelectTrigger className="w-[130px]"><SelectDisplay label="阶段" valueLabel={stage === "ALL" ? "全部阶段" : STAGE_LABELS[stage] || "未知"} placeholder="阶段" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部阶段</SelectItem>
            {CRM_STAGES.map((s) => (
              <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assignmentStatus} onValueChange={(v) => setAssignmentStatus(v || "")}>
          <SelectTrigger className="w-[130px]"><SelectDisplay label="分配状态" valueLabel={assignmentStatus ? ASSIGNMENT_STATUS_LABELS[assignmentStatus] || "未知" : "待处理"} placeholder="分配状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">待处理</SelectItem>
            {CRM_ASSIGNMENT_STATUS.map((s) => (
              <SelectItem key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : profiles.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">暂无待处理客户</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">客户</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">单位</th>
                <th className="text-left p-3 font-medium">阶段</th>
                <th className="text-left p-3 font-medium">分配状态</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">负责人</th>
                <th className="text-left p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Link href={`/crm/customers/${p.sourceCustomerId}`} className="text-primary hover:underline font-medium">
                      {p.sourceCustomer.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{p.sourceCustomer.customerCode}</div>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{p.sourceCustomer.organization || "-"}</td>
                  <td className="p-3"><StageBadge stage={p.stage} /></td>
                  <td className="p-3"><AssignmentStatusBadge status={p.assignmentStatus} /></td>
                  <td className="p-3 hidden lg:table-cell">{p.ownerUser.name}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <AssignButton profileId={p.id} currentOwner={p.ownerUser.name} />
                      {(p.assignmentStatus === "ASSIGNED" || p.assignmentStatus === "RECALL_CANDIDATE") && (
                        <RecallButton profileId={p.id} currentOwner={p.ownerUser.name} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AssignButton({ profileId, currentOwner }: { profileId: string; currentOwner: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const queryClient = useQueryClient();

  const { data: repsData } = useQuery<{ representatives: { id: string; name: string; email: string; archived: boolean }[] }>({
    queryKey: ["admin-representatives"],
    queryFn: () => fetch("/api/representatives/list").then((r) => r.json()),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/customer-pool/${profileId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ representativeId: selected }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "分配失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("客户已分配");
      queryClient.invalidateQueries({ queryKey: ["crm-customer-pool"] });
      queryClient.invalidateQueries({ queryKey: crmKeys.profiles() });
      queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() });
      setOpen(false);
      setSelected("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reps = repsData?.representatives.filter((r) => !r.archived) || [];

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <UserCog className="h-4 w-4 mr-1" />分配
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>分配客户给代表</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">当前: {currentOwner}</p>
          <Select value={selected} onValueChange={(v) => setSelected(v || "")}>
            <SelectTrigger>
              {selected
                ? <span>{reps.find((a) => a.id === selected)?.name || selected}</span>
                : <span className="text-muted-foreground">选择代表</span>}
            </SelectTrigger>
            <SelectContent>
              {reps.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name} ({r.email})</SelectItem>
              ))}
              {reps.length === 0 && <div className="p-2 text-sm text-muted-foreground">暂无代表</div>}
            </SelectContent>
          </Select>
          <Button onClick={() => mutation.mutate()} disabled={!selected || mutation.isPending} className="w-full">
            {mutation.isPending ? "分配中..." : "确认分配"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecallButton({ profileId, currentOwner }: { profileId: string; currentOwner: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/customer-pool/${profileId}/recall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "收回失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("客户已收回");
      queryClient.invalidateQueries({ queryKey: ["crm-customer-pool"] });
      queryClient.invalidateQueries({ queryKey: crmKeys.profiles() });
      queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm"><Undo2 className="h-4 w-4 mr-1" />收回</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>收回客户</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">将客户从 {currentOwner} 处收回</p>
        <Input placeholder="收回原因（可选）" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full" variant="destructive">
          {mutation.isPending ? "收回中..." : "确认收回"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
