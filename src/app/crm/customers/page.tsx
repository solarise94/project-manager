"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StageBadge, ImportanceBadge } from "@/components/crm/badges";
import { ActivateProfileDialog } from "@/components/crm/activate-profile-dialog";
import { CustomerApplicationFormDialog } from "@/components/crm/customer-application-form-dialog";
import { CRM_STAGES, STAGE_LABELS, CRM_IMPORTANCE, IMPORTANCE_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmCustomerProfileItem } from "@/lib/crm/types";
import { toast } from "sonner";
import Link from "next/link";
import { Search, UserCog } from "lucide-react";

export default function CrmCustomersPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <CustomerPool />;
}

function CustomerPool() {
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("ALL");
  const [importance, setImportance] = useState("ALL");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stage !== "ALL") params.set("stage", stage);
  if (importance !== "ALL") params.set("importance", importance);

  const { data, isLoading } = useQuery<{ profiles: CrmCustomerProfileItem[] }>({
    queryKey: ["crm-profiles", search, stage, importance],
    queryFn: () => fetch(`/api/crm/profiles?${params}`).then((r) => r.json()),
  });

  const profiles = data?.profiles || [];
  const isRep = session?.user?.role === "REPRESENTATIVE";

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">CRM 客户池</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <CustomerApplicationFormDialog />
          {!isRep && <ActivateProfileDialog />}
        </div>
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
        <Select value={importance} onValueChange={(v) => setImportance(v || "ALL")}>
          <SelectTrigger className="w-[130px]"><SelectDisplay label="重要度" valueLabel={importance === "ALL" ? "全部重要度" : IMPORTANCE_LABELS[importance] || "未知"} placeholder="重要度" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部重要度</SelectItem>
            {CRM_IMPORTANCE.map((i) => (
              <SelectItem key={i} value={i}>{IMPORTANCE_LABELS[i]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : profiles.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">暂无 CRM 客户档案</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">客户</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">单位</th>
                <th className="text-left p-3 font-medium">阶段</th>
                <th className="text-left p-3 font-medium hidden sm:table-cell">重要度</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">负责人</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">下次跟进</th>
                {!isRep && <th className="text-left p-3 font-medium">操作</th>}
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
                  <td className="p-3 hidden sm:table-cell"><ImportanceBadge importance={p.importance} /></td>
                  <td className="p-3 hidden lg:table-cell">{p.ownerUser.name}</td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">
                    {p.nextFollowUpAt ? new Date(p.nextFollowUpAt).toLocaleDateString("zh-CN") : "-"}
                  </td>
                  {!isRep && (
                    <td className="p-3">
                      <AssignButton profileId={p.id} currentOwner={p.ownerUser.name} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface AssigneeOption {
  userId: string;
  name: string;
  kind: "self" | "representative";
}

function AssignButton({ profileId, currentOwner }: { profileId: string; currentOwner: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const queryClient = useQueryClient();

  const { data: assigneesData } = useQuery<{ assignees: AssigneeOption[] }>({
    queryKey: ["crm-assignees"],
    queryFn: () => fetch("/api/crm/assignees").then((r) => r.json()),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUserId: selected }),
      });
      if (!res.ok) throw new Error("指派失败");
      return res.json();
    },
    onSuccess: async (data: { profile?: { sourceCustomer?: { id?: string } } }) => {
      toast.success("负责人已更新");
      const scId = data.profile?.sourceCustomer?.id;
      const promises: Promise<void>[] = [
        queryClient.invalidateQueries({ queryKey: crmKeys.profiles() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
      ];
      if (scId) {
        promises.push(queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(scId) }));
      }
      await Promise.all(promises);
      setOpen(false);
      setSelected("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const assignees = assigneesData?.assignees || [];

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <UserCog className="h-4 w-4 mr-1" />指派
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>指派负责人</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">当前: {currentOwner}</p>
          <Select value={selected} onValueChange={(v) => setSelected(v || "")}>
            <SelectTrigger>
              {selected
                ? <span>{assignees.find((a) => a.userId === selected)?.name || selected}</span>
                : <span className="text-muted-foreground">选择负责人</span>}
            </SelectTrigger>
            <SelectContent>
              {assignees.map((a) => (
                <SelectItem key={a.userId} value={a.userId}>
                  {a.name}{a.kind === "representative" ? " (代表)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => mutation.mutate()} disabled={!selected || mutation.isPending} className="w-full">
            {mutation.isPending ? "保存中..." : "确认指派"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
