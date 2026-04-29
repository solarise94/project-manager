"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface ChannelItem {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  archived: boolean;
}

export default function ProcurementChannelsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChannelItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { data, isLoading } = useQuery<{ channels: ChannelItem[] }>({
    queryKey: ["procurement-channels", "admin"],
    queryFn: async () => {
      const res = await fetch("/api/procurement-channels?includeArchived=true");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const channels = data?.channels || [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editing
        ? `/api/procurement-channels/${editing.id}`
        : "/api/procurement-channels";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, description: formDesc, isDefault: formIsDefault }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "保存失败");
      return d;
    },
    onSuccess: () => {
      toast.success(editing ? "已更新" : "已创建");
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["procurement-channels", "admin"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const res = await fetch(`/api/procurement-channels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) throw new Error("操作失败");
    },
    onSuccess: () => {
      toast.success("已更新");
      queryClient.invalidateQueries({ queryKey: ["procurement-channels", "admin"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (status === "loading") return null;
  if (!session || session.user.role !== "ADMIN") {
    router.replace("/dashboard");
    return null;
  }

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormDesc("");
    setFormIsDefault(false);
    setDialogOpen(true);
  };

  const openEdit = (c: ChannelItem) => {
    setEditing(c);
    setFormName(c.name);
    setFormDesc(c.description || "");
    setFormIsDefault(c.isDefault);
    setDialogOpen(true);
  };

  const displayed = showArchived ? channels : channels.filter((c) => !c.archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">采购渠道管理</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={showArchived ? "secondary" : "ghost"} onClick={() => setShowArchived(!showArchived)} className="text-xs">
            {showArchived ? "隐藏已归档" : "显示已归档"}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3 w-3" /> 新建
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">加载中...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">暂无采购渠道</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">名称</th>
                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">说明</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {c.name}
                      {c.isDefault && <Badge variant="secondary" className="text-[10px]">默认</Badge>}
                      {c.archived && <Badge variant="outline" className="text-[10px]">已归档</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{c.description || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)} title="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!c.archived && !c.isDefault && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => archiveMutation.mutate({ id: c.id, archived: true })} title="归档">
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {c.archived && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => archiveMutation.mutate({ id: c.id, archived: false })} title="取消归档">
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑采购渠道" : "新建采购渠道"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">名称 *</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="渠道名称" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">说明</Label>
              <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="备注说明" className="h-8 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={formIsDefault} onCheckedChange={(v) => setFormIsDefault(!!v)} id="isDefault" />
              <Label htmlFor="isDefault" className="text-xs">设为默认采购渠道</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button size="sm" disabled={!formName.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {editing ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
