"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  Circle,
  MessageSquare,
  Paperclip,
  Ticket,
  Send,
  Upload,
  FileText,
  Download,
  Image as ImageIcon,
  MoreHorizontal,
  Loader2,
  Activity,
  Plus,
  Archive,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { ProjectItem, TimelineItem, TicketItem, TicketReplyItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  NOT_STARTED: { label: "未开始", color: "text-slate-600", bg: "bg-slate-100" },
  IN_PROGRESS: { label: "进行中", color: "text-blue-600", bg: "bg-blue-100" },
  COMPLETED: { label: "已完成", color: "text-green-600", bg: "bg-green-100" },
  ON_HOLD: { label: "暂停", color: "text-amber-600", bg: "bg-amber-100" },
};

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  PROJECT_CREATED: Activity,
  PROJECT_UPDATED: Activity,
  STATUS_CHANGED: Clock,
  PROGRESS_UPDATED: CheckCircle2,
  COMMENT_ADDED: MessageSquare,
  FILE_UPLOADED: Paperclip,
  TICKET_CREATED: Ticket,
  TICKET_UPDATED: Ticket,
  MEMBER_ADDED: Circle,
};

export default function ProjectDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const projectId = id as string;

  const [comment, setComment] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<ProjectItem & { startDate?: string | null; endDate?: string | null }>>({});
  const [ticketOpen, setTicketOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [ticketForm, setTicketForm] = useState({ title: "", description: "", priority: "MEDIUM", reminderDate: "" });
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const [isDraggingTickets, setIsDraggingTickets] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [sliderValue, setSliderValue] = useState<number | undefined>(undefined);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState<Record<string, string>>({});
  const commentFileInputRef = useRef<HTMLInputElement>(null);

  const { data: projectData, isLoading: projectLoading } = useQuery<{ project: ProjectItem }>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to load project");
      return res.json();
    },
  });

  const { data: timelineData, isLoading: timelineLoading } = useQuery<{ timeline: TimelineItem[] }>({
    queryKey: ["timeline", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/timeline`);
      if (!res.ok) throw new Error("Failed to load timeline");
      return res.json();
    },
  });

  const { data: ticketsData } = useQuery<{ tickets: TicketItem[] }>({
    queryKey: ["tickets", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/tickets?projectId=${projectId}`);
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: Partial<ProjectItem & { startDate?: string | null; endDate?: string | null }>) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      toast.success("更新成功");
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["timeline", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: () => {
      toast.error("更新失败");
      setSliderValue(undefined);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (archived: boolean) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) throw new Error("Failed to archive");
      return res.json();
    },
    onSuccess: (_, archived) => {
      toast.success(archived ? "项目已归档" : "项目已取消归档");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => toast.error("操作失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      toast.success("项目已删除");
      setDeleteOpen(false);
      setDeleteReason("");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      router.push("/projects");
    },
    onError: (err: Error) => toast.error(err.message || "删除失败"),
  });

  const commentMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to post comment");
      return res.json();
    },
    onSuccess: () => {
      setComment("");
      queryClient.invalidateQueries({ queryKey: ["timeline", projectId] });
    },
    onError: () => toast.error("评论失败"),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/attachments`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to upload");
      return res.json();
    },
    onSuccess: () => {
      toast.success("上传成功");
      queryClient.invalidateQueries({ queryKey: ["timeline", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: () => toast.error("上传失败"),
  });

  const commentUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/attachments`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to upload");
      return res.json();
    },
    onSuccess: (data) => {
      const url = data?.attachment?.url || "";
      const name = data?.attachment?.filename || "文件";
      const isImage = data?.attachment?.mimeType?.startsWith("image/");
      const markdown = isImage
        ? `![${name}](${url})`
        : `[${name}](${url})`;
      setComment((prev) => prev + (prev ? "\n" : "") + markdown);
      toast.success(isImage ? "图片已添加" : "附件已添加");
    },
    onError: () => toast.error("附件上传失败"),
  });

  const ticketMutation = useMutation({
    mutationFn: async (payload: { title: string; description: string; priority: string; reminderDate: string }) => {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, projectId }),
      });
      if (!res.ok) throw new Error("Failed to create ticket");
      return res.json();
    },
    onSuccess: () => {
      toast.success("工单创建成功");
      setTicketOpen(false);
      setTicketForm({ title: "", description: "", priority: "MEDIUM", reminderDate: "" });
      queryClient.invalidateQueries({ queryKey: ["tickets", projectId] });
      queryClient.invalidateQueries({ queryKey: ["timeline", projectId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: () => toast.error("创建工单失败"),
  });

  const updateTicketMutation = useMutation({
    mutationFn: async ({ ticketId, status }: { ticketId: string; status: string }) => {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update ticket");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tickets", projectId] });
      queryClient.invalidateQueries({ queryKey: ["timeline", projectId] });
    },
  });

  const replyMutation = useMutation({
    mutationFn: async ({ ticketId, content }: { ticketId: string; content: string }) => {
      const res = await fetch(`/api/tickets/${ticketId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to post reply");
      return res.json();
    },
    onSuccess: (_, vars) => {
      setReplyContent((prev) => ({ ...prev, [vars.ticketId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["ticket-replies", vars.ticketId] });
      queryClient.invalidateQueries({ queryKey: ["timeline", projectId] });
    },
  });

  // When server progress catches up to the locally-dragged value, clear the override
  useEffect(() => {
    const progress = projectData?.project?.progress;
    if (sliderValue !== undefined && progress !== undefined && sliderValue === progress) {
      const timer = setTimeout(() => setSliderValue(undefined), 0);
      return () => clearTimeout(timer);
    }
  }, [projectData?.project?.progress, sliderValue]);

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  const project = projectData?.project;
  if (!project) return <div>项目不存在</div>;

  const timeline = timelineData?.timeline || [];
  const tickets = ticketsData?.tickets || [];
  const attachments = timeline.filter((t) => t.kind === "attachment");
  const isOwner = project.members?.some((m) => m.user.id === session?.user?.id && m.role === "OWNER");

  function renderCommentContent(content: string) {
    const images: string[] = [];
    const files: { name: string; url: string }[] = [];
    const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
    const linkRegex = /\[(.*?)\]\((.*?)\)/g;
    let m;
    while ((m = imgRegex.exec(content)) !== null) {
      images.push(m[2]);
    }
    let plainContent = content.replace(imgRegex, "").trim();
    while ((m = linkRegex.exec(content)) !== null) {
      if (!images.includes(m[2])) {
        files.push({ name: m[1], url: m[2] });
      }
    }
    plainContent = plainContent.replace(linkRegex, "").trim();

    return (
      <>
        {plainContent && <div className="text-sm whitespace-pre-wrap">{plainContent}</div>}
        {images.length > 0 && (
          <div className="flex gap-2 flex-wrap mt-2">
            {images.map((url, i) => (
              <img
                key={i}
                src={url}
                alt="attachment"
                className="h-20 w-20 object-cover rounded cursor-pointer"
                onClick={() => setPreviewImage(url)}
              />
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="flex flex-col gap-1 mt-2">
            {files.map((f, i) => (
              <a key={i} href={f.url} download className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {f.name}
              </a>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.push("/projects")}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回项目列表
      </Button>

      {/* Project Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{project.name}</h1>
              <Badge className={STATUS_CONFIG[project.status]?.bg + " " + STATUS_CONFIG[project.status]?.color}>
                {STATUS_CONFIG[project.status]?.label || project.status}
              </Badge>
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
            </div>
            <p className="text-muted-foreground">{project.description || "暂无描述"}</p>
          </div>
          {isOwner && !project.deleted && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => archiveMutation.mutate(!project.archived)}
                disabled={archiveMutation.isPending}
              >
                <Archive className="mr-1 h-3 w-3" />
                {project.archived ? "取消归档" : "归档"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                删除
              </Button>
              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogTrigger>
                  <Button variant="outline" size="sm" onClick={() => setEditForm({ ...project })}>
                    编辑项目
                  </Button>
                </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>编辑项目</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  updateMutation.mutate({
                    name: editForm.name,
                    description: editForm.description,
                    orderNumber: editForm.orderNumber,
                    organization: editForm.organization,
                    client: editForm.client,
                    representative: editForm.representative,
                    status: editForm.status,
                    progress: editForm.progress,
                    startDate: editForm.startDate,
                    endDate: editForm.endDate,
                  });
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <label className="text-sm font-medium">项目名称</label>
                  <Input value={editForm.name || ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">描述</label>
                  <Textarea value={editForm.description || ""} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">状态</label>
                    <Select value={editForm.status || "NOT_STARTED"} onValueChange={(v) => setEditForm({ ...editForm, status: v || "NOT_STARTED" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NOT_STARTED">未开始</SelectItem>
                        <SelectItem value="IN_PROGRESS">进行中</SelectItem>
                        <SelectItem value="COMPLETED">已完成</SelectItem>
                        <SelectItem value="ON_HOLD">暂停</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">进度 ({editForm.progress}%)</label>
                    <Input type="range" min={0} max={100} value={editForm.progress || 0} onChange={(e) => setEditForm({ ...editForm, progress: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">订单号</label>
                    <Input value={editForm.orderNumber || ""} onChange={(e) => setEditForm({ ...editForm, orderNumber: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">单位</label>
                    <Input value={editForm.organization || ""} onChange={(e) => setEditForm({ ...editForm, organization: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">客户</label>
                    <Input value={editForm.client || ""} onChange={(e) => setEditForm({ ...editForm, client: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">代表</label>
                    <Input value={editForm.representative || ""} onChange={(e) => setEditForm({ ...editForm, representative: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">开始日期</label>
                    <Input type="date" value={editForm.startDate ? new Date(editForm.startDate).toISOString().split("T")[0] : ""} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">结束日期</label>
                    <Input type="date" value={editForm.endDate ? new Date(editForm.endDate).toISOString().split("T")[0] : ""} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "保存中..." : "保存更改"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Dialog */}
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                  确认删除项目
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  此操作将软删除项目 &quot;{project.name}&quot;。项目数据将被保留，但不再显示在常规列表中。
                </p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">删除原因 <span className="text-red-500">*</span></label>
                  <Textarea
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="请填写删除原因..."
                    rows={3}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteReason(""); }}>
                    取消
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={!deleteReason.trim() || deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(deleteReason.trim())}
                  >
                    {deleteMutation.isPending ? "删除中..." : "确认删除"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
          )}
        </div>

        {/* Deleted warning banner */}
        {project.deleted && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800">此项目已被删除</p>
              <p className="text-sm text-red-700 mt-1">
                删除原因：{project.deletedReason || "未记录"}
              </p>
              {project.deletedAt && (
                <p className="text-xs text-red-600 mt-1">
                  删除时间：{new Date(project.deletedAt).toLocaleString("zh-CN")}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>项目进度</span>
            <span className="font-medium">{project.progress}%</span>
          </div>
          {isOwner && !project.deleted ? (
            <Slider
              value={[sliderValue !== undefined ? sliderValue : project.progress]}
              max={100}
              step={1}
              onValueChange={(val) => {
                const arr = Array.isArray(val) ? val : [val];
                setSliderValue(arr[0]);
              }}
              onValueCommitted={(val) => {
                const arr = Array.isArray(val) ? val : [val];
                updateMutation.mutate({ progress: arr[0] });
              }}
            />
          ) : (
            <Progress value={project.progress} className="h-2" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {project.orderNumber && (
            <span className="bg-muted px-2 py-0.5 rounded text-xs font-medium">订单: {project.orderNumber}</span>
          )}
          {project.organization && <span>{project.organization}</span>}
          {project.client && <span>客户: {project.client}</span>}
          {project.representative && <span>代表: {project.representative}</span>}
          {project.startDate && (
            <span>开始: {new Date(project.startDate).toLocaleDateString("zh-CN")}</span>
          )}
          {project.endDate && (
            <span>截止: {new Date(project.endDate).toLocaleDateString("zh-CN")}</span>
          )}
          <span>{project._count?.tickets ?? 0} 工单</span>
          <span>{project._count?.comments ?? 0} 评论</span>
          <span>{project._count?.attachments ?? 0} 文件</span>
        </div>

        {project.members && project.members.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">成员:</span>
            <div className="flex -space-x-2">
              {project.members.map((m) => (
                <Avatar key={m.user.id} className="h-7 w-7 ring-2 ring-background">
                  <AvatarFallback className="bg-primary text-primary-foreground text-[10px]">
                    {m.user.name?.slice(0, 2)?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ))}
            </div>
          </div>
        )}
      </div>

      <Tabs defaultValue="timeline" className="space-y-4">
        <TabsList className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex">
          <TabsTrigger value="timeline">
            <Activity className="mr-2 h-4 w-4" />
            时间流
          </TabsTrigger>
          <TabsTrigger value="tickets">
            <Ticket className="mr-2 h-4 w-4" />
            工单
          </TabsTrigger>
          <TabsTrigger value="files">
            <Paperclip className="mr-2 h-4 w-4" />
            文件
          </TabsTrigger>
        </TabsList>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="space-y-4">
          <Card
            className={!project.deleted && isDraggingTimeline ? "border-primary border-2 border-dashed" : ""}
            onDragOver={(e) => { if (!project.deleted) { e.preventDefault(); setIsDraggingTimeline(true); } }}
            onDragLeave={() => setIsDraggingTimeline(false)}
            onDrop={(e) => {
              if (project.deleted) return;
              e.preventDefault();
              setIsDraggingTimeline(false);
              const file = e.dataTransfer.files?.[0];
              if (file) uploadMutation.mutate(file);
            }}
          >
            <CardContent className="p-4 space-y-4">
              {timelineLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-16 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : timeline.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">暂无动态</div>
              ) : (
                <div className="space-y-0">
                  {timeline.map((item, index) => {
                    const Icon = ACTIVITY_ICONS[item.type] || Activity;
                    const isComment = item.kind === "comment";
                    const isTicketEvent = item.type === "TICKET_CREATED" || item.type === "TICKET_UPDATED";
                    const meta = item.metadata ? JSON.parse(item.metadata) : {};
                    const ticketId = meta.ticketId || meta.ticket?.id;
                    const ticket = ticketId ? tickets.find((t) => t.id === ticketId) : null;

                    return (
                      <div key={item.id} className="relative pl-8 pb-6 last:pb-0">
                        {index !== timeline.length - 1 && (
                          <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
                        )}
                        <div className="absolute left-0 top-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                          <Icon className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.user && (
                              <span className="font-medium text-sm">{item.user.name}</span>
                            )}
                            <span className="text-sm text-muted-foreground">{item.content}</span>
                            {isTicketEvent && ticket && (
                              project.deleted ? (
                                <Badge variant="secondary" className="text-xs">
                                  {ticket.status === "OPEN" ? "打开" : ticket.status === "IN_PROGRESS" ? "处理中" : "已关闭"}
                                </Badge>
                              ) : (
                                <Select
                                  value={ticket.status}
                                  onValueChange={(newStatus) => { if (newStatus) updateTicketMutation.mutate({ ticketId: ticket.id, status: newStatus }); }}
                                >
                                  <SelectTrigger className="h-7 text-xs w-auto min-w-[80px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="OPEN">打开</SelectItem>
                                    <SelectItem value="IN_PROGRESS">处理中</SelectItem>
                                    <SelectItem value="CLOSED">已关闭</SelectItem>
                                  </SelectContent>
                                </Select>
                              )
                            )}
                          </div>
                          {isComment && (
                            <div className="bg-muted rounded-lg p-3">
                              {renderCommentContent(item.content)}
                            </div>
                          )}
                          {item.kind === "attachment" && item.metadata && (
                            <div className="flex items-center gap-2 bg-muted rounded-lg p-3">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{JSON.parse(item.metadata).filename}</span>
                              <a href={JSON.parse(item.metadata).url} download className="ml-auto">
                                <Download className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                              </a>
                            </div>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: zhCN })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comment Input */}
          {!project.deleted && (
            <div className="flex gap-2">
              <Textarea
                placeholder="发表评论..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="min-h-[60px] resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (comment.trim()) commentMutation.mutate(comment);
                  }
                }}
              />
              <div className="flex flex-col gap-1 shrink-0">
                <input
                  type="file"
                  ref={commentFileInputRef}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) commentUploadMutation.mutate(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => commentFileInputRef.current?.click()}
                  disabled={commentUploadMutation.isPending}
                >
                  {commentUploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  className="shrink-0 h-auto flex-1"
                  disabled={!comment.trim() || commentMutation.isPending}
                  onClick={() => commentMutation.mutate(comment)}
                >
                  {commentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Tickets Tab */}
        <TabsContent value="tickets" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">项目工单</h3>
            {!project.deleted && (
              <Dialog open={ticketOpen} onOpenChange={setTicketOpen}>
                <DialogTrigger>
                  <Button size="sm"><Plus className="mr-1 h-3 w-3" />新建工单</Button>
                </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle>新建工单</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); ticketMutation.mutate(ticketForm); }} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">标题</label>
                    <Input value={ticketForm.title} onChange={(e) => setTicketForm({ ...ticketForm, title: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">描述</label>
                    <Textarea value={ticketForm.description} onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })} rows={3} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">优先级</label>
                    <Select value={ticketForm.priority} onValueChange={(v) => setTicketForm({ ...ticketForm, priority: v || "MEDIUM" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">低</SelectItem>
                        <SelectItem value="MEDIUM">中</SelectItem>
                        <SelectItem value="HIGH">高</SelectItem>
                        <SelectItem value="URGENT">紧急</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">提醒时间（可选）</label>
                    <Input
                      type="datetime-local"
                      value={ticketForm.reminderDate}
                      onChange={(e) => setTicketForm({ ...ticketForm, reminderDate: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">到达提醒时间后会同时发送邮件和站内通知给工单创建者</p>
                  </div>
                  <Button type="submit" className="w-full" disabled={ticketMutation.isPending}>
                    {ticketMutation.isPending ? "创建中..." : "创建工单"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            )}
          </div>

          <div
            className={!project.deleted && isDraggingTickets ? "border-primary border-2 border-dashed rounded-lg p-2" : ""}
            onDragOver={(e) => { if (!project.deleted) { e.preventDefault(); setIsDraggingTickets(true); } }}
            onDragLeave={() => setIsDraggingTickets(false)}
            onDrop={(e) => {
              if (project.deleted) return;
              e.preventDefault();
              setIsDraggingTickets(false);
              const file = e.dataTransfer.files?.[0];
              if (file) uploadMutation.mutate(file);
            }}
          >
            {tickets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border rounded-lg">暂无工单</div>
            ) : (
              <div className="space-y-3">
                {tickets.map((ticket) => {
                  const isExpanded = expandedTicket === ticket.id;
                  return (
                    <Card key={ticket.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-medium">{ticket.title}</h4>
                              <Badge variant={ticket.priority === "URGENT" ? "destructive" : ticket.priority === "HIGH" ? "default" : "secondary"}>
                                {ticket.priority === "LOW" ? "低" : ticket.priority === "MEDIUM" ? "中" : ticket.priority === "HIGH" ? "高" : "紧急"}
                              </Badge>
                              <Badge variant={ticket.status === "CLOSED" ? "outline" : "secondary"}>
                                {ticket.status === "OPEN" ? "打开" : ticket.status === "IN_PROGRESS" ? "处理中" : "已关闭"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{ticket.description || "无描述"}</p>
                            {ticket.reminderDate && (
                              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                提醒: {new Date(ticket.reminderDate).toLocaleString("zh-CN")}
                                {ticket.reminderSent && " (已发送)"}
                              </p>
                            )}
                          </div>
                          {!project.deleted && (
                            <DropdownMenu>
                              <DropdownMenuTrigger>
                                <Button variant="ghost" size="icon" className="shrink-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {ticket.status !== "IN_PROGRESS" && (
                                  <DropdownMenuItem onClick={() => updateTicketMutation.mutate({ ticketId: ticket.id, status: "IN_PROGRESS" })}>
                                    标记为处理中
                                  </DropdownMenuItem>
                                )}
                                {ticket.status !== "CLOSED" && (
                                  <DropdownMenuItem onClick={() => updateTicketMutation.mutate({ ticketId: ticket.id, status: "CLOSED" })}>
                                    标记为已关闭
                                  </DropdownMenuItem>
                                )}
                                {ticket.status !== "OPEN" && (
                                  <DropdownMenuItem onClick={() => updateTicketMutation.mutate({ ticketId: ticket.id, status: "OPEN" })}>
                                    重新打开
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>

                        {!project.deleted && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 text-xs"
                            onClick={() => setExpandedTicket(isExpanded ? null : ticket.id)}
                          >
                            {isExpanded ? "收起回复" : "回复"}
                          </Button>
                        )}

                        {isExpanded && !project.deleted && (
                          <TicketReplies
                            ticketId={ticket.id}
                            replyContent={replyContent}
                            setReplyContent={setReplyContent}
                            replyMutation={replyMutation}
                          />
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Files Tab */}
        <TabsContent value="files" className="space-y-4">
          <div
            className={`space-y-4 ${isDraggingFiles && !project.deleted ? "border-primary border-2 border-dashed rounded-lg p-4" : ""}`}
            onDragOver={(e) => { if (!project.deleted) { e.preventDefault(); setIsDraggingFiles(true); } }}
            onDragLeave={() => setIsDraggingFiles(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFiles(false);
              if (project.deleted) return;
              const file = e.dataTransfer.files?.[0];
              if (file) uploadMutation.mutate(file);
            }}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-medium">项目文件</h3>
              {!project.deleted && (
                <label className="cursor-pointer inline-flex">
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadMutation.mutate(file);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3">
                    <Upload className="mr-1 h-3 w-3" />上传文件
                  </span>
                </label>
              )}
            </div>

            {isDraggingFiles ? (
              <div className="text-center py-8 text-primary text-sm font-medium">拖放文件到此处上传</div>
            ) : attachments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border rounded-lg">暂无文件</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {attachments.map((item) => {
                  const meta = item.metadata ? JSON.parse(item.metadata) : {};
                  const isImage = meta.mimeType?.startsWith("image/");
                  return (
                    <Card key={item.id}>
                      <CardContent className="p-4 flex items-center gap-3">
                        {isImage ? <ImageIcon className="h-8 w-8 text-blue-500" /> : <FileText className="h-8 w-8 text-muted-foreground" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{meta.filename}</p>
                          <p className="text-xs text-muted-foreground">{(meta.size / 1024).toFixed(1)} KB</p>
                        </div>
                        <a href={meta.url} download>
                          <Download className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </a>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Image Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>图片预览</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img src={previewImage} alt="preview" className="w-full h-auto rounded" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TicketReplies({
  ticketId,
  replyContent,
  setReplyContent,
  replyMutation,
}: {
  ticketId: string;
  replyContent: Record<string, string>;
  setReplyContent: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  replyMutation: {
    mutate: (vars: { ticketId: string; content: string }) => void;
    isPending: boolean;
  };
}) {
  const { data: repliesData } = useQuery<{ replies: TicketReplyItem[] }>({
    queryKey: ["ticket-replies", ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/replies`);
      if (!res.ok) throw new Error("Failed to load replies");
      return res.json();
    },
    enabled: true,
  });

  const replies = repliesData?.replies || [];
  const content = replyContent[ticketId] || "";

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      {replies.length === 0 ? (
        <div className="text-xs text-muted-foreground">暂无回复</div>
      ) : (
        <div className="space-y-2">
          {replies.map((reply) => (
            <div key={reply.id} className="bg-muted rounded-lg p-2 text-sm">
              <div className="flex items-center gap-1 mb-1">
                <span className="font-medium text-xs">{reply.author.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true, locale: zhCN })}
                </span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{reply.content}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Textarea
          placeholder="回复..."
          value={content}
          onChange={(e) => setReplyContent((prev) => ({ ...prev, [ticketId]: e.target.value }))}
          className="min-h-[50px] resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (content.trim()) replyMutation.mutate({ ticketId, content });
            }
          }}
        />
        <Button
          size="icon"
          className="shrink-0 h-auto"
          disabled={!content.trim() || replyMutation.isPending}
          onClick={() => replyMutation.mutate({ ticketId, content })}
        >
          {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
