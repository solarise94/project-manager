"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle, XCircle, User, Building, Mail, MessageCircle, MapPin, FileText, AlertTriangle, Link2 } from "lucide-react";
import Link from "next/link";
import { CustomerApplicationFormDialog } from "@/components/crm/customer-application-form-dialog";

interface ApplicationItem {
  id: string;
  name: string;
  principal: string | null;
  email: string | null;
  wechat: string | null;
  organization: string | null;
  address: string | null;
  miniProgramId: string | null;
  notes: string | null;
  status: string;
  submittedByUserId: string;
  submittedByUser: { id: string; name: string; email: string };
  reviewedByUser: { id: string; name: string } | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdCustomer: { id: string; name: string; customerCode: string } | null;
  createdCrmProfile: { id: string; sourceCustomerId: string } | null;
  createdAt: string;
}

interface CandidateCustomer {
  id: string;
  name: string;
  customerCode: string;
  email: string | null;
  wechat: string | null;
  organization: string | null;
  principal: string | null;
  archived: boolean;
  crmProfile: { id: string } | null;
  _count: { projects: number };
  matchReasons: string[];
}

interface AssigneeOption {
  userId: string;
  name: string;
  kind: "self" | "representative";
}

function StatusBadge({ status }: { status: string }) {
  if (status === "PENDING") return <Badge variant="secondary">待审核</Badge>;
  if (status === "APPROVED") return <Badge variant="secondary" className="border-green-200 text-green-700 dark:text-green-400">已通过</Badge>;
  if (status === "REJECTED") return <Badge variant="destructive">已驳回</Badge>;
  return <Badge>{status}</Badge>;
}

export default function CrmCustomerApplicationsPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <ApplicationList />;
}

function ApplicationList() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState<ApplicationItem | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [bindTargetId, setBindTargetId] = useState("");
  const [actionType, setActionType] = useState<"approve" | "reject" | "bind">("approve");

  // Batch state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOwnerUserId, setBatchOwnerUserId] = useState("");
  const [batchReviewNote, setBatchReviewNote] = useState("");

  const isAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "USER";

  const { data, isLoading } = useQuery<{ applications: ApplicationItem[] }>({
    queryKey: ["crm-customer-applications"],
    queryFn: () => fetch("/api/crm/customer-applications").then((r) => r.json()),
  });

  const { data: assigneesData } = useQuery<{ assignees: AssigneeOption[] }>({
    queryKey: ["crm-assignees"],
    queryFn: () => fetch("/api/crm/assignees").then((r) => r.json()),
    enabled: isAdmin,
  });

  const [candidates, setCandidates] = useState<CandidateCustomer[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const pendingInvalidations = () => {
    queryClient.invalidateQueries({ queryKey: ["crm-customer-applications"] });
    queryClient.invalidateQueries({ queryKey: ["crm-profiles"] });
    queryClient.invalidateQueries({ queryKey: ["crm-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["crm-batch-candidate-count"] });
  };

  const approveMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const payload: Record<string, unknown> = { action: "approve", reviewNote: reviewNote || undefined };
      if (ownerUserId) payload.ownerUserId = ownerUserId;
      const res = await fetch(`/api/crm/customer-applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "审核失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("客户申请已通过，客户和 CRM 档案已创建");
      pendingInvalidations();
      resetReview();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bindMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await fetch(`/api/crm/customer-applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-bind", targetCustomerId: bindTargetId, reviewNote: reviewNote || undefined, ownerUserId: ownerUserId || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "绑定失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("已绑定已有客户并创建 CRM 档案");
      pendingInvalidations();
      resetReview();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await fetch(`/api/crm/customer-applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reviewNote: reviewNote || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "驳回失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("客户申请已驳回");
      queryClient.invalidateQueries({ queryKey: ["crm-customer-applications"] });
      resetReview();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const batchApproveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/customer-applications/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          ids: [...selectedIds],
          ownerUserId: batchOwnerUserId || undefined,
          reviewNote: batchReviewNote || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批量审核失败");
      return data as { approved: number; rejected: number; skipped: Array<{ id: string; reason: string }>; errors: Array<{ id: string; error: string }> };
    },
    onSuccess: (data) => {
      const parts: string[] = [];
      if (data.approved > 0) parts.push(`${data.approved} 条已通过`);
      if (data.skipped.length > 0) parts.push(`${data.skipped.length} 条已跳过`);
      if (data.errors.length > 0) parts.push(`${data.errors.length} 条失败`);
      toast.success(parts.join("，"));
      if (data.errors.length > 0) {
        data.errors.slice(0, 3).forEach((e) => toast.error(`${e.id.slice(-6)}: ${e.error}`));
      }
      pendingInvalidations();
      setSelectedIds(new Set());
      setBatchReviewNote("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const batchRejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/customer-applications/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          ids: [...selectedIds],
          reviewNote: batchReviewNote || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批量驳回失败");
      return data as { approved: number; rejected: number; skipped: Array<{ id: string; reason: string }>; errors: Array<{ id: string; error: string }> };
    },
    onSuccess: (data) => {
      const parts: string[] = [];
      if (data.rejected > 0) parts.push(`${data.rejected} 条已驳回`);
      if (data.skipped.length > 0) parts.push(`${data.skipped.length} 条已跳过`);
      if (data.errors.length > 0) parts.push(`${data.errors.length} 条失败`);
      toast.success(parts.join("，"));
      pendingInvalidations();
      setSelectedIds(new Set());
      setBatchReviewNote("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const pendingIds = applications.filter((a) => a.status === "PENDING").map((a) => a.id);
    if (pendingIds.length === 0) return;
    const allSelected = pendingIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(pendingIds));
  };

  const resetReview = () => {
    setReviewOpen(false);
    setReviewing(null);
    setReviewNote("");
    setOwnerUserId("");
    setBindTargetId("");
    setActionType("approve");
    setCandidates([]);
  };

  const openApproveDialog = async (app: ApplicationItem) => {
    setReviewing(app);
    setReviewNote("");
    setOwnerUserId("");
    setBindTargetId("");
    setActionType("approve");
    setReviewOpen(true);
    setCandidatesLoading(true);
    try {
      const res = await fetch(`/api/crm/customer-applications/${app.id}`);
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates || []);
      }
    } finally {
      setCandidatesLoading(false);
    }
  };

  const switchToReject = (app: ApplicationItem) => {
    setReviewing(app);
    setReviewNote("");
    setOwnerUserId("");
    setBindTargetId("");
    setActionType("reject");
    setCandidates([]);
    setReviewOpen(true);
  };

  const applications = data?.applications || [];
  const pendingCount = applications.filter((a) => a.status === "PENDING").length;
  const assignees = assigneesData?.assignees || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {isAdmin ? "客户申请审核" : "我的客户申请"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAdmin
              ? `待审核 ${pendingCount} 条申请`
              : "查看您提交的客户申请进度"}
          </p>
          {isAdmin && pendingCount > 0 && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground mt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-gray-300"
                checked={applications.filter((a) => a.status === "PENDING").every((a) => selectedIds.has(a.id))}
                onChange={toggleSelectAll}
              />
              全选本页待审核
            </label>
          )}
        </div>
        {!isAdmin && <CustomerApplicationFormDialog />}
      </div>

      {/* Batch action bar */}
      {isAdmin && selectedIds.size > 0 && (
        <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">已选择 {selectedIds.size} 条</span>
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">负责人:</label>
              <Select value={batchOwnerUserId} onValueChange={(v) => setBatchOwnerUserId(v || "")}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  {batchOwnerUserId
                    ? <span>{assignees.find((a) => a.userId === batchOwnerUserId)?.name || batchOwnerUserId}</span>
                    : <span className="text-muted-foreground">默认提交人</span>}
                </SelectTrigger>
                <SelectContent>
                  {assignees.map((a) => (
                    <SelectItem key={a.userId} value={a.userId}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="审核备注（选填）"
              value={batchReviewNote}
              onChange={(e) => setBatchReviewNote(e.target.value)}
              className="h-8 text-xs w-48"
            />
            <Button
              size="sm"
              disabled={batchApproveMutation.isPending || batchRejectMutation.isPending}
              onClick={() => {
                if (!confirm(`确认批量通过 ${selectedIds.size} 条申请？批量通过仅创建新客户，如需绑定已有客户请单条审核。`)) return;
                batchApproveMutation.mutate();
              }}
            >
              {batchApproveMutation.isPending ? "处理中..." : `批量通过 (${selectedIds.size})`}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={batchApproveMutation.isPending || batchRejectMutation.isPending}
              onClick={() => {
                if (!confirm(`确认批量驳回 ${selectedIds.size} 条申请？`)) return;
                batchRejectMutation.mutate();
              }}
            >
              {batchRejectMutation.isPending ? "处理中..." : `批量驳回 (${selectedIds.size})`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              清空选择
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">批量通过仅创建新客户，如需绑定已有客户请单条审核</p>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : applications.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">暂无客户申请</div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => (
            <div key={app.id} className="border rounded-lg p-4 bg-card">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    {isAdmin && app.status === "PENDING" && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 shrink-0"
                        checked={selectedIds.has(app.id)}
                        onChange={() => toggleSelect(app.id)}
                      />
                    )}
                    <span className="font-medium text-lg">{app.name}</span>
                    <StatusBadge status={app.status} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-muted-foreground">
                    {app.principal && (
                      <div className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        <span>负责人: {app.principal}</span>
                      </div>
                    )}
                    {app.organization && (
                      <div className="flex items-center gap-1">
                        <Building className="h-3.5 w-3.5" />
                        <span>{app.organization}</span>
                      </div>
                    )}
                    {app.email && (
                      <div className="flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" />
                        <span>{app.email}</span>
                      </div>
                    )}
                    {app.wechat && (
                      <div className="flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" />
                        <span>微信: {app.wechat}</span>
                      </div>
                    )}
                    {app.address && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{app.address}</span>
                      </div>
                    )}
                  </div>
                  {app.notes && (
                    <div className="flex items-start gap-1 text-sm text-muted-foreground">
                      <FileText className="h-3.5 w-3.5 mt-0.5" />
                      <span>{app.notes}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>提交人: {app.submittedByUser.name}</span>
                    <span>提交时间: {new Date(app.createdAt).toLocaleString("zh-CN")}</span>
                    {app.reviewedByUser && (
                      <span>审核人: {app.reviewedByUser.name}</span>
                    )}
                    {app.reviewedAt && (
                      <span>审核时间: {new Date(app.reviewedAt).toLocaleString("zh-CN")}</span>
                    )}
                  </div>
                  {app.reviewNote && (
                    <div className="text-sm text-muted-foreground bg-muted/50 rounded p-2">
                      审核备注: {app.reviewNote}
                    </div>
                  )}
                  {app.status === "APPROVED" && app.createdCustomer && (
                    <div className="flex gap-2 text-sm">
                      <Link href={`/crm/customers/${app.createdCustomer.id}`} className="text-primary hover:underline">
                        查看 CRM 档案
                      </Link>
                    </div>
                  )}
                </div>
                {isAdmin && app.status === "PENDING" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => openApproveDialog(app)}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />通过
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => switchToReject(app)}
                    >
                      <XCircle className="h-4 w-4 mr-1" />驳回
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={reviewOpen} onOpenChange={(v) => { if (!v) resetReview(); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {actionType === "reject" ? "驳回客户申请" : "审核客户申请"}
            </DialogTitle>
          </DialogHeader>
          {reviewing && (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><span className="font-medium">客户:</span> {reviewing.name}</p>
                {reviewing.organization && <p><span className="font-medium">单位:</span> {reviewing.organization}</p>}
                {reviewing.principal && <p><span className="font-medium">负责人:</span> {reviewing.principal}</p>}
                {reviewing.email && <p><span className="font-medium">邮箱:</span> {reviewing.email}</p>}
                {reviewing.wechat && <p><span className="font-medium">微信:</span> {reviewing.wechat}</p>}
                <p><span className="font-medium">提交人:</span> {reviewing.submittedByUser.name}</p>
              </div>

              {actionType !== "reject" && (
                <>
                  {candidatesLoading ? (
                    <div className="text-xs text-muted-foreground">正在检索相似客户...</div>
                  ) : candidates.length > 0 && (
                    <div className="bg-muted/50 border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-1 text-sm font-medium">
                        <AlertTriangle className="h-4 w-4" />
                        检测到可能重复的客户 ({candidates.length})
                      </div>
                      <div className="space-y-2">
                        {candidates.map((c) => (
                          <div key={c.id} className="bg-background rounded border p-2 text-sm">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-medium">{c.name}</span>
                                <span className="text-xs text-muted-foreground ml-2">{c.customerCode}</span>
                              </div>
                              {c.archived && <Badge variant="outline" className="text-xs">已归档</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {c.organization && <span>{c.organization} · </span>}
                              {c.principal && <span>负责人: {c.principal} · </span>}
                              <span>{c._count.projects} 项目</span>
                              {c.crmProfile && <Badge variant="secondary" className="ml-1 text-xs">已有CRM</Badge>}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {c.matchReasons.map((r, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">{r}</Badge>
                              ))}
                            </div>
                            {!c.crmProfile && (
                              <div className="mt-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  disabled={bindMutation.isPending}
                                  onClick={() => {
                                    setBindTargetId(c.id);
                                    setActionType("bind");
                                  }}
                                >
                                  <Link2 className="h-3 w-3 mr-1" />
                                  绑定此客户并创建 CRM 档案
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {actionType === "bind" && bindTargetId && (
                    <div className="bg-muted/50 border rounded-lg p-3 text-sm">
                      将把该申请绑定到已有客户并创建 CRM 档案，不会创建新客户。
                      <Button variant="ghost" size="sm" className="text-xs mt-1" onClick={() => { setBindTargetId(""); setActionType("approve"); }}>
                        取消绑定，创建新客户
                      </Button>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium">CRM 负责人</label>
                    <Select value={ownerUserId} onValueChange={(v) => setOwnerUserId(v || "")}>
                      <SelectTrigger>
                        {ownerUserId
                          ? <span>{assignees.find((a) => a.userId === ownerUserId)?.name || ownerUserId}</span>
                          : <span className="text-muted-foreground">默认: {reviewing.submittedByUser.name}（提交人）</span>}
                      </SelectTrigger>
                      <SelectContent>
                        {assignees.map((a) => (
                          <SelectItem key={a.userId} value={a.userId}>
                            {a.name}{a.userId === reviewing.submittedByUserId ? "（提交人）" : a.kind === "representative" ? "（代表）" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">未选择时，默认归属提交人</p>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">审核备注</label>
                <Textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="选填，驳回时建议填写原因"
                  rows={3}
                />
              </div>

              {actionType === "reject" ? (
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={rejectMutation.isPending}
                  onClick={() => rejectMutation.mutate({ id: reviewing.id })}
                >
                  {rejectMutation.isPending ? "处理中..." : "确认驳回"}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={approveMutation.isPending || bindMutation.isPending}
                    onClick={() => {
                      if (actionType === "bind" && bindTargetId) {
                        bindMutation.mutate({ id: reviewing.id });
                      } else {
                        approveMutation.mutate({ id: reviewing.id });
                      }
                    }}
                  >
                    {actionType === "bind" ? "确认绑定" : "通过并创建客户"}
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={approveMutation.isPending || bindMutation.isPending}
                    onClick={() => switchToReject(reviewing)}
                  >
                    驳回
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
