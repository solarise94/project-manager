"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CustomerSelect } from "@/components/customer-select";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface CustomerProfilePickerProps {
  trigger: React.ReactElement;
  title: string;
  actionLabel: string;
  onPick: (profileId: string, sourceCustomerId: string, customerName: string) => void;
}

export function CustomerProfilePicker({ trigger, title, actionLabel, onPick }: CustomerProfilePickerProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");

  // REGIONAL_MANAGER cannot create new profiles (POST /api/crm/profiles rejects them),
  // so restrict the picker to CRM-scoped customers only. REPRESENTATIVE can create
  // profiles for project-linked customers, so they get the default (wider) list.
  const restrictToCrmScope = session?.user?.role === "REGIONAL_MANAGER";

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const lookups = await fetch(`/api/crm/profiles?sourceCustomerId=${encodeURIComponent(customerId)}`);
      if (!lookups.ok) throw new Error("查找客户档案失败");
      const { profiles } = await lookups.json();
      if (profiles.length > 0) {
        return { profileId: profiles[0].id, sourceCustomerId: customerId, customerName };
      }
      const createRes = await fetch("/api/crm/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCustomerId: customerId, stage: "LEAD", importance: "NORMAL" }),
      });
      if (!createRes.ok) {
        const data = await createRes.json();
        throw new Error(data.error || "创建客户档案失败");
      }
      const { profile } = await createRes.json();
      return { profileId: profile.id, sourceCustomerId: customerId, customerName };
    },
    onSuccess: (result) => {
      onPick(result.profileId, result.sourceCustomerId, result.customerName);
      setOpen(false);
      setCustomerId("");
      setCustomerName("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setCustomerId(""); setCustomerName(""); } }}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">选择客户</label>
            <CustomerSelect
              value={customerId}
              onChange={(id, name) => { setCustomerId(id || ""); setCustomerName(name || ""); }}
              crmScopeOnly={restrictToCrmScope}
            />
          </div>
          <Button
            className="w-full"
            disabled={!customerId || resolveMutation.isPending}
            onClick={() => resolveMutation.mutate()}
          >
            {resolveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {resolveMutation.isPending ? "处理中..." : actionLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
