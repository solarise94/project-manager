"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  Send,
  Handshake,
  Mail,
  Pencil,
  Archive,
  ArchiveRestore,
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
import { toast } from "sonner";

interface RepItem {
  id: string;
  name: string;
  email: string;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  _count?: { projects: number };
}

export default function AdminRepresentativesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<RepItem | null>(null);
  const [form, setForm] = useState({ name: "", email: "" });
  const [editForm, setEditForm] = useState({ name: "", email: "" });

  const { data, isLoading, error } = useQuery<{ representatives: RepItem[] }>({
    queryKey: ["admin-representatives"],
    queryFn: async () => {
      const res = await fetch("/api/representatives");
      if (res.status === 403) throw new Error("无权访问");
      if (!res.ok) throw new Error("Failed to load representatives");
      return res.json();
    },
    enabled: status === "authenticated" && session?.user?.role === "ADMIN",
  });

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/dashboard");
    }
    if (error?.message === "无权访问") {
      router.push("/dashboard");
    }
  }, [status, session, error, router]);

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; email: string }) => {
      const res = await fetch("/api/representatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      return data;
    },
    onSuccess: (data) => {
      if (data.warning) {
        toast.warning(data.warning);
      } else {
        toast.success("代表添加成功，Magic Link 已发送");
      }
      setOpen(false);
      setForm({ name: "", email: "" });
      queryClient.invalidateQueries({ queryKey: ["admin-representatives"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; name?: string; email?: string }) => {
      const res = await fetch(`/api/representatives/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: payload.name, email: payload.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新失败");
      return data;
    },
    onSuccess: () => {
      toast.success("代表信息已更新");
      setEditOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin-representatives"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const res = await fetch(`/api/representatives/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.archived ? "代表已归档" : "代表已恢复");
      queryClient.invalidateQueries({ queryKey: ["admin-representatives"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resendMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/representatives/${id}/resend`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "重发失败");
      return data;
    },
    onSuccess: () => {
      toast.success("Magic Link 已重新发送");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (status === "loading") return null;
  if (!session || session.user.role !== "ADMIN") return null;
  if (error?.message === "无权访问") return null;

  const reps = data?.representatives || [];
  const filtered = reps.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Handshake className="h-6 w-6" />
          代表管理
        </h1>
        <p className="text-muted-foreground">管理项目代表，发送 Magic Link 登录链接</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索代表..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          添加代表
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-destructive">加载失败：{error.message}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">暂无代表，点击右上角添加</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">代表</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">邮箱</th>
                <th className="text-left px-4 py-3 font-medium">关联项目</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">状态</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((rep) => (
                <tr
                  key={rep.id}
                  className={`hover:bg-muted/50 ${rep.archived ? "opacity-60 bg-muted/20" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-amber-500 text-white text-xs flex items-center justify-center shrink-0">
                        {rep.name?.slice(0, 2)?.toUpperCase() || "R"}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">{rep.name}</span>
                        <span className="text-xs text-muted-foreground sm:hidden">
                          {rep.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{rep.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-xs">
                      {rep._count?.projects ?? 0} 个项目
                    </Badge>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {rep.archived ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        <Archive className="h-3 w-3 mr-1" />
                        已归档
                        {rep.archivedAt && (
                          <span className="ml-1">
                            ({new Date(rep.archivedAt).toLocaleDateString("zh-CN")})
                          </span>
                        )}
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700">
                        在职
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(rep);
                          setEditForm({ name: rep.name, email: rep.email });
                          setEditOpen(true);
                        }}
                        title="编辑"
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resendMutation.mutate(rep.id)}
                        disabled={resendMutation.isPending || rep.archived}
                        title="重发 Magic Link"
                      >
                        <Send className="h-3 w-3 mr-1" />
                        重发
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={
                          rep.archived
                            ? "text-green-600 hover:text-green-700 hover:bg-green-50"
                            : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                        }
                        onClick={() => {
                          const action = rep.archived ? "恢复" : "归档";
                          if (confirm(`确定要${action}代表 "${rep.name}" 吗？`)) {
                            archiveMutation.mutate({ id: rep.id, archived: !rep.archived });
                          }
                        }}
                      >
                        {rep.archived ? (
                          <>
                            <ArchiveRestore className="h-3 w-3 mr-1" />
                            恢复
                          </>
                        ) : (
                          <>
                            <Archive className="h-3 w-3 mr-1" />
                            归档
                          </>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加代表</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name.trim() || !form.email.trim()) return;
              createMutation.mutate({ name: form.name.trim(), email: form.email.trim() });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>代表姓名</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入代表姓名"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>通知邮箱</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="代表用于接收通知和登录的邮箱"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              <Mail className="mr-2 h-4 w-4" />
              {createMutation.isPending ? "发送中..." : "添加并发送 Magic Link"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑代表信息</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editing) return;
              const updates: { name?: string; email?: string } = {};
              if (editForm.name.trim() !== editing.name) updates.name = editForm.name.trim();
              if (editForm.email.trim().toLowerCase() !== editing.email) {
                updates.email = editForm.email.trim().toLowerCase();
              }
              if (Object.keys(updates).length === 0) {
                setEditOpen(false);
                return;
              }
              updateMutation.mutate({ id: editing.id, ...updates });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>代表姓名</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="请输入代表姓名"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>通知邮箱</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                placeholder="代表用于接收通知和登录的邮箱"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
              <Pencil className="mr-2 h-4 w-4" />
              {updateMutation.isPending ? "保存中..." : "保存修改"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
