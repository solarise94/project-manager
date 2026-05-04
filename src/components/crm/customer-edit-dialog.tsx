"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { OrganizationSelect } from "@/components/organization-select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crmKeys } from "@/lib/crm/query-keys";
import { CRM_PERSON_CATEGORIES, PERSON_CATEGORY_LABELS } from "@/lib/crm/constants";
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
  labOrGroup: string;
  personCategory: string;
  jobTitle: string;
  graduationDate: string;
}

const emptyForm: CustomerEditForm = {
  name: "", principal: "", email: "", wechat: "",
  organization: "", organizationId: "", organizationSiteId: "",
  organizationRawInput: "", address: "", miniProgramId: "",
  labOrGroup: "", personCategory: "", jobTitle: "", graduationDate: "",
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
  const [profileId, setProfileId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const [custRes, profileRes] = await Promise.all([
          fetch(`/api/customers/${customerId}`),
          sourceCustomerId ? fetch(`/api/crm/profiles?sourceCustomerId=${encodeURIComponent(sourceCustomerId)}`) : null,
        ]);
        if (cancelled) return;

        const custData = await custRes.json();
        let profileData: { profiles?: { id: string; personCategory: string | null; jobTitle: string | null; graduationDate: string | null }[] } | null = null;
        if (profileRes) profileData = await profileRes.json();

        if (custData.customer) {
          const c = custData.customer;
          const pf = profileData?.profiles?.[0] || null;
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
            labOrGroup: c.labOrGroup || "",
            personCategory: pf?.personCategory || "",
            jobTitle: pf?.jobTitle || "",
            graduationDate: pf?.graduationDate ? pf.graduationDate.slice(0, 10) : "",
          };
          setForm(f);
          setOriginal(f);
          if (pf) setProfileId(pf.id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, customerId, sourceCustomerId]);

  const mutation = useMutation({
    mutationFn: async () => {
      const customerFields: (keyof CustomerEditForm)[] = ["name", "principal", "email", "wechat", "organization", "organizationId", "organizationSiteId", "organizationRawInput", "address", "miniProgramId", "labOrGroup"];
      const profileFields: (keyof CustomerEditForm)[] = ["personCategory", "jobTitle", "graduationDate"];

      const custDiff: Record<string, string | null> = {};
      for (const key of customerFields) {
        if (form[key] !== original[key]) custDiff[key] = form[key] || null;
      }

      const profileDiff: Record<string, string | null> = {};
      for (const key of profileFields) {
        if (form[key] !== original[key]) profileDiff[key] = form[key] || null;
      }

      if (Object.keys(custDiff).length === 0 && Object.keys(profileDiff).length === 0) {
        onOpenChange(false);
        return;
      }

      if (Object.keys(custDiff).length > 0) {
        if (custDiff.name === null || custDiff.name === "") {
          throw new Error("客户姓名不能为空");
        }
        const res = await fetch(`/api/customers/${customerId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(custDiff),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "保存失败");
        }
      }

      if (Object.keys(profileDiff).length > 0 && profileId) {
        const res = await fetch(`/api/crm/profiles/${profileId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profileDiff),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "CRM 档案更新失败");
        }
      }

      return true;
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
            <div className="space-y-2">
              <Label>课题组/实验室</Label>
              <Input
                placeholder="例如：朱雪琼课题 507"
                value={form.labOrGroup}
                onChange={(e) => setForm({ ...form, labOrGroup: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>人员分类</Label>
              <Select value={form.personCategory || "__none__"} onValueChange={(v) => { if (v) setForm({ ...form, personCategory: v === "__none__" ? "" : v }); }}>
                <SelectTrigger><span>{form.personCategory ? PERSON_CATEGORY_LABELS[form.personCategory] || form.personCategory : "选择人员分类（可选）"}</span></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不设置</SelectItem>
                  {CRM_PERSON_CATEGORIES.map((pc) => (
                    <SelectItem key={pc} value={pc}>{PERSON_CATEGORY_LABELS[pc]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>职务/身份</Label>
              <Input
                placeholder="例如：教授、博士生、实验员"
                value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              />
            </div>
            {form.personCategory === "STUDENT" && (
              <div className="space-y-2">
                <Label>预计毕业时间</Label>
                <Input
                  type="date"
                  value={form.graduationDate}
                  onChange={(e) => setForm({ ...form, graduationDate: e.target.value })}
                />
              </div>
            )}
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
