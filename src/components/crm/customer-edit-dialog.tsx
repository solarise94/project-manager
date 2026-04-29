"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrganizationSelect } from "@/components/organization-select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crmKeys } from "@/lib/crm/query-keys";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

interface CustomerEditForm {
  name: string;
  principal: string;
  email: string;
  wechat: string;
  organization: string;
  organizationId: string;
  organizationSiteId: string;
  organizationRawInput: string;
  address: string;
  miniProgramId: string;
}

const emptyForm: CustomerEditForm = {
  name: "", principal: "", email: "", wechat: "",
  organization: "", organizationId: "", organizationSiteId: "",
  organizationRawInput: "", address: "", miniProgramId: "",
};

export function CustomerEditDialog({
  customerId,
  sourceCustomerId,
  open,
  onOpenChange,
}: {
  customerId: string;
  sourceCustomerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<CustomerEditForm>(emptyForm);
  const [original, setOriginal] = useState<CustomerEditForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/customers/${customerId}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.customer) {
          const c = data.customer;
          const f: CustomerEditForm = {
            name: c.name || "",
            principal: c.principal || "",
            email: c.email || "",
            wechat: c.wechat || "",
            organization: c.organization || "",
            organizationId: c.organizationId || "",
            organizationSiteId: c.organizationSiteId || "",
            organizationRawInput: c.organization || "",
            address: c.address || "",
            miniProgramId: c.miniProgramId || "",
          };
          setForm(f);
          setOriginal(f);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, customerId]);

  const mutation = useMutation({
    mutationFn: async () => {
      const diff: Record<string, string | null> = {};
      for (const key of Object.keys(form) as (keyof CustomerEditForm)[]) {
        if (form[key] !== original[key]) diff[key] = form[key] || null;
      }
      if (Object.keys(diff).length === 0) {
        onOpenChange(false);
        return;
      }
      if (diff.name === null || diff.name === "") {
        throw new Error("客户姓名不能为空");
      }
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(diff),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }
      return res.json();
    },
    onSuccess: async (data) => {
      if (data) {
        toast.success("客户信息已更新");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: crmKeys.profiles() }),
          queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(sourceCustomerId) }),
          queryClient.invalidateQueries({ queryKey: crmKeys.customers() }),
          queryClient.invalidateQueries({ queryKey: crmKeys.customersList() }),
          queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("crm-relations") }),
        ]);
      }
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑客户信息</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            加载中...
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>客户姓名 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>课题组负责人</Label>
                <Input
                  value={form.principal}
                  onChange={(e) =>
                    setForm({ ...form, principal: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>邮箱</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>微信</Label>
                <Input
                  value={form.wechat}
                  onChange={(e) => setForm({ ...form, wechat: e.target.value })}
                />
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
                    address: id ? (address || "") : form.address,
                  });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>通讯地址</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>小程序 ID</Label>
              <Input
                value={form.miniProgramId}
                onChange={(e) =>
                  setForm({ ...form, miniProgramId: e.target.value })
                }
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending}
            >
              <Pencil className="mr-2 h-4 w-4" />
              {mutation.isPending ? "保存中..." : "保存修改"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
