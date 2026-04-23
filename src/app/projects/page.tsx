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
import { parseSmartFill } from "@/lib/smart-fill";
import { Wand2, ChevronDown, ChevronUp } from "lucide-react";

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
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("NOT_STARTED,IN_PROGRESS");
  const [dateRange, setDateRange] = useState<string>("ALL");
  const [archivedFilter, setArchivedFilter] = useState<string>("active");
  const [open, setOpen] = useState(false);
  const [smartFillOpen, setSmartFillOpen] = useState(false);
  const [smartFillText, setSmartFillText] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    orderNumber: "",
    organization: "",
    client: "",
    representative: "",
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
    onSuccess: () => {
      toast.success("项目创建成功");
      setOpen(false);
      setForm({ name: "", description: "", orderNumber: "", organization: "", client: "", representative: "", status: "NOT_STARTED", startDate: "", endDate: "" });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新建项目
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              {/* Smart Fill Section */}
              <div className="border rounded-lg overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                  onClick={() => setSmartFillOpen(!smartFillOpen)}
                >
                  <span className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4" />
                    智能填写
                  </span>
                  {smartFillOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {smartFillOpen && (
                  <div className="px-3 pb-3 space-y-2 border-t">
                    <p className="text-xs text-muted-foreground mt-2">
                      粘贴制表符分隔的项目信息文本，系统将自动解析并填充表单。
                    </p>
                    <Textarea
                      value={smartFillText}
                      onChange={(e) => setSmartFillText(e.target.value)}
                      placeholder="例如：2604357&#09;GJ24937&#09;云南大学附属医院&#09;吴家旺&#09;王哲&#09;..."
                      rows={3}
                      className="text-xs"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      disabled={!smartFillText.trim()}
                      onClick={() => {
                        try {
                          const result = parseSmartFill(smartFillText);
                          setForm((prev) => ({
                            ...prev,
                            ...result,
                            status: result.status || prev.status,
                          }));
                          toast.success("智能填写成功，请检查并补充信息");
                          setSmartFillOpen(false);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "解析失败");
                        }
                      }}
                    >
                      <Wand2 className="mr-1 h-3 w-3" />
                      解析并填充
                    </Button>
                  </div>
                )}
              </div>

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
                  <Input
                    value={form.organization}
                    onChange={(e) => setForm({ ...form, organization: e.target.value })}
                    placeholder="研究机构/公司"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>客户</Label>
                  <Input
                    value={form.client}
                    onChange={(e) => setForm({ ...form, client: e.target.value })}
                    placeholder="客户名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label>代表</Label>
                  <Input
                    value={form.representative}
                    onChange={(e) => setForm({ ...form, representative: e.target.value })}
                    placeholder="项目负责人/代表"
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
                          {project.client && <span>客户: {project.client}</span>}
                          {project.representative && <span>代表: {project.representative}</span>}
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
                    {project.representative && <span>代表: {project.representative}</span>}
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
