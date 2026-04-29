"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrganizationSelect } from "@/components/organization-select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crmKeys } from "@/lib/crm/query-keys";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";

const emptyForm = {
  name: "",
  principal: "",
  email: "",
  wechat: "",
  organization: "",
  organizationId: "",
  organizationSiteId: "",
  address: "",
  miniProgramId: "",
  notes: "",
};

export function CustomerApplicationFormDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/customer-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "提交失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("客户申请已提交，等待管理员审核");
      queryClient.invalidateQueries({ queryKey: crmKeys.customerApplications() });
      setOpen(false);
      setForm({ ...emptyForm });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <UserPlus className="h-4 w-4 mr-1" />申请新增客户
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>申请新增客户</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (!form.name.trim()) return; mutation.mutate(); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
                onChange={(e) => setForm({ ...form, principal: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
              onChange={(id, name) => {
                setForm({
                  ...form,
                  organization: name,
                  organizationId: id || "",
                  organizationSiteId: "",
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
              onChange={(e) => setForm({ ...form, miniProgramId: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>备注</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="申请说明或其他备注信息"
              rows={3}
            />
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending || !form.name.trim()}>
            {mutation.isPending ? "提交中..." : "提交申请"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
