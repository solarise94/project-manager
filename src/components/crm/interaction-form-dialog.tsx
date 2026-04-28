"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CRM_INTERACTION_TYPES, INTERACTION_TYPE_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export function InteractionFormDialog({ profileId, sourceCustomerId }: { profileId: string; sourceCustomerId?: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("CALL");
  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");
  const [happenedAt, setHappenedAt] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/profiles/${profileId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          summary,
          detail: detail || undefined,
          happenedAt: happenedAt || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success("沟通记录已添加");
      const promises: Promise<void>[] = [
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
      ];
      if (sourceCustomerId) {
        promises.push(queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(sourceCustomerId) }));
      }
      await Promise.all(promises);
      setOpen(false);
      setSummary("");
      setDetail("");
      setHappenedAt("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="h-4 w-4 mr-1" />添加沟通
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>添加沟通记录</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <div>
            <label className="text-sm font-medium">类型</label>
            <Select value={type} onValueChange={(v) => setType(v || "CALL")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRM_INTERACTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{INTERACTION_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">摘要 *</label>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} required placeholder="简要描述沟通内容" />
          </div>
          <div>
            <label className="text-sm font-medium">详情</label>
            <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} placeholder="详细记录（可选）" />
          </div>
          <div>
            <label className="text-sm font-medium">发生时间</label>
            <Input type="datetime-local" value={happenedAt} onChange={(e) => setHappenedAt(e.target.value)} />
          </div>
          <Button type="submit" disabled={mutation.isPending || !summary} className="w-full">
            {mutation.isPending ? "保存中..." : "保存"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
