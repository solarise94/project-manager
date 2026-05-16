"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  Merge,
  Users,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
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
  SelectDisplay,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { OrganizationSelect } from "@/components/organization-select";
import { CustomerApplicationFormDialog } from "@/components/crm/customer-application-form-dialog";
import { DraftInputPanel } from "@/components/draft-input-panel";
import type { CustomerItem } from "@/lib/types";

const emptyForm = {
  name: "",
  organization: "",
  miniProgramId: "",
  organizationId: "",
  organizationSiteId: "",
  organizationRawInput: "",
};

export default function CustomersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerItem | null>(null);
  const [mergeSource, setMergeSource] = useState<CustomerItem | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [editForm, setEditForm] = useState({ ...emptyForm });

  const isReadOnly = session?.user?.role === "REPRESENTATIVE";

  const { data, isLoading, error } = useQuery<{ customers: (CustomerItem & { crmProfile?: { id: string; sourceCustomerId: string } | null })[]; total: number; page: number; pageSize: number; totalPages: number }>({
    queryKey: ["customers", showArchived, page, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (showArchived) params.set("archived", "true");
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("pageSize", "20");
      const res = await fetch(`/api/customers?${params}`);
      if (!res.ok) throw new Error("加载客户列表失败");
      return res.json();
    },
    enabled: status === "authenticated",
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
      (c.organization || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" />
          客户管理
        </h1>
        <p className="text-muted-foreground">查看客户主数据、项目绑定、归档、合并和 CRM 入口</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 min-w-0">
        <div className="relative flex-1 max-w-md min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索客户..."
            className="pl-9 w-full"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        {!isReadOnly && (
          <Select value={showArchived ? "all" : "active"} onValueChange={(v) => setShowArchived(v === "all")}>
            <SelectTrigger className="w-full sm:w-32">
              <SelectDisplay label="归档" valueLabel={showArchived ? "含已归档" : "活跃"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">活跃</SelectItem>
              <SelectItem value="all">含已归档</SelectItem>
            </SelectContent>
          </Select>
        )}
        <CustomerApplicationFormDialog />
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
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {filtered.map((c) => {
              const hasCrm = !!c.crmProfile;
              const sourceCustomerId = c.crmProfile?.sourceCustomerId || c.id;
              return (
                <div
                  key={c.id}
                  className={`rounded-lg border bg-card p-4 space-y-3 ${hasCrm ? "cursor-pointer" : ""} ${c.archived ? "opacity-60 bg-muted/20" : ""}`}
                  onClick={() => {
                    if (hasCrm) {
                      router.push(`/crm/customers/${sourceCustomerId}`);
                    }
                  }}
                >
                  {/* Row 1: name + status */}
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="truncate text-base font-medium">{c.name}</span>
                    {c.archived ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground shrink-0">
                        <Archive className="h-3 w-3 mr-1" />已归档
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700 shrink-0">活跃</Badge>
                    )}
                  </div>
                  {/* Row 2: code + org */}
                  <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
                    <span className="font-mono text-xs shrink-0">{c.customerCode}</span>
                    <span className="shrink-0">·</span>
                    <span className="truncate">{c.organization || "-"}</span>
                  </div>
                  {/* Row 3: projects + CRM */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">{c._count?.projects ?? 0} 个项目</Badge>
                    {hasCrm ? (
                      <Link href={`/crm/customers/${sourceCustomerId}`} onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          查看 CRM
                        </Button>
                      </Link>
                    ) : !isReadOnly ? (
                      <Link href="/crm/customers" onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          去客户档案库
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                  {/* Row 4: actions */}
                  {!isReadOnly && (
                    <div className="grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => {
                        setEditing(c);
                        setEditForm({
                          name: c.name,
                          organization: c.organization || "",
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
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">编号</th>
                  <th className="text-left px-4 py-3 font-medium">客户</th>
                  <th className="text-left px-4 py-3 font-medium">单位</th>
                  <th className="text-left px-4 py-3 font-medium">项目</th>
                  <th className="text-left px-4 py-3 font-medium">状态</th>
                  <th className="text-left px-4 py-3 font-medium">CRM</th>
                  {!isReadOnly && <th className="text-right px-4 py-3 font-medium">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c) => {
                  const hasCrm = !!c.crmProfile;
                  const sourceCustomerId = c.crmProfile?.sourceCustomerId || c.id;
                  return (
                  <tr key={c.id} className={`hover:bg-muted/50 ${c.archived ? "opacity-60 bg-muted/20" : ""}`}>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{c.customerCode}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium truncate block max-w-[160px]">{c.name}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="truncate block max-w-[200px]">{c.organization || "-"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="text-xs">{c._count?.projects ?? 0} 个</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {c.archived ? (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          <Archive className="h-3 w-3 mr-1" />已归档
                        </Badge>
                      ) : (
                        <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700">活跃</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {hasCrm ? (
                        <Link href={`/crm/customers/${sourceCustomerId}`}>
                          <Button variant="outline" size="sm">
                            <ExternalLink className="h-3 w-3 mr-1" />
                            查看 CRM
                          </Button>
                        </Link>
                      ) : !isReadOnly ? (
                        <Link href="/crm/customers">
                          <Button variant="outline" size="sm">
                            <ExternalLink className="h-3 w-3 mr-1" />
                            去客户档案库
                          </Button>
                        </Link>
                      ) : null}
                    </td>
                    {!isReadOnly && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <Button variant="ghost" size="sm" onClick={() => {
                            setEditing(c);
                            setEditForm({
                              name: c.name,
                              organization: c.organization || "",
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Edit Dialog — simplified: name + org + miniProgramId only */}
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
            <DraftInputPanel
              formKey="customer.create"
              fieldLabels={{
                name: "客户姓名",
                organization: "客户单位",
                miniProgramId: "小程序 ID",
              }}
              onApply={(fields) => {
                setEditForm((prev) => ({ ...prev, ...fields }));
              }}
            />
            <div className="space-y-2">
              <Label>客户姓名 *</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>客户单位</Label>
              <OrganizationSelect
                value={editForm.organizationId}
                displayValue={editForm.organization || undefined}
                onChange={(id, name) => {
                  setEditForm({
                    ...editForm,
                    organization: name,
                    organizationId: id || "",
                    organizationSiteId: "",
                    organizationRawInput: name,
                  });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>小程序 ID</Label>
              <Input value={editForm.miniProgramId} onChange={(e) => setEditForm({ ...editForm, miniProgramId: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">联系信息请通过 CRM 档案编辑。</p>
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

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">共 {data.total} 条，第 {data.page}/{data.totalPages} 页</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
