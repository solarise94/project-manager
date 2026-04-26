"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProjectItem } from "@/lib/types";
import {
  Plus,
  Search,
  LayoutGrid,
  List as ListIcon,
  Clock,
  CheckCircle2,
  Circle,
  PauseCircle,
  ArrowRight,
  Archive,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { RepresentativeSelect } from "@/components/representative-select";
import { CustomerSelect } from "@/components/customer-select";
import { OrganizationSelect } from "@/components/organization-select";
import { DraftInputPanel } from "@/components/draft-input-panel";

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; variant: "default" | "secondary" | "outline" | "destructive"; color: string }> = {
  NOT_STARTED: { label: "未开始", icon: Circle, variant: "secondary", color: "bg-slate-500" },
  IN_PROGRESS: { label: "进行中", icon: Clock, variant: "default", color: "bg-blue-500" },
  COMPLETED: { label: "已完成", icon: CheckCircle2, variant: "outline", color: "bg-green-500" },
  ON_HOLD: { label: "暂停", icon: PauseCircle, variant: "destructive", color: "bg-amber-500" },
};

export default function ProjectsPage() {
  const router = useRouter();
  const { status, data: session } = useSession();
  const queryClient = useQueryClient();
  const isAdmin = session?.user?.role === "ADMIN";
  const isRepresentative = session?.user?.role === "REPRESENTATIVE";
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("NOT_STARTED,IN_PROGRESS");
  const [dateRange, setDateRange] = useState<string>("ALL");
  const [archivedFilter, setArchivedFilter] = useState<string>("active");
  const [open, setOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [customerOrgId, setCustomerOrgId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    orderNumber: "",
    organization: "",
    client: "",
    representative: "",
    representativeId: "",
    customerId: "",
    status: "NOT_STARTED",
    startDate: "",
    endDate: "",
  });

  const { data, isLoading } = useQuery<{ projects: ProjectItem[] }>({
    queryKey: ["projects", search, statusFilter, dateRange, archivedFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (dateRange !== "ALL") params.set("dateRange", dateRange);
      if (archivedFilter === "archived") params.set("archived", "true");
      else if (archivedFilter === "active") params.set("archived", "false");
      else if (archivedFilter === "deleted" && isAdmin) params.set("includeDeleted", "true");
      const res = await fetch(`/api/projects?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    },
    enabled: status === "authenticated",
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create project");
      return res.json();
    },
    onMutate: () => {
      // Capture state snapshot before React batches any updates
      return {
        snap: {
          custId: form.customerId,
          orgId: selectedOrgId,
          orgName: form.organization,
          custHadOrg: !!customerOrgId,
        },
      };
    },
    onSuccess: async (data, _variables, context) => {
      // Use the snapshot captured at submit time, not current state
      const snap = (context as { snap: { custId: string; orgId: string; orgName: string; custHadOrg: boolean } }).snap;
      toast.success("项目创建成功");
      setOpen(false);

      setForm({ name: "", description: "", orderNumber: "", organization: "", client: "", representative: "", representativeId: "", customerId: "", status: "NOT_STARTED", startDate: "", endDate: "" });
      setSelectedOrgId("");
      setCustomerOrgId(null);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });

      if (snap.custId && snap.orgId && !snap.custHadOrg && data?.project) {
        const confirmed = confirm(`是否将单位「${snap.orgName}」同步关联到客户主数据？`);
        if (confirmed) {
          try {
            const linkRes = await fetch(`/api/customers/${snap.custId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ organizationId: snap.orgId, organization: snap.orgName }),
            });
            if (linkRes.ok) {
              toast.success("客户已关联到该单位");
              queryClient.invalidateQueries({ queryKey: ["customers-list"] });
            } else {
              toast.warning("客户关联单位失败，项目已创建成功");
            }
          } catch {
            toast.warning("客户关联单位失败，项目已创建成功");
          }
        }
      }
    },
    onError: () => toast.error("创建项目失败"),
  });

  if (status === "loading") return null;

  const projects = data?.projects || [];

  const grouped = {
    NOT_STARTED: projects.filter((p) => p.status === "NOT_STARTED"),
    IN_PROGRESS: projects.filter((p) => p.status === "IN_PROGRESS"),
    COMPLETED: projects.filter((p) => p.status === "COMPLETED"),
    ON_HOLD: projects.filter((p) => p.status === "ON_HOLD"),
  };

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    createMutation.mutate(form);
  }

  const ProjectBadges = ({ project }: { project: ProjectItem }) => (
    <>
      {project.archived && (
        <Badge variant="secondary" className="bg-gray-200 text-gray-700">
          <Archive className="h-3 w-3 mr-0.5" />
          已归档
        </Badge>
      )}
      {project.deleted && (
        <Badge variant="destructive">
          <Trash2 className="h-3 w-3 mr-0.5" />
          已删除
        </Badge>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">项目</h1>
          <p className="text-muted-foreground">管理您的科研项目</p>
        </div>
        {!isRepresentative && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
              <Plus className="mr-2 h-4 w-4" />
              新建项目
            </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <DraftInputPanel
                formKey="project.create"
                fieldLabels={{
                  name: "项目名称", description: "项目描述", orderNumber: "订单号",
                  organization: "单位", client: "客户", representative: "代表",
                  status: "状态", startDate: "开始日期", endDate: "结束日期",
                }}
                fallbackPlugin="project.smart-fill"
                onApply={async (fields) => {
                  type EntityField = { id?: string; name: string; matched: boolean; shouldCreate?: boolean; address?: string; organization?: string; organizationId?: string };
                  const updates: Record<string, unknown> = {};
                  let newCustomerId = "";
                  let newSelectedOrgId = "";
                  let newCustomerOrgId: string | null = null;
                  let clientTouched = false;
                  let orgTouched = false;

                  // --- Phase 1: Collect all fields and determine intent ---
                  let orgEntity: EntityField | null = null;
                  let clientEntity: EntityField | null = null;
                  for (const [key, value] of Object.entries(fields)) {
                    if (typeof value === "object" && value !== null && "matched" in value) {
                      const entity = value as EntityField;
                      if (key === "organization") { orgEntity = entity; orgTouched = true; }
                      else if (key === "client") { clientEntity = entity; clientTouched = true; }
                    } else {
                      updates[key] = value;
                    }
                  }

                  // --- Phase 2: Decide whether org creation should be skipped ---
                  // If the final client is an existing customer with their own org,
                  // that org takes priority — skip creating a new org to avoid orphan records.
                  const clientWillUseExistingOrg = clientEntity?.id && clientEntity.matched && !!clientEntity.organizationId;
                  const shouldCreateOrg = orgEntity?.shouldCreate && orgEntity.name.trim() && !clientWillUseExistingOrg;

                  // --- Phase 3: Execute org resolution/creation ---
                  if (orgEntity) {
                    updates.organization = orgEntity.name;
                    if (orgEntity.id && orgEntity.matched) {
                      newSelectedOrgId = orgEntity.id;
                    } else if (shouldCreateOrg) {
                      try {
                        const res = await fetch("/api/organizations/quick-create", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ canonicalName: orgEntity.name.trim() }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          newSelectedOrgId = data.organization.id;
                          updates.organization = data.organization.canonicalName;
                          if (!data.created) toast.info(`单位 "${data.organization.canonicalName}" 已存在，已自动关联`);
                        } else {
                          const err = await res.json().catch(() => ({}));
                          toast.error(err.error || "单位创建失败，请在表单中手动选择");
                        }
                      } catch {
                        toast.error("单位创建失败，请在表单中手动选择");
                      }
                    }
                  }

                  // --- Phase 4: Execute customer resolution/creation ---
                  if (clientEntity) {
                    updates.client = clientEntity.name;
                    if (clientEntity.id && clientEntity.matched) {
                      newCustomerId = clientEntity.id;
                      // Existing customer's org takes priority over draft org
                      if (clientEntity.organizationId) {
                        newCustomerOrgId = clientEntity.organizationId;
                        newSelectedOrgId = clientEntity.organizationId;
                        if (clientEntity.organization) updates.organization = clientEntity.organization;
                      }
                    } else if (clientEntity.shouldCreate && clientEntity.name.trim()) {
                      try {
                        const res = await fetch("/api/customers", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            name: clientEntity.name.trim(),
                            organizationId: newSelectedOrgId || undefined,
                            organization: newSelectedOrgId ? (updates.organization as string || "") : undefined,
                          }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          newCustomerId = data.customer.id;
                          if (newSelectedOrgId) newCustomerOrgId = newSelectedOrgId;
                        } else {
                          const err = await res.json().catch(() => ({}));
                          toast.error(err.error || "客户创建失败，请在表单中手动选择");
                        }
                      } catch {
                        toast.error("客户创建失败，请在表单中手动选择");
                      }
                    }
                  }

                  if (orgTouched) setSelectedOrgId(newSelectedOrgId);
                  if (clientTouched) {
                    setCustomerOrgId(newCustomerOrgId);
                    updates.customerId = newCustomerId;
                  } else if (orgTouched && !clientTouched) {
                    if (customerOrgId && customerOrgId !== newSelectedOrgId) {
                      setCustomerOrgId(null);
                      updates.customerId = "";
                    }
                  }
                  setForm((prev) => ({
                    ...prev,
                    ...updates,
                    status: (updates.status as string) || prev.status,
                  }));
                }}
              />

              <div className="space-y-2">
                <Label>项目名称</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="输入项目名称"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>项目描述</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="项目简介..."
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>订单号</Label>
                  <Input
                    value={form.orderNumber}
                    onChange={(e) => setForm({ ...form, orderNumber: e.target.value })}
                    placeholder="例如: SC-2026-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>单位</Label>
                  {isRepresentative ? (
                    <Input
                      value={form.organization}
                      onChange={(e) => setForm({ ...form, organization: e.target.value })}
                      placeholder="研究机构/公司"
                    />
                  ) : (
                    <OrganizationSelect
                      value={selectedOrgId}
                      displayValue={form.organization || undefined}
                      disabled={!!customerOrgId}
                      onChange={(id, name) => {
                        setSelectedOrgId(id || "");
                        setForm({ ...form, organization: name });
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>客户</Label>
                  <CustomerSelect
                    value={form.customerId}
                    displayValue={form.client}
                    onChange={(id, name, org, orgId) => {
                      setForm({ ...form, customerId: id || "", client: name, organization: org || "" });
                      setCustomerOrgId(orgId || null);
                      // If customer has an org, lock to it; otherwise clear selectedOrgId
                      setSelectedOrgId(orgId || "");
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>代表</Label>
                  <RepresentativeSelect
                    value={form.representativeId}
                    displayValue={form.representative}
                    onChange={(id, name) => setForm({ ...form, representativeId: id || "", representative: name })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>开始日期</Label>
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>结束日期</Label>
                  <Input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>初始状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v || "NOT_STARTED" })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOT_STARTED">未开始</SelectItem>
                    <SelectItem value="IN_PROGRESS">进行中</SelectItem>
                    <SelectItem value="COMPLETED">已完成</SelectItem>
                    <SelectItem value="ON_HOLD">暂停</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? "创建中..." : "创建项目"}
              </Button>
            </form>
          </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索项目..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={archivedFilter} onValueChange={(v) => setArchivedFilter(v || "active")}>
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">活跃</SelectItem>
              <SelectItem value="archived">已归档</SelectItem>
              {isAdmin && <SelectItem value="deleted">已删除</SelectItem>}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v || "NOT_STARTED,IN_PROGRESS")}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NOT_STARTED,IN_PROGRESS">活跃</SelectItem>
              <SelectItem value="NOT_STARTED">未开始</SelectItem>
              <SelectItem value="IN_PROGRESS">进行中</SelectItem>
              <SelectItem value="COMPLETED">已完成</SelectItem>
              <SelectItem value="ON_HOLD">暂停</SelectItem>
              <SelectItem value="ALL">全部状态</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={(v) => setDateRange(v || "ALL")}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="时间" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部时间</SelectItem>
              <SelectItem value="7d">最近7天</SelectItem>
              <SelectItem value="30d">最近30天</SelectItem>
              <SelectItem value="90d">最近90天</SelectItem>
              <SelectItem value="1y">最近一年</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex border rounded-md overflow-hidden">
            <button
              className={`px-3 py-2 ${view === "board" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              onClick={() => setView("board")}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              className={`px-3 py-2 ${view === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              onClick={() => setView("list")}
            >
              <ListIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">暂无项目，点击右上角创建</p>
        </div>
      ) : view === "board" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(statusFilter === "ALL" ? Object.entries(grouped) : Object.entries(grouped).filter(([s]) => statusFilter.split(",").includes(s))).map(([status, list]) => {
            const config = STATUS_CONFIG[status];
            const Icon = config.icon;
            return (
              <div key={status} className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4" />
                  {config.label}
                  <Badge variant="secondary" className="ml-auto">
                    {list.length}
                  </Badge>
                </div>
                <div className="space-y-3">
                  {list.map((project) => (
                    <Card
                      key={project.id}
                      className={`cursor-pointer hover:shadow-md transition-shadow ${project.deleted ? "opacity-60 border-red-200" : ""} ${project.archived && !project.deleted ? "opacity-80 border-gray-200" : ""}`}
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-medium line-clamp-2">{project.name}</h3>
                          <div className="flex gap-1 shrink-0">
                            <ProjectBadges project={project} />
                          </div>
                        </div>
                        {project.orderNumber && (
                          <p className="text-xs text-muted-foreground">订单号: {project.orderNumber}</p>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {project.organization && <span>{project.organization}</span>}
                          {(project.cust?.name || project.client) && <span>客户: {project.cust?.name ?? project.client}</span>}
                          {(project.rep?.name || project.representative) && <span>代表: {project.rep?.name ?? project.representative}</span>}
                        </div>
                        <Progress value={project.progress} className="h-1.5" />
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{project.progress}%</span>
                          <span>{project._count?.tickets ?? 0} 工单</span>
                        </div>
                        {project.members && project.members.length > 0 && (
                          <div className="flex -space-x-2">
                            {project.members.slice(0, 3).map((m) => (
                              <div
                                key={m.user.id}
                                className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center ring-2 ring-background"
                                title={m.user.name}
                              >
                                {m.user.name?.slice(0, 2)?.toUpperCase()}
                              </div>
                            ))}
                            {project.members.length > 3 && (
                              <div className="h-6 w-6 rounded-full bg-muted text-muted-foreground text-[10px] flex items-center justify-center ring-2 ring-background">
                                +{project.members.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className={`cursor-pointer hover:shadow-md transition-shadow ${project.deleted ? "opacity-60 border-red-200" : ""} ${project.archived && !project.deleted ? "opacity-80 border-gray-200" : ""}`}
              onClick={() => router.push(`/projects/${project.id}`)}
            >
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium truncate">{project.name}</h3>
                    <Badge variant={STATUS_CONFIG[project.status]?.variant || "secondary"}>
                      {STATUS_CONFIG[project.status]?.label || project.status}
                    </Badge>
                    <ProjectBadges project={project} />
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                    {project.description || "暂无描述"}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                    {project.orderNumber && <span>订单: {project.orderNumber}</span>}
                    {project.organization && <span>{project.organization}</span>}
                    {project.client && <span>客户: {project.client}</span>}
                    {(project.rep?.name || project.representative) && <span>代表: {project.rep?.name ?? project.representative}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
                  <span>{project.progress}% 进度</span>
                  <span>{project._count?.tickets ?? 0} 工单</span>
                  <span>{project._count?.comments ?? 0} 评论</span>
                  <ArrowRight className="h-4 w-4 hidden sm:block" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}
