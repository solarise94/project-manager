"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Plus, Pencil, Archive, ArchiveRestore, Trash2, Merge,
  Building2, Tag, MapPin, X, Users, BarChart3, UserCog, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { OrganizationAiFillPlugin, type OrganizationDraftPreview } from "@/components/organization-ai-fill-plugin";
import { TaxIdLookupInput } from "@/components/tax-id-lookup-input";
import { CRM_SITE_TYPES, SITE_TYPE_LABELS } from "@/lib/crm/constants";
import Link from "next/link";
import { toast } from "sonner";

interface OrgAlias {
  id: string;
  alias: string;
  aliasType: string;
}

interface OrgSite {
  id: string;
  siteName: string;
  siteType: string;
  address: string | null;
}

interface SiteForm {
  siteName: string;
  address: string;
  siteType: string;
}

interface OrgItem {
  id: string;
  orgCode: string;
  canonicalName: string;
  address: string | null;
  taxId: string | null;
  archived: boolean;
  aliases: OrgAlias[];
  sites: OrgSite[];
  _count: { customers: number };
}

const emptyCreate = { canonicalName: "", address: "", aliases: [""], sites: [{ siteName: "", address: "", siteType: "CAMPUS" }] };

export default function OrganizationsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [editing, setEditing] = useState<OrgItem | null>(null);
  const [mergeSource, setMergeSource] = useState<OrgItem | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [form, setForm] = useState({ ...emptyCreate });
  const [editForm, setEditForm] = useState({ canonicalName: "", address: "", taxId: "" });
  const [newAlias, setNewAlias] = useState("");
  const [newSite, setNewSite] = useState({ siteName: "", address: "", siteType: "CAMPUS" });
  const [assignFilter, setAssignFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTargetOrg, setAssignTargetOrg] = useState<OrgItem | null>(null);
  const [selectedRepId, setSelectedRepId] = useState<string>("");
  const [selectedAssignSiteId, setSelectedAssignSiteId] = useState<string>("__org__");

  const { data, isLoading, error } = useQuery<{ organizations: OrgItem[] }>({
    queryKey: ["organizations"],
    queryFn: async () => {
      const res = await fetch("/api/organizations");
      if (res.status === 403) throw new Error("无权访问");
      if (!res.ok) throw new Error("加载失败");
      return res.json();
    },
    enabled: status === "authenticated" && session?.user?.role === "ADMIN",
  });

  const { data: bindingsData } = useQuery<{ bindings: Array<{
    id: string;
    status: string;
    organizationId: string | null;
    organizationSiteId: string | null;
    isPrimary?: boolean;
    organizationSite?: { id: string; siteName: string; siteType: string } | null;
    representative: { id: string; name: string; email: string } | null;
  }> }>({
    queryKey: ["representative-organizations", "all"],
    queryFn: async () => {
      const res = await fetch("/api/crm/representative-organizations");
      if (!res.ok) return { bindings: [] };
      return res.json();
    },
    enabled: status === "authenticated" && session?.user?.role === "ADMIN",
  });

  const { data: repsData } = useQuery<{ representatives: Array<{ id: string; name: string; email: string }> }>({
    queryKey: ["representatives-list"],
    queryFn: async () => {
      const res = await fetch("/api/representatives/list");
      if (!res.ok) return { representatives: [] };
      return res.json();
    },
    enabled: assignDialogOpen && status === "authenticated",
  });

  const assignRepMutation = useMutation({
    mutationFn: async ({ orgId, repId, siteId }: { orgId: string; repId: string; siteId: string | null }) => {
      const res = await fetch("/api/crm/representative-organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          representativeId: repId,
          organizationId: orgId,
          organizationSiteId: siteId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "分配失败");
      return json;
    },
    onSuccess: () => {
      toast.success("代表已分配");
      setAssignDialogOpen(false);
      setAssignTargetOrg(null);
      setSelectedRepId("");
      setSelectedAssignSiteId("__org__");
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["representative-organizations", "all"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/dashboard");
    }
    if (error?.message === "无权访问") {
      router.push("/dashboard");
    }
  }, [status, session, error, router]);

  const createMutation = useMutation({
    mutationFn: async (payload: typeof emptyCreate) => {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalName: payload.canonicalName,
          address: payload.address || null,
          aliases: payload.aliases.filter(Boolean),
          sites: (payload.sites as SiteForm[]).filter((s) => s.siteName).map((s) => ({ siteName: s.siteName, address: s.address, siteType: s.siteType || "CAMPUS" })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      return data;
    },
    onSuccess: () => {
      toast.success("机构创建成功");
      setCreateOpen(false);
      setForm({ ...emptyCreate });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown> & { id: string }) => {
      const { id, ...body } = payload;
      const res = await fetch(`/api/organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新失败");
      return data;
    },
    onSuccess: () => {
      toast.success("已更新");
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/organizations/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      return data;
    },
    onSuccess: () => {
      toast.success("机构已删除");
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      const res = await fetch(`/api/organizations/${sourceId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "合并失败");
      return data;
    },
    onSuccess: () => {
      toast.success("机构已合并");
      setMergeOpen(false);
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const orgs = data?.organizations || [];
  const bindings = bindingsData?.bindings || [];
  const bindingMap = new Map<string, Array<{
    id: string;
    name: string;
    email: string;
    organizationSiteId: string | null;
    organizationSiteName: string | null;
    isPrimary: boolean;
  }>>();
  const bindingStatusMap = new Map<string, Set<string>>();
  for (const b of bindings) {
    if (b.organizationId) {
      const statuses = bindingStatusMap.get(b.organizationId) || new Set<string>();
      statuses.add(b.status);
      bindingStatusMap.set(b.organizationId, statuses);
    }
    if (b.organizationId && b.status === "ACTIVE" && b.representative) {
      const list = bindingMap.get(b.organizationId) || [];
      list.push({
        id: b.representative.id,
        name: b.representative.name,
        email: b.representative.email,
        organizationSiteId: b.organizationSiteId || null,
        organizationSiteName: b.organizationSite?.siteName || null,
        isPrimary: !!b.isPrimary,
      });
      bindingMap.set(b.organizationId, list);
    }
  }

  const filtered = orgs
    .filter(
      (o) =>
        o.canonicalName.toLowerCase().includes(search.toLowerCase()) ||
        o.orgCode.toLowerCase().includes(search.toLowerCase()) ||
        o.aliases.some((a) => a.alias.toLowerCase().includes(search.toLowerCase()))
    )
    .filter((o) => {
      if (assignFilter === "all") return true;
      const hasActiveBinding = bindingMap.has(o.id);
      return assignFilter === "assigned" ? hasActiveBinding : !hasActiveBinding;
    });

  function openCreateDialog(initialName = "") {
    setForm({
      canonicalName: initialName,
      address: "",
      aliases: [""],
      sites: [{ siteName: "", address: "", siteType: "CAMPUS" }],
    });
    setCreateOpen(true);
  }

  function applyDraftToCreateForm(draft: OrganizationDraftPreview) {
    setForm({
      canonicalName: draft.canonicalName,
      address: draft.address || "",
      aliases: draft.aliases.length > 0 ? draft.aliases : [""],
      sites: draft.sites.length > 0
        ? draft.sites.map((site) => ({ siteName: site.siteName, address: site.address || "", siteType: "CAMPUS" }))
        : [{ siteName: "", address: "", siteType: "CAMPUS" }],
    });
    toast.success("已应用 AI 草稿，请检查后再保存");
  }

  if (status === "loading") return null;
  if (!session || session.user.role !== "ADMIN") return null;
  if (error?.message === "无权访问") return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-6 w-6" />
          单位主数据管理
        </h1>
        <p className="text-muted-foreground">管理机构标准名称、别名和院区/校区</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索机构..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={assignFilter} onValueChange={(v) => setAssignFilter(v as "all" | "assigned" | "unassigned")}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部单位</SelectItem>
            <SelectItem value="assigned">已分配代表</SelectItem>
            <SelectItem value="unassigned">未分配代表</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => openCreateDialog()}>
          <Plus className="mr-2 h-4 w-4" />新增机构
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-muted animate-pulse rounded" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center space-y-3">
          <p className="text-muted-foreground">{search ? "未找到匹配的机构" : "暂无机构数据"}</p>
          {search && (
            <Button variant="outline" size="sm" onClick={() => openCreateDialog(search.trim())}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              手工新增机构
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <div key={o.id} className={`rounded-lg border bg-card p-4 ${o.archived ? "opacity-60" : ""}`}>
              {(() => {
                const activeBindings = bindingMap.get(o.id) || [];
                const statuses = bindingStatusMap.get(o.id) || new Set<string>();
                const hasPendingBinding = statuses.has("PENDING");
                const hasHistoricalBinding = statuses.has("REJECTED") || statuses.has("ARCHIVED");

                return (
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{o.canonicalName}</span>
                    <span className="text-xs text-muted-foreground font-mono">{o.orgCode}</span>
                    {o.archived && <Badge variant="outline" className="text-xs"><Archive className="h-3 w-3 mr-1" />已归档</Badge>}
                    <Badge variant="secondary" className="text-xs">{o._count.customers} 客户</Badge>
                    {activeBindings.length > 0 ? (
                      activeBindings.map((r) => (
                        <Badge key={r.id} variant="default" className="text-xs bg-blue-600 hover:bg-blue-700">
                          <UserCog className="h-3 w-3 mr-1" />
                          {r.name}
                          {r.organizationSiteName ? ` · ${r.organizationSiteName}` : " · 全机构"}
                          {r.isPrimary ? " · 主代表" : ""}
                        </Badge>
                      ))
                    ) : hasPendingBinding ? (
                      <Badge variant="outline" className="text-xs text-sky-700 border-sky-200">
                        <Link2 className="h-3 w-3 mr-1" />待审核绑定
                      </Badge>
                    ) : hasHistoricalBinding ? (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        <Link2 className="h-3 w-3 mr-1" />当前无生效代表
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
                        <Link2 className="h-3 w-3 mr-1" />未分配代表
                      </Badge>
                    )}
                    <Link href={`/crm/customers?organizationId=${o.id}&organizationName=${encodeURIComponent(o.canonicalName)}`} className="inline-flex items-center gap-1 h-6 px-2 text-xs hover:bg-muted rounded-md"><Users className="h-3 w-3" />客户管理</Link>
                    <Link href={`/admin/organizations/${o.id}/analytics`} className="inline-flex items-center gap-1 h-6 px-2 text-xs hover:bg-muted rounded-md"><BarChart3 className="h-3 w-3" />分析</Link>
                  </div>
                  {o.address && <div className="text-sm text-muted-foreground mt-1"><MapPin className="h-3 w-3 inline mr-1" />{o.address}</div>}
                  {o.aliases.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
                      {o.aliases.map((a) => (
                        <Badge key={a.id} variant="outline" className="text-xs">{a.alias}</Badge>
                      ))}
                    </div>
                  )}
                  {o.sites.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      {o.sites.map((s) => (
                        <Badge key={s.id} variant="secondary" className="text-xs">{s.siteName}{s.address ? ` · ${s.address}` : ""}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" title="分配代表"
                    onClick={() => {
                      setAssignTargetOrg(o);
                      setSelectedRepId("");
                      setSelectedAssignSiteId("__org__");
                      setAssignDialogOpen(true);
                    }}
                  ><UserCog className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => {
                    setEditing(o);
                    setEditForm({ canonicalName: o.canonicalName, address: o.address || "", taxId: o.taxId || "" });
                    setNewAlias("");
                    setNewSite({ siteName: "", address: "", siteType: "CAMPUS" });
                    setEditOpen(true);
                  }}><Pencil className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => { setMergeSource(o); setMergeTargetId(""); setMergeOpen(true); }}>
                    <Merge className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm"
                    className={o.archived ? "text-green-600" : "text-amber-600"}
                    onClick={() => updateMutation.mutate({ id: o.id, archived: !o.archived })}
                  >
                    {o.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                  </Button>
                  {o._count.customers === 0 && (
                    <Button variant="ghost" size="sm" className="text-red-600"
                      onClick={() => { if (confirm(`确定删除 "${o.canonicalName}"？`)) deleteMutation.mutate(o.id); }}
                    ><Trash2 className="h-3 w-3" /></Button>
                  )}
                </div>
              </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {/* Assign Representative Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>分配代表</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              为单位 <span className="font-medium text-foreground">{assignTargetOrg?.canonicalName}</span> 分配代表
            </p>
            <div className="space-y-2">
              <Label>选择代表</Label>
              <Select value={selectedRepId} onValueChange={(v) => setSelectedRepId(v || "")}>
                <SelectTrigger>
                  <SelectValue placeholder="选择代表..." />
                </SelectTrigger>
                <SelectContent>
                  {repsData?.representatives.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name} ({r.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>绑定范围</Label>
              <Select value={selectedAssignSiteId} onValueChange={(v) => setSelectedAssignSiteId(v || "__org__")}>
                <SelectTrigger>
                  <SelectValue placeholder="选择绑定范围..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__org__">整个单位</SelectItem>
                  {assignTargetOrg?.sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.siteName}
                      {site.siteType ? ` (${SITE_TYPE_LABELS[site.siteType] || site.siteType})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!selectedRepId || assignRepMutation.isPending}
              onClick={() => {
                if (assignTargetOrg && selectedRepId) {
                  assignRepMutation.mutate({
                    orgId: assignTargetOrg.id,
                    repId: selectedRepId,
                    siteId: selectedAssignSiteId === "__org__" ? null : selectedAssignSiteId,
                  });
                }
              }}
            >
              {assignRepMutation.isPending ? "分配中..." : "确认分配"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>新增机构</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!form.canonicalName.trim()) return; createMutation.mutate(form); }} className="space-y-4">
            <OrganizationAiFillPlugin query={form.canonicalName} onApply={applyDraftToCreateForm} disabled={createMutation.isPending} />
            <div className="space-y-2">
              <Label>标准名称 *</Label>
              <Input value={form.canonicalName} onChange={(e) => setForm({ ...form, canonicalName: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>地址</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>别名（简称、旧名等）</Label>
              {form.aliases.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={a} onChange={(e) => { const arr = [...form.aliases]; arr[i] = e.target.value; setForm({ ...form, aliases: arr }); }} placeholder="如：浙一" />
                  {form.aliases.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, aliases: form.aliases.filter((_, j) => j !== i) })}><X className="h-3 w-3" /></Button>}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, aliases: [...form.aliases, ""] })}>
                <Plus className="h-3 w-3 mr-1" />添加别名
              </Button>
            </div>
            <div className="space-y-2">
              <Label>院区/校区</Label>
              {form.sites.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={s.siteName} onChange={(e) => { const arr = [...form.sites]; arr[i] = { ...arr[i], siteName: e.target.value }; setForm({ ...form, sites: arr }); }} placeholder="院区名称" className="flex-1" />
                  <Select value={(s as SiteForm).siteType || "CAMPUS"} onValueChange={(v) => { const arr = [...form.sites]; arr[i] = { ...arr[i], siteType: v || "CAMPUS" }; setForm({ ...form, sites: arr }); }}>
                    <SelectTrigger className="w-[90px]"><span>{SITE_TYPE_LABELS[(s as SiteForm).siteType] || "类型"}</span></SelectTrigger>
                    <SelectContent>
                      {CRM_SITE_TYPES.map((st) => (<SelectItem key={st} value={st}>{SITE_TYPE_LABELS[st]}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <Input value={s.address} onChange={(e) => { const arr = [...form.sites]; arr[i] = { ...arr[i], address: e.target.value }; setForm({ ...form, sites: arr }); }} placeholder="地址" className="flex-1" />
                  {form.sites.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, sites: form.sites.filter((_, j) => j !== i) })}><X className="h-3 w-3" /></Button>}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, sites: [...form.sites, { siteName: "", address: "", siteType: "CAMPUS" }] })}>
                <Plus className="h-3 w-3 mr-1" />添加院区
              </Button>
            </div>
            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? "创建中..." : "创建机构"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>编辑机构</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>标准名称</Label>
              <Input value={editForm.canonicalName} onChange={(e) => setEditForm({ ...editForm, canonicalName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>地址</Label>
              <Input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>税号</Label>
              <TaxIdLookupInput
                value={editForm.taxId}
                onChange={(v) => setEditForm({ ...editForm, taxId: v })}
                orgName={editForm.canonicalName}
                placeholder="统一社会信用代码/纳税人识别号"
              />
            </div>
            <Button size="sm" disabled={updateMutation.isPending} onClick={() => {
              if (!editing) return;
              updateMutation.mutate({ id: editing.id, canonicalName: editForm.canonicalName, address: editForm.address, taxId: editForm.taxId });
            }}>保存基本信息</Button>

            <hr />
            <div className="space-y-2">
              <Label>别名</Label>
              <div className="flex flex-wrap gap-1.5">
                {editing?.aliases.map((a) => (
                  <Badge key={a.id} variant="outline" className="gap-1">
                    {a.alias}
                    <button type="button" className="hover:text-red-500" onClick={() => {
                      updateMutation.mutate({ id: editing.id, removeAliasId: a.id });
                    }}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={newAlias} onChange={(e) => setNewAlias(e.target.value)} placeholder="新别名" className="flex-1" />
                <Button size="sm" disabled={!newAlias.trim()} onClick={() => {
                  if (!editing) return;
                  updateMutation.mutate({ id: editing.id, addAlias: newAlias.trim() });
                  setNewAlias("");
                }}>添加</Button>
              </div>
            </div>

            <hr />
            <div className="space-y-2">
              <Label>院区/校区</Label>
              <div className="space-y-1.5">
                {editing?.sites.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <Building2 className="h-3 w-3 text-muted-foreground" />
                    <span>{s.siteName}</span>
                    <Badge variant="secondary" className="text-[10px]">{SITE_TYPE_LABELS[s.siteType] || "院区"}</Badge>
                    {s.address && <span className="text-muted-foreground">· {s.address}</span>}
                    <button type="button" className="ml-auto text-muted-foreground hover:text-red-500" onClick={() => {
                      updateMutation.mutate({ id: editing.id, removeSiteId: s.id });
                    }}><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={newSite.siteName} onChange={(e) => setNewSite({ ...newSite, siteName: e.target.value })} placeholder="院区名称" className="flex-1" />
                <Select value={newSite.siteType} onValueChange={(v) => setNewSite({ ...newSite, siteType: v || "CAMPUS" })}>
                  <SelectTrigger className="w-[100px]"><span>{SITE_TYPE_LABELS[newSite.siteType] || "类型"}</span></SelectTrigger>
                  <SelectContent>
                    {CRM_SITE_TYPES.map((st) => (<SelectItem key={st} value={st}>{SITE_TYPE_LABELS[st]}</SelectItem>))}
                  </SelectContent>
                </Select>
                <Input value={newSite.address} onChange={(e) => setNewSite({ ...newSite, address: e.target.value })} placeholder="地址" className="flex-1" />
                <Button size="sm" disabled={!newSite.siteName.trim() || updateMutation.isPending} onClick={() => {
                  if (!editing) return;
                  updateMutation.mutate({ id: editing.id, addSite: newSite });
                  setNewSite({ siteName: "", address: "", siteType: "CAMPUS" });
                }}>添加</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>合并机构</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              将 <span className="font-medium text-foreground">{mergeSource?.canonicalName}</span> 的所有客户、别名和院区转移到目标机构。源机构将被标记为已删除，其标准名称会作为目标机构的别名保留。
            </p>
            <div className="space-y-2">
              <Label>目标机构</Label>
              <Select value={mergeTargetId} onValueChange={(v) => setMergeTargetId(v || "")}>
                <SelectTrigger><SelectValue placeholder="选择目标机构..." /></SelectTrigger>
                <SelectContent>
                  {orgs.filter((o) => o.id !== mergeSource?.id && !o.archived).map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.canonicalName} ({o.orgCode})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={!mergeTargetId || mergeMutation.isPending}
              onClick={() => {
                if (!mergeSource || !mergeTargetId) return;
                const target = orgs.find((o) => o.id === mergeTargetId);
                if (confirm(`确定将 "${mergeSource.canonicalName}" 合并到 "${target?.canonicalName}"？`)) {
                  mergeMutation.mutate({ sourceId: mergeSource.id, targetId: mergeTargetId });
                }
              }}
            >
              <Merge className="mr-2 h-4 w-4" />
              {mergeMutation.isPending ? "合并中..." : "确认合并"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
