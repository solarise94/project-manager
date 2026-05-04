"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crmKeys } from "@/lib/crm/query-keys";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export function FollowUpFormDialog({ profileId, profileName, sourceCustomerId, startOpen, onClose }: { profileId: string; profileName?: string; sourceCustomerId?: string; startOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(startOpen || false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, title, dueAt }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success("跟进任务已创建");
      const promises: Promise<void>[] = [
        queryClient.invalidateQueries({ queryKey: crmKeys.followUps() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.profiles() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
      ];
      if (sourceCustomerId) {
        promises.push(queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(sourceCustomerId) }));
      }
      await Promise.all(promises);
      setOpen(false);
      setTitle("");
      setDueAt("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v && onClose) onClose(); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="h-4 w-4 mr-1" />新建跟进
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>新建跟进任务{profileName ? ` — ${profileName}` : ""}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <div>
            <label className="text-sm font-medium">任务标题 *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="例如：确认样品需求" />
          </div>
          <div>
            <label className="text-sm font-medium">截止时间 *</label>
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required />
          </div>
          <Button type="submit" disabled={mutation.isPending || !title || !dueAt} className="w-full">
            {mutation.isPending ? "创建中..." : "创建"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
