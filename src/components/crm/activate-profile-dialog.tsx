"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crmKeys } from "@/lib/crm/query-keys";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { CRM_STAGES, STAGE_LABELS, CRM_IMPORTANCE, IMPORTANCE_LABELS } from "@/lib/crm/constants";

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string;
  organization: string | null;
}

interface AssigneeOption {
  userId: string;
  name: string;
  email: string;
  kind: "self" | "representative";
}

export function ActivateProfileDialog() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [stage, setStage] = useState("LEAD");
  const [importance, setImportance] = useState("NORMAL");
  const queryClient = useQueryClient();
  const canAssign = session?.user?.role !== "REPRESENTATIVE";

  const { data: customersData } = useQuery<{ customers: CustomerOption[] }>({
    queryKey: ["customers-for-crm"],
    queryFn: async () => {
      const res = await fetch("/api/customers?limit=500&excludeCrm=1");
      return res.json();
    },
    enabled: open,
  });

  const { data: assigneesData } = useQuery<{ assignees: AssigneeOption[] }>({
    queryKey: ["crm-assignees"],
    queryFn: async () => {
      const res = await fetch("/api/crm/assignees");
      return res.json();
    },
    enabled: open && canAssign,
  });

  const { data: batchCountData } = useQuery<{ count: number }>({
    queryKey: ["crm-batch-candidate-count"],
    queryFn: () => fetch("/api/crm/profiles/batch").then((r) => r.json()),
    enabled: open && canAssign,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = { sourceCustomerId: selectedCustomerId, stage, importance };
      if (ownerUserId) payload.ownerUserId = ownerUserId;
      const res = await fetch("/api/crm/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "操作失败");
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success("已纳入 CRM 管理");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: crmKeys.profiles() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.customersForCrm() }),
      ]);
      setOpen(false);
      setSelectedCustomerId("");
      setOwnerUserId("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const customers = customersData?.customers || [];
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const assignees = assigneesData?.assignees || [];

  const batchMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = { stage, importance };
      if (ownerUserId) payload.ownerUserId = ownerUserId;
      const res = await fetch("/api/crm/profiles/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "批量操作失败");
      }
      return res.json() as Promise<{ created: number }>;
    },
    onSuccess: async (data) => {
      toast.success(`已将 ${data.created} 位客户纳入 CRM`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: crmKeys.profiles() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.customersForCrm() }),
        queryClient.invalidateQueries({ queryKey: ["crm-batch-candidate-count"] }),
      ]);
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [confirmBatch, setConfirmBatch] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <UserPlus className="h-4 w-4 mr-1" />从已有客户加入 CRM
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>纳入 CRM 管理</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          {canAssign && (batchCountData?.count ?? 0) > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <div className="flex items-center justify-between">
                <span>{batchCountData!.count} 位候选客户未激活</span>
                {!confirmBatch ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmBatch(true)}>
                    全部激活
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">确认？</span>
                    <Button type="button" size="sm" variant="destructive" onClick={() => { batchMutation.mutate(); setConfirmBatch(false); }} disabled={batchMutation.isPending || !ownerUserId}>
                      {batchMutation.isPending ? "处理中..." : "确认全部加入"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmBatch(false)}>取消</Button>
                  </div>
                )}
              </div>
            </div>
          )}
          <div>
            <label className="text-sm font-medium">选择客户 *</label>
            <Select value={selectedCustomerId} onValueChange={(v) => setSelectedCustomerId(v || "")}>
              <SelectTrigger className="w-full min-w-0">
                {selectedCustomer ? (
                  <span className="block min-w-0 flex-1 truncate text-left">
                    {selectedCustomer.name} ({selectedCustomer.customerCode})
                    {selectedCustomer.organization ? ` - ${selectedCustomer.organization}` : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">选择客户</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{c.name} ({c.customerCode})</div>
                      {c.organization && (
                        <div className="truncate text-xs text-muted-foreground">{c.organization}</div>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canAssign && (
            <div>
              <label className="text-sm font-medium">指派负责人</label>
              <Select value={ownerUserId} onValueChange={(v) => setOwnerUserId(v || "")}>
                <SelectTrigger>
                  {ownerUserId
                    ? <span>{assignees.find((a) => a.userId === ownerUserId)?.name || ownerUserId}</span>
                    : <span className="text-muted-foreground">请选择负责人</span>}
                </SelectTrigger>
                <SelectContent>
                  {assignees.map((a) => (
                    <SelectItem key={a.userId} value={a.userId}>
                      {a.name}{a.kind === "representative" ? " (代表)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">阶段</label>
              <Select value={stage} onValueChange={(v) => setStage(v || "LEAD")}>
                <SelectTrigger>
                  <SelectValue>{STAGE_LABELS[stage] || stage}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CRM_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">重要度</label>
              <Select value={importance} onValueChange={(v) => setImportance(v || "NORMAL")}>
                <SelectTrigger>
                  <SelectValue>{IMPORTANCE_LABELS[importance] || importance}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CRM_IMPORTANCE.map((i) => (
                    <SelectItem key={i} value={i}>{IMPORTANCE_LABELS[i]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={mutation.isPending || !selectedCustomerId || (canAssign && !ownerUserId)} className="w-full">
            {mutation.isPending ? "处理中..." : "加入 CRM"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
