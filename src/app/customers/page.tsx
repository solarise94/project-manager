"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  Merge,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { OrganizationSelect } from "@/components/organization-select";
import { DraftInputPanel } from "@/components/draft-input-panel";
import type { CustomerItem } from "@/lib/types";

const emptyForm = {
  name: "",
  principal: "",
  email: "",
  wechat: "",
  organization: "",
  address: "",
  miniProgramId: "",
  organizationId: "",
  organizationSiteId: "",
  organizationRawInput: "",
};

export default function CustomersPage() {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerItem | null>(null);
  const [mergeSource, setMergeSource] = useState<CustomerItem | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [form, setForm] = useState({ ...emptyForm });
  const [editForm, setEditForm] = useState({ ...emptyForm });

  const isReadOnly = session?.user?.role === "REPRESENTATIVE";

  const { data, isLoading, error } = useQuery<{ customers: CustomerItem[] }>({
    queryKey: ["customers", showArchived],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (showArchived) params.set("archived", "true");
      const res = await fetch(`/api/customers?${params}`);
      if (!res.ok) throw new Error("加载客户列表失败");
      return res.json();
    },
    enabled: status === "authenticated",
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof emptyForm) => {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      return data;
    },
    onSuccess: () => {
      toast.success("客户创建成功");
      setCreateOpen(false);
      setForm({ ...emptyForm });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...payload }: { id: string } & Partial<typeof emptyForm>) => {
      const res = await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新失败");
      return data;
    },
    onSuccess: () => {
      toast.success("客户信息已更新");
      setEditOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const res = await fetch(`/api/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.archived ? "客户已归档" : "客户已恢复");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      return data;
    },
    onSuccess: () => {
      toast.success("客户已删除");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      const res = await fetch(`/api/customers/${sourceId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "合并失败");
      return data;
    },
    onSuccess: () => {
      toast.success("客户已合并");
      setMergeOpen(false);
      setMergeSource(null);
      setMergeTargetId("");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (status === "loading") return null;
  if (!session) return null;

  const customers = data?.customers || [];
  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.customerCode.toLowerCase().includes(search.toLowerCase()) ||
      (c.organization || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.email || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" />
          客户管理
        </h1>
        <p className="text-muted-foreground">管理客户联系方式和客户关系信息</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索客户..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {!isReadOnly && (
          <Select value={showArchived ? "all" : "active"} onValueChange={(v) => setShowArchived(v === "all")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">活跃</SelectItem>
              <SelectItem value="all">含已归档</SelectItem>
            </SelectContent>
          </Select>
        )}
        {!isReadOnly && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新增客户
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-destructive">加载失败：{(error as Error).message}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">{search ? "未找到匹配的客户" : "暂无客户"}</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">编号</th>
                <th className="text-left px-4 py-3 font-medium">客户</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">单位</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">联系方式</th>
                <th className="text-left px-4 py-3 font-medium">项目</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">状态</th>
                {!isReadOnly && <th className="text-right px-4 py-3 font-medium">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((c) => (
                <tr key={c.id} className={`hover:bg-muted/50 ${c.archived ? "opacity-60 bg-muted/20" : ""}`}>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{c.customerCode}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center shrink-0">
                        {c.name.slice(0, 2)}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">{c.name}</span>
                        {c.principal && <span className="text-xs text-muted-foreground">负责人: {c.principal}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{c.organization || "-"}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-col text-xs text-muted-foreground">
                      {c.email && <span>{c.email}</span>}
                      {c.wechat && <span>微信: {c.wechat}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-xs">{c._count?.projects ?? 0} 个</Badge>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {c.archived ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        <Archive className="h-3 w-3 mr-1" />已归档
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700">活跃</Badge>
                    )}
                  </td>
                  {!isReadOnly && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => {
                          setEditing(c);
                          setEditForm({
                            name: c.name,
                            principal: c.principal || "",
                            email: c.email || "",
                            wechat: c.wechat || "",
                            organization: c.organization || "",
                            address: c.address || "",
                            miniProgramId: c.miniProgramId || "",
                            organizationId: c.organizationId || "",
                            organizationSiteId: c.organizationSiteId || "",
                            organizationRawInput: c.organizationRawInput || "",
                          });
                          setEditOpen(true);
                        }}>
                          <Pencil className="h-3 w-3 mr-1" />编辑
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => {
                          setMergeSource(c);
                          setMergeTargetId("");
                          setMergeOpen(true);
                        }}>
                          <Merge className="h-3 w-3 mr-1" />合并
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className={c.archived ? "text-green-600 hover:text-green-700 hover:bg-green-50" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"}
                          onClick={() => {
                            const action = c.archived ? "恢复" : "归档";
                            if (confirm(`确定要${action}客户 "${c.name}" 吗？`)) {
                              archiveMutation.mutate({ id: c.id, archived: !c.archived });
                            }
                          }}
                        >
                          {c.archived ? <><ArchiveRestore className="h-3 w-3 mr-1" />恢复</> : <><Archive className="h-3 w-3 mr-1" />归档</>}
                        </Button>
                        {(c._count?.projects ?? 0) === 0 && (
                          <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              if (confirm(`确定要删除客户 "${c.name}" 吗？此操作不可恢复。`)) {
                                deleteMutation.mutate(c.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />删除
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>新增客户</DialogTitle></DialogHeader>
          <DraftInputPanel
            formKey="customer.create"
            fieldLabels={{
              name: "客户姓名",
              organization: "单位",
              principal: "课题组负责人",
              email: "邮箱",
              wechat: "微信",
              address: "通讯地址",
            }}
            onApply={async (fields) => {
              const updates: Partial<typeof emptyForm> = {};
              if (typeof fields.name === "string" && fields.name.trim()) updates.name = fields.name.trim();
              if (typeof fields.principal === "string") updates.principal = fields.principal.trim();
              if (typeof fields.email === "string") updates.email = fields.email.trim();
              if (typeof fields.wechat === "string") updates.wechat = fields.wechat.trim();
              if (typeof fields.address === "string") updates.address = fields.address.trim();
              // Handle organization entity
              const orgField = fields.organization;
              if (orgField && typeof orgField === "object" && "matched" in orgField) {
                const entity = orgField as { id?: string; name: string; matched: boolean; address?: string; shouldCreate?: boolean };
                if (entity.matched && entity.id) {
                  updates.organizationId = entity.id;
                  updates.organization = entity.name;
                  updates.organizationRawInput = entity.name;
                  if (entity.address) updates.address = entity.address;
                } else if (entity.shouldCreate && entity.name.trim()) {
                  try {
                    const res = await fetch("/api/organizations/quick-create", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ canonicalName: entity.name.trim() }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      updates.organizationId = data.organization.id;
                      updates.organization = data.organization.canonicalName;
                      updates.organizationRawInput = data.organization.canonicalName;
                      if (data.organization.address) updates.address = data.organization.address;
                    } else {
                      const err = await res.json().catch(() => ({}));
                      toast.error(err.error || "单位创建失败，请手动选择");
                      // Clear org binding — creation failed
                      updates.organizationId = "";
                      updates.organizationSiteId = "";
                    }
                  } catch {
                    toast.error("单位创建失败");
                    updates.organizationId = "";
                    updates.organizationSiteId = "";
                  }
                } else {
                  // Unmatched, user declined create — clear org binding
                  updates.organizationId = "";
                  updates.organizationSiteId = "";
                  updates.organization = entity.name;
                  updates.organizationRawInput = entity.name;
                }
              } else if (typeof orgField === "string" && orgField.trim()) {
                // Plain text org — clear any previous binding
                updates.organizationId = "";
                updates.organizationSiteId = "";
                updates.organization = orgField.trim();
                updates.organizationRawInput = orgField.trim();
              }
              setForm((prev) => ({ ...prev, ...updates }));
            }}
          />
          <form onSubmit={(e) => { e.preventDefault(); if (!form.name.trim()) return; createMutation.mutate(form); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>客户姓名 *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>课题组负责人</Label>
                <Input value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>邮箱</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>微信</Label>
                <Input value={form.wechat} onChange={(e) => setForm({ ...form, wechat: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>客户单位</Label>
              <OrganizationSelect
                value={form.organizationId}
                displayValue={form.organization || undefined}
                onChange={(id, name, address) => {
                  setForm({
                    ...form,
                    organization: name,
                    organizationId: id || "",
                    organizationSiteId: "",
                    organizationRawInput: name,
                    // When selecting an org, always sync address (even if empty);
                    // when clearing org selection, keep current address
                    address: id ? (address || "") : form.address,
                  });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>通讯地址</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>小程序 ID</Label>
              <Input value={form.miniProgramId} onChange={(e) => setForm({ ...form, miniProgramId: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? "创建中..." : "创建客户"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>编辑客户信息</DialogTitle></DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            const updates: Record<string, string | boolean> = {};
            for (const key of Object.keys(emptyForm) as (keyof typeof emptyForm)[]) {
              const oldVal = key === "name" ? editing.name : (editing[key as keyof CustomerItem] as string) || "";
              if (editForm[key] !== oldVal) updates[key] = editForm[key];
            }
            if (Object.keys(updates).length === 0) { setEditOpen(false); return; }
            updateMutation.mutate({ id: editing.id, ...updates });
          }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>客户姓名 *</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>课题组负责人</Label>
                <Input value={editForm.principal} onChange={(e) => setEditForm({ ...editForm, principal: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>邮箱</Label>
                <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>微信</Label>
                <Input value={editForm.wechat} onChange={(e) => setEditForm({ ...editForm, wechat: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>客户单位</Label>
              <OrganizationSelect
                value={editForm.organizationId}
                displayValue={editForm.organization || undefined}
                onChange={(id, name, address) => {
                  setEditForm({
                    ...editForm,
                    organization: name,
                    organizationId: id || "",
                    organizationSiteId: "",
                    organizationRawInput: name,
                    address: id ? (address || "") : editForm.address,
                  });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>通讯地址</Label>
              <Input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>小程序 ID</Label>
              <Input value={editForm.miniProgramId} onChange={(e) => setEditForm({ ...editForm, miniProgramId: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
              <Pencil className="mr-2 h-4 w-4" />
              {updateMutation.isPending ? "保存中..." : "保存修改"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>合并客户</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              将 <span className="font-medium text-foreground">{mergeSource?.name}</span> ({mergeSource?.customerCode}) 的所有关联项目转移到目标客户，源客户将被标记为已删除。
            </p>
            <div className="space-y-2">
              <Label>目标客户</Label>
              <Select value={mergeTargetId} onValueChange={(v) => setMergeTargetId(v || "")}>
                <SelectTrigger><SelectValue placeholder="选择目标客户..." /></SelectTrigger>
                <SelectContent>
                  {customers.filter((c) => c.id !== mergeSource?.id && !c.archived && !c.deleted).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.customerCode})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!mergeTargetId || mergeMutation.isPending}
              onClick={() => {
                if (!mergeSource || !mergeTargetId) return;
                const target = customers.find((c) => c.id === mergeTargetId);
                if (confirm(`确定要将 "${mergeSource.name}" 合并到 "${target?.name}" 吗？此操作不可撤销。`)) {
                  mergeMutation.mutate({ sourceId: mergeSource.id, targetId: mergeTargetId });
                }
              }}
            >
              <Merge className="mr-2 h-4 w-4" />
              {mergeMutation.isPending ? "合并中..." : "确认合并"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
