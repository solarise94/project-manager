"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { TaxIdLookupInput } from "@/components/tax-id-lookup-input";
import { toast } from "sonner";

interface BillingProfileItem {
  id: string;
  name: string;
  taxId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  address: string | null;
  phone: string | null;
  isDefault: boolean;
  archived: boolean;
}

interface FormState {
  name: string;
  taxId: string;
  bankName: string;
  bankAccount: string;
  address: string;
  phone: string;
  isDefault: boolean;
}

const emptyForm: FormState = {
  name: "", taxId: "", bankName: "", bankAccount: "", address: "", phone: "", isDefault: false,
};

export default function BillingProfilesPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BillingProfileItem | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [showArchived, setShowArchived] = useState(false);

  const { data, isLoading } = useQuery<{ profiles: BillingProfileItem[] }>({
    queryKey: ["billing-profiles", "admin"],
    queryFn: async () => {
      const res = await fetch("/api/billing-profiles?includeArchived=1");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const profiles = data?.profiles || [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editing
        ? `/api/billing-profiles/${editing.id}`
        : "/api/billing-profiles";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "保存失败");
      return d;
    },
    onSuccess: () => {
      toast.success(editing ? "已更新" : "已创建");
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["billing-profiles", "admin"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const res = await fetch(`/api/billing-profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) throw new Error("操作失败");
    },
    onSuccess: () => {
      toast.success("已更新");
      queryClient.invalidateQueries({ queryKey: ["billing-profiles", "admin"] });
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
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (p: BillingProfileItem) => {
    setEditing(p);
    setForm({
      name: p.name,
      taxId: p.taxId || "",
      bankName: p.bankName || "",
      bankAccount: p.bankAccount || "",
      address: p.address || "",
      phone: p.phone || "",
      isDefault: p.isDefault,
    });
    setDialogOpen(true);
  };

  const displayed = showArchived ? profiles : profiles.filter((p) => !p.archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">开票主体管理</h1>
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
        <div className="text-center py-8 text-sm text-muted-foreground">暂无开票主体</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">名称</th>
                <th className="text-left px-3 py-2 font-medium">税号</th>
                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">开户行</th>
                <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">账号</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {p.name}
                      {p.isDefault && <Badge variant="secondary" className="text-[10px]">默认</Badge>}
                      {p.archived && <Badge variant="outline" className="text-[10px]">已归档</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.taxId || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{p.bankName || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{p.bankAccount || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)} title="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => archiveMutation.mutate({ id: p.id, archived: !p.archived })}
                        title={p.archived ? "取消归档" : "归档"}
                      >
                        {p.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      </Button>
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
            <DialogTitle>{editing ? "编辑开票主体" : "新建开票主体"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">名称 *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="公司名称" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">税号</Label>
              <TaxIdLookupInput
                value={form.taxId}
                onChange={(v) => setForm({ ...form, taxId: v })}
                orgName={form.name}
                placeholder="统一社会信用代码"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">开户行</Label>
                <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="开户银行" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">银行账号</Label>
                <Input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} placeholder="账号" className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">地址</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="公司地址" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">电话</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="联系电话" className="h-8 text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: !!v })} id="isDefault" />
              <Label htmlFor="isDefault" className="text-xs">设为默认开票主体</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button size="sm" disabled={!form.name.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {editing ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
