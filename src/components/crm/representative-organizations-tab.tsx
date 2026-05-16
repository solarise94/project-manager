"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, X, Plus, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Link from "next/link";
import { OrganizationSelect } from "@/components/organization-select";

interface Binding {
  id: string;
  status: string;
  organizationId: string | null;
  requestedOrganizationName: string | null;
  organizationReviewTaskId: string | null;
  reviewNote: string | null;
  createdAt: string;
  organization: {
    id: string;
    canonicalName: string;
    address: string | null;
  } | null;
}

function statusBadge(status: string) {
  switch (status) {
    case "ACTIVE": return <Badge variant="default">已通过</Badge>;
    case "PENDING": return <Badge variant="secondary">待审核</Badge>;
    case "REJECTED": return <Badge variant="destructive">已拒绝</Badge>;
    case "ARCHIVED": return <Badge variant="outline">已归档</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

export function RepresentativeOrganizationsTab({ representativeId }: { representativeId: string }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [reviewTarget, setReviewTarget] = useState<Binding | null>(null);
  const [reviewAction, setReviewAction] = useState<"approve" | "reject">("approve");
  const [reviewNote, setReviewNote] = useState("");
  const [addOrgId, setAddOrgId] = useState("");
  const [addOrgName, setAddOrgName] = useState("");

  const { data, isLoading } = useQuery<{ bindings: Binding[] }>({
    queryKey: ["representative-organizations", representativeId],
    queryFn: async () => {
      const res = await fetch(`/api/crm/representative-organizations?representativeId=${representativeId}`);
      if (!res.ok) throw new Error("加载失败");
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, action, note }: { id: string; action: string; note: string }) => {
      const res = await fetch(`/api/crm/representative-organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewNote: note || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "操作失败");
      return json as { binding: Binding; autoAssigned?: number };
    },
    onSuccess: (result, vars) => {
      if (vars.action === "approve") {
        const msg = result.autoAssigned
          ? `已通过，自动分配了 ${result.autoAssigned} 位客户`
          : "已通过";
        toast.success(msg);
      } else {
        toast.success("已拒绝");
      }
      setReviewTarget(null);
      setReviewNote("");
      queryClient.invalidateQueries({ queryKey: ["representative-organizations", representativeId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addMutation = useMutation({
    mutationFn: async ({ orgId, orgName }: { orgId: string; orgName: string }) => {
      const payload: Record<string, string> = { representativeId };
      if (orgId) {
        payload.organizationId = orgId;
      } else {
        payload.canonicalName = orgName;
      }
      const res = await fetch("/api/crm/representative-organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "添加失败");
      return json;
    },
    onSuccess: () => {
      toast.success("绑定已添加");
      setAddOrgId("");
      setAddOrgName("");
      queryClient.invalidateQueries({ queryKey: ["representative-organizations", representativeId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bindings = data?.bindings || [];
  const canManageBindings = session?.user?.role === "ADMIN" || session?.user?.role === "REGIONAL_MANAGER";

  if (!canManageBindings) {
    return <p className="py-4 text-sm text-muted-foreground">仅管理员和区域经理可管理绑定。</p>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-sm">
          <OrganizationSelect
            value={addOrgId}
            displayValue={addOrgName}
            onChange={(id, name) => {
              setAddOrgId(id || "");
              setAddOrgName(name);
            }}
          />
        </div>
        <Button
          size="sm"
          disabled={!addOrgName.trim() || addMutation.isPending}
          onClick={() => addOrgName.trim() && addMutation.mutate({ orgId: addOrgId, orgName: addOrgName.trim() })}
        >
          {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          添加绑定
        </Button>
      </div>

      {bindings.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">该代表暂无单位绑定</p>
      ) : (
        <div className="grid gap-2">
          {bindings.map((b) => {
            const orgName = b.organization?.canonicalName || b.requestedOrganizationName || "未知单位";
            return (
              <Card key={b.id}>
                <CardContent className="flex items-center gap-3 p-3">
                  <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{orgName}</span>
                      {statusBadge(b.status)}
                    </div>
                    {b.organization?.address && (
                      <p className="text-xs text-muted-foreground mt-0.5">{b.organization.address}</p>
                    )}
                    {b.reviewNote && (
                      <p className="text-xs text-muted-foreground mt-0.5">备注: {b.reviewNote}</p>
                    )}
                  </div>
                  {b.status === "PENDING" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => { setReviewTarget(b); setReviewAction("approve"); setReviewNote(""); }}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setReviewTarget(b); setReviewAction("reject"); setReviewNote(""); }}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!reviewTarget} onOpenChange={(v) => { if (!v) setReviewTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" ? "通过绑定申请" : "拒绝绑定申请"}
            </DialogTitle>
          </DialogHeader>
          {reviewTarget && !reviewTarget.organizationId && reviewTarget.organizationReviewTaskId && reviewAction === "approve" && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p>该绑定关联的单位尚未通过主数据审核。</p>
                <Link href="/admin/organization-reviews" className="text-amber-900 underline">
                  前往单位审核
                </Link>
              </div>
            </div>
          )}
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">单位: </span>
              {reviewTarget?.organization?.canonicalName || reviewTarget?.requestedOrganizationName || "未知"}
            </div>
            <Textarea
              placeholder={reviewAction === "reject" ? "请填写拒绝原因..." : "备注（可选）"}
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>取消</Button>
            <Button
              variant={reviewAction === "approve" ? "default" : "destructive"}
              disabled={reviewMutation.isPending || (reviewAction === "reject" && !reviewNote.trim())}
              onClick={() => {
                if (!reviewTarget) return;
                reviewMutation.mutate({ id: reviewTarget.id, action: reviewAction, note: reviewNote.trim() });
              }}
            >
              {reviewMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {reviewAction === "approve" ? "通过" : "拒绝"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
