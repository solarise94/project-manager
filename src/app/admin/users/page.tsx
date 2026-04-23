"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Save, Users, Shield, User } from "lucide-react";
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

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "USER", password: "" });

  const { data, isLoading, error } = useQuery<{ users: UserItem[] }>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (res.status === 403) {
        router.push("/dashboard");
        throw new Error("无权访问");
      }
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
    enabled: status === "authenticated",
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新失败");
      return data;
    },
    onSuccess: () => {
      toast.success("用户更新成功");
      setEditUser(null);
      setEditForm({ name: "", email: "", role: "USER", password: "" });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Redirect non-admin users
  if (status === "authenticated" && session?.user?.role !== "ADMIN") {
    router.push("/dashboard");
    return null;
  }

  if (status === "loading") return null;
  if (!session || session.user.role !== "ADMIN") return null;
  if (error?.message === "无权访问") return null;

  const users = data?.users || [];
  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" />
          用户管理
        </h1>
        <p className="text-muted-foreground">管理系统中的所有用户</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索用户..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">未找到用户</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">用户</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">邮箱</th>
                <th className="text-left px-4 py-3 font-medium">角色</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">注册时间</th>
                <th className="text-right px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((user) => (
                <tr key={user.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center shrink-0">
                        {user.name?.slice(0, 2)?.toUpperCase() || "U"}
                      </div>
                      <span className="font-medium">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{user.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={user.role === "ADMIN" ? "default" : "secondary"} className="text-xs">
                      {user.role === "ADMIN" ? (
                        <span className="flex items-center gap-1">
                          <Shield className="h-3 w-3" />管理员
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />用户
                        </span>
                      )}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditUser(user);
                        setEditForm({ name: user.name, email: user.email, role: user.role, password: "" });
                      }}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      编辑
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>昵称</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>角色</Label>
              <Select
                value={editForm.role}
                onValueChange={(v) => setEditForm({ ...editForm, role: v || "USER" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">用户</SelectItem>
                  <SelectItem value="ADMIN">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>新密码（留空则不修改）</Label>
              <Input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="输入新密码"
              />
            </div>
            <Button
              className="w-full"
              disabled={updateMutation.isPending}
              onClick={() => {
                if (!editUser) return;
                const payload: Record<string, unknown> = {
                  name: editForm.name.trim(),
                  email: editForm.email.trim(),
                  role: editForm.role,
                };
                if (editForm.password.trim()) {
                  payload.password = editForm.password.trim();
                }
                updateMutation.mutate({ id: editUser.id, payload });
              }}
            >
              <Save className="mr-2 h-4 w-4" />
              {updateMutation.isPending ? "保存中..." : "保存更改"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
