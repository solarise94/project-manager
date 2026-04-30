"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmRegionManagerItem } from "@/lib/crm/types";
import { toast } from "sonner";
import { Plus, Edit, Archive } from "lucide-react";

export default function RegionManagersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;
  if (session?.user?.role !== "ADMIN") { router.push("/crm"); return null; }

  return <RegionManagerConfig />;
}

function RegionManagerConfig() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CrmRegionManagerItem | null>(null);

  const { data, isLoading } = useQuery<{ managers: CrmRegionManagerItem[] }>({
    queryKey: crmKeys.regionManagers(),
    queryFn: () => fetch("/api/crm/region-managers").then((r) => r.json()),
  });

  const managers = data?.managers || [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">地区经理设置</h1>
          <p className="text-sm text-muted-foreground">配置地区经理及其负责的代表</p>
        </div>
        <Button size="sm" onClick={() => { setEditTarget(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" />添加地区经理
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : managers.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">暂无地区经理，点击右上角添加</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">用户</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">地区名称</th>
                <th className="text-left p-3 font-medium">负责代表</th>
                <th className="text-left p-3 font-medium hidden sm:table-cell">状态</th>
                <th className="text-left p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => (
                <tr key={m.id} className={`border-t hover:bg-muted/30 ${m.archived ? "opacity-60" : ""}`}>
                  <td className="p-3">
                    <div className="font-medium">{m.user.name}</div>
                    <div className="text-xs text-muted-foreground">{m.user.email}</div>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{m.regionName || "-"}</td>
                  <td className="p-3">
                    <span className="text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">
                      {m.reps.length} 位代表
                    </span>
                  </td>
                  <td className="p-3 hidden sm:table-cell">
                    {m.archived ? (
                      <span className="text-xs bg-gray-100 text-gray-600 rounded px-2 py-0.5">已归档</span>
                    ) : (
                      <span className="text-xs bg-green-100 text-green-700 rounded px-2 py-0.5">活跃</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setEditTarget(m); setDialogOpen(true); }}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => {
                        if (!confirm(m.archived ? "确定恢复该地区经理?" : "确定归档该地区经理?")) return;
                        fetch(`/api/crm/region-managers/${m.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ archived: !m.archived }),
                        }).then((r) => r.ok ? toast.success(m.archived ? "已恢复" : "已归档") : Promise.reject(r))
                          .then(() => queryClient.invalidateQueries({ queryKey: crmKeys.regionManagers() }))
                          .catch(() => toast.error("操作失败"));
                      }}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <RegionManagerDialog
          edit={editTarget}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: crmKeys.regionManagers() });
            setDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RegionManagerDialog({
  edit,
  onClose,
  onSaved,
}: {
  edit: CrmRegionManagerItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState(edit?.userId || "");
  const [regionName, setRegionName] = useState(edit?.regionName || "");
  const [selectedRepIds, setSelectedRepIds] = useState<string[]>(
    edit?.reps.map((r) => r.representativeId) || []
  );

  const { data: usersData } = useQuery<{ users: { id: string; name: string; email: string }[] }>({
    queryKey: ["admin-users"],
    queryFn: () => fetch("/api/users").then((r) => r.json()),
  });
  const { data: repsData } = useQuery<{ representatives: { id: string; name: string; email: string }[] }>({
    queryKey: ["admin-representatives"],
    queryFn: () => fetch("/api/representatives/list").then((r) => r.json()),
  });

  const users = usersData?.users || [];
  const reps = repsData?.representatives || [];

  const mutation = useMutation({
    mutationFn: async () => {
      const url = edit ? `/api/crm/region-managers/${edit.id}` : "/api/crm/region-managers";
      const method = edit ? "PATCH" : "POST";
      const body: Record<string, unknown> = edit ? { regionName, repIds: selectedRepIds } : { userId: selectedUserId, regionName, repIds: selectedRepIds };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "保存失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(edit ? "已更新" : "地区经理已添加");
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{edit ? "编辑地区经理" : "添加地区经理"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {!edit && (
            <div>
              <label className="text-sm font-medium">选择用户</label>
              <Select value={selectedUserId} onValueChange={(v) => setSelectedUserId(v || "")}>
                <SelectTrigger>
                  {selectedUserId
                    ? <span>{users.find((u) => u.id === selectedUserId)?.name || selectedUserId}</span>
                    : <span className="text-muted-foreground">选择用户...</span>}
                </SelectTrigger>
                <SelectContent>
                  {users.filter((u) => u).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium">地区名称</label>
            <Input value={regionName} onChange={(e) => setRegionName(e.target.value)} placeholder="如: 华东区、华南区..." />
          </div>
          <div>
            <label className="text-sm font-medium">负责代表 ({selectedRepIds.length} 位)</label>
            <div className="border rounded-md max-h-40 overflow-y-auto p-2 space-y-1 mt-1">
              {reps.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={selectedRepIds.includes(r.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedRepIds([...selectedRepIds, r.id]);
                      else setSelectedRepIds(selectedRepIds.filter((id) => id !== r.id));
                    }}
                  />
                  {r.name} <span className="text-xs text-muted-foreground">{r.email}</span>
                </label>
              ))}
              {reps.length === 0 && <p className="text-xs text-muted-foreground p-2">暂无代表</p>}
            </div>
          </div>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || (!edit && !selectedUserId)} className="w-full">
            {mutation.isPending ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
