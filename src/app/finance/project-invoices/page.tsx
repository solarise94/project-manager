"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { InvoiceFormDialog, type InvoiceRecord } from "@/components/invoice-form-dialog";
import { InvoiceCard } from "@/components/finance/invoice-card";

const STATUS_OPTIONS: Record<string, string> = {
  "": "全部状态", DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票", CANCELLED: "已取消",
};

interface ProjectItem {
  id: string;
  name: string;
  cust?: { id: string; name: string; organizationId?: string | null; organization?: string | null } | null;
  orderNumber?: string | null;
  organizationId?: string | null;
  organization?: string | null;
}

interface InvoiceWithProject extends InvoiceRecord {
  project?: { id: string; name: string; cust?: { id: string; name: string } | null } | null;
}

export default function ProjectInvoicesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  if (status === "loading") return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }
  return <ProjectInvoicesContent />;
}

function ProjectInvoicesContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId") || "";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRecord | null>(null);
  const [createProjectId, setCreateProjectId] = useState(initialProjectId);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const { data, isLoading } = useQuery<{ invoices: InvoiceWithProject[]; total: number; totalPages: number }>({
    queryKey: ["finance", "project-invoices", search, statusFilter, initialProjectId, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (initialProjectId) params.set("projectId", initialProjectId);
      const res = await fetch(`/api/finance/project-invoices?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["finance", "project-invoices"] });
  }, [queryClient]);

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/project-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      return data;
    },
    onSuccess: () => { toast.success("状态已更新"); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const remarkMutation = useMutation({
    mutationFn: async ({ id, remark }: { id: string; remark: string }) => {
      const res = await fetch(`/api/project-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      return data;
    },
    onSuccess: () => { toast.success("备注已更新"); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const confirmTaxIdMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/project-invoices/${invoiceId}/confirm-tax-id`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失败");
      return data;
    },
    onSuccess: (data: { conflict?: boolean; message?: string }) => {
      if (data.conflict) toast.warning(data.message || "税号冲突，已清除标记");
      else toast.success(data.message || "税号已同步到主数据");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (createProjectId) {
      setEditingInvoice(null);
      setInvoiceOpen(true);
    } else {
      setProjectPickerOpen(true);
    }
  };

  const invoices = data?.invoices || [];

  // Fetch project info for pre-filling defaults when creating from project context
  const { data: defaultProject } = useQuery<ProjectItem>({
    queryKey: ["project", createProjectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${createProjectId}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      return data.project || data;
    },
    enabled: !!createProjectId && !editingInvoice,
  });

  const invoiceDefaults = defaultProject ? {
    projectCode: defaultProject.orderNumber || "",
    buyerOrgId: defaultProject.cust?.organizationId || defaultProject.organizationId || "",
    buyerOrgName: defaultProject.cust?.organization || defaultProject.organization || "",
  } : undefined;

  // Project picker for new invoice
  const [projectSearch, setProjectSearch] = useState("");
  const { data: projectData } = useQuery<{ projects: ProjectItem[] }>({
    queryKey: ["projects", "search", projectSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: "20" });
      if (projectSearch) params.set("search", projectSearch);
      const res = await fetch(`/api/projects?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: projectPickerOpen,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">项目开票</h1>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" /> 新建开票申请
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm min-w-0 w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索公司名、项目名、联系人..."
            className="pl-8"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { if (v !== null) { setStatusFilter(v); setPage(1); } }}>
          <SelectTrigger className="w-28"><SelectDisplay label="状态" valueLabel={STATUS_OPTIONS[statusFilter] || "全部状态"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="DRAFT">草稿</SelectItem>
            <SelectItem value="REQUESTED">已申请</SelectItem>
            <SelectItem value="ISSUED">已开票</SelectItem>
            <SelectItem value="CANCELLED">已取消</SelectItem>
          </SelectContent>
        </Select>
        {initialProjectId && (
          <span className="text-xs text-muted-foreground">已筛选项目</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">暂无开票申请</div>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <div key={inv.id}>
              {inv.project && (
                <div className="text-xs text-muted-foreground mb-1 px-1">
                  项目：{inv.project.name}
                  {inv.project.cust && <span> · {inv.project.cust.name}</span>}
                </div>
              )}
              <InvoiceCard
                inv={inv}
                callbacks={{
                  onEdit: () => { setEditingInvoice(inv as InvoiceRecord); setCreateProjectId(inv.project?.id || ""); setInvoiceOpen(true); },
                  onStatusChange: (id, status) => statusMutation.mutate({ id, status }),
                  onRemarkSave: async (id, remark) => { remarkMutation.mutate({ id, remark }); },
                  onConfirmTaxId: (id) => confirmTaxIdMutation.mutate(id),
                  confirmTaxIdPending: confirmTaxIdMutation.isPending,
                }}
              />
            </div>
          ))}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">共 {data.total} 条</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          </div>
        </div>
      )}

      {/* Project Picker Dialog */}
      <Dialog open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>选择项目</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="搜索项目..." className="pl-8" value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {(projectData?.projects || []).map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    createProjectId === proj.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                  onClick={() => {
                    setCreateProjectId(proj.id);
                    setProjectPickerOpen(false);
                    setEditingInvoice(null);
                    setInvoiceOpen(true);
                  }}
                >
                  <div className="font-medium">{proj.name}</div>
                  {proj.cust && <div className="text-xs opacity-70">{proj.cust.name}</div>}
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice Form Dialog */}
      {createProjectId && (
        <InvoiceFormDialog
          open={invoiceOpen}
          onOpenChange={setInvoiceOpen}
          editingInvoice={editingInvoice}
          createUrl={`/api/projects/${createProjectId}/invoices`}
          patchUrlPrefix="/api/project-invoices"
          onSuccess={invalidate}
          defaultValues={editingInvoice ? undefined : invoiceDefaults}
          showProjectCode={true}
          aiDraftUrl={`/api/projects/${createProjectId}/invoice-draft`}
        />
      )}
    </div>
  );
}
