"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectDisplay } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StageBadge, AssignmentStatusBadge, PersonCategoryBadge } from "@/components/crm/badges";
import { CRM_STAGES, STAGE_LABELS, CRM_ASSIGNMENT_STATUS, ASSIGNMENT_STATUS_LABELS, CRM_PERSON_CATEGORIES, PERSON_CATEGORY_LABELS, CRM_GRADUATION_STATUSES, GRADUATION_STATUS_LABELS, SITE_TYPE_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmCustomerProfileItem } from "@/lib/crm/types";
import { toast } from "sonner";
import Link from "next/link";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Search, UserCog, Undo2, Layers, Filter, X, Users } from "lucide-react";
import { CrmEmptyState } from "@/components/crm/empty-state";

export default function CustomerPoolPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;
  if (session?.user?.role === "REPRESENTATIVE") { router.push("/crm"); return null; }

  return <CustomerPool />;
}

function CustomerPool() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("ALL");
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [personCategory, setPersonCategory] = useState("ALL");
  const [graduationStatus, setGraduationStatus] = useState("ALL");
  const [organizationId, setOrganizationId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("updatedAt");
  const [order, setOrder] = useState("desc");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stage !== "ALL") params.set("stage", stage);
  if (assignmentStatus) params.set("assignmentStatus", assignmentStatus);
  if (personCategory !== "ALL") params.set("personCategory", personCategory);
  if (graduationStatus !== "ALL") params.set("graduationStatus", graduationStatus);
  if (organizationId) params.set("organizationId", organizationId);
  if (siteId) params.set("siteId", siteId);
  if (jobTitleFilter) params.set("jobTitle", jobTitleFilter);
  params.set("page", String(page));
  params.set("sort", sort);
  params.set("order", order);

  const queryKey = ["crm-customer-pool", search, stage, assignmentStatus, personCategory, graduationStatus, organizationId, siteId, jobTitleFilter, page, sort, order];

  const { data, isLoading } = useQuery<{ profiles: CrmCustomerProfileItem[]; total: number; page: number; pageSize: number; totalPages: number }>({
    queryKey,
    queryFn: () => fetch(`/api/crm/customer-pool?${params}`).then((r) => r.json()),
  });

  const profiles = data?.profiles || [];
  const totalPages = data?.totalPages || 1;
  const isMobile = useMediaQuery("(max-width: 767px)");

  const activeFilterCount = [stage, personCategory, graduationStatus].filter((v) => v !== "ALL").length + (assignmentStatus ? 1 : 0) + (organizationId ? 1 : 0) + (siteId ? 1 : 0) + (jobTitleFilter ? 1 : 0);

  function clearAllFilters() {
    setStage("ALL");
    setAssignmentStatus("");
    setPersonCategory("ALL");
    setGraduationStatus("ALL");
    setOrganizationId("");
    setSiteId("");
    setJobTitleFilter("");
    setSort("updatedAt");
    setOrder("desc");
    setPage(1);
  }

  const { data: orgListData } = useQuery<{ customers: { organizationId: string; organization: string | null }[] }>({
    queryKey: ["customers-list"],
    queryFn: () => fetch("/api/customers/list").then((r) => r.json()),
  });
  const uniqueOrgs = orgListData?.customers
    ? [...new Map(orgListData.customers.filter((c) => c.organizationId && c.organization).map((c) => [c.organizationId, c])).values()]
    : [];

  const { data: orgSitesData } = useQuery<{ sites: { id: string; siteName: string; siteType: string }[] }>({
    queryKey: ["organization-sites", organizationId],
    queryFn: () => fetch(`/api/organizations/${organizationId}`).then((r) => r.json()).then((d) => ({ sites: d.organization?.sites || [] })),
    enabled: !!organizationId,
  });
  const orgSites = orgSitesData?.sites || [];

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/crm/lifecycle/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error("扫描失败");
      return res.json();
    },
    onSuccess: (d: { dormantCount: number; warnedCount: number }) => {
      toast.success(`扫描完成，${d.dormantCount} 个客户进入休眠，${d.warnedCount} 个客户进入预警`);
      queryClient.invalidateQueries({ queryKey: ["crm-customer-pool"] });
      queryClient.invalidateQueries({ queryKey: ["crm-profiles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const FilterControls = (
    <div className="space-y-4 max-w-full overflow-x-hidden">
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">分配状态</label>
        <Select value={assignmentStatus} onValueChange={(v) => { setAssignmentStatus(v || ""); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><span>{assignmentStatus ? ASSIGNMENT_STATUS_LABELS[assignmentStatus] || assignmentStatus : "待处理"}</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="">待处理</SelectItem>
            {CRM_ASSIGNMENT_STATUS.map((s) => (
              <SelectItem key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">阶段</label>
        <Select value={stage} onValueChange={(v) => { setStage(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><SelectDisplay label="阶段" valueLabel={stage === "ALL" ? "全部阶段" : STAGE_LABELS[stage] || "未知"} placeholder="阶段" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部阶段</SelectItem>
            {CRM_STAGES.map((s) => (<SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">人员分类</label>
        <Select value={personCategory} onValueChange={(v) => { setPersonCategory(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><SelectDisplay label="分类" valueLabel={personCategory === "ALL" ? "全部分类" : PERSON_CATEGORY_LABELS[personCategory] || "未知"} placeholder="全部分类" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部分类</SelectItem>
            {CRM_PERSON_CATEGORIES.map((pc) => (<SelectItem key={pc} value={pc}>{PERSON_CATEGORY_LABELS[pc]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">毕业状态</label>
        <Select value={graduationStatus} onValueChange={(v) => { setGraduationStatus(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><SelectDisplay label="毕业" valueLabel={graduationStatus === "ALL" ? "全部状态" : GRADUATION_STATUS_LABELS[graduationStatus] || "未知"} placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            {CRM_GRADUATION_STATUSES.map((gs) => (<SelectItem key={gs} value={gs}>{GRADUATION_STATUS_LABELS[gs]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">单位</label>
        <Select value={organizationId || "__all__"} onValueChange={(v) => { setOrganizationId(v === "__all__" ? "" : (v || "")); setSiteId(""); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><span className="block truncate">{organizationId ? (uniqueOrgs.find((o) => o.organizationId === organizationId)?.organization || organizationId) : "全部单位"}</span></SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-2rem)]">
            <SelectItem value="__all__">全部单位</SelectItem>
            {uniqueOrgs.map((o) => (
              <SelectItem key={o.organizationId} value={o.organizationId!}><span className="block max-w-[70vw] truncate">{o.organization}</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {organizationId && orgSites.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">院区/学院/大楼</label>
          <Select value={siteId || "__all__"} onValueChange={(v) => { setSiteId(v === "__all__" ? "" : (v || "")); setPage(1); }}>
            <SelectTrigger className="w-full min-w-0"><span className="block truncate">{siteId ? (orgSites.find((s) => s.id === siteId)?.siteName || siteId) : "全部院区"}</span></SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-2rem)]">
              <SelectItem value="__all__">全部院区</SelectItem>
              {orgSites.map((s) => (
                <SelectItem key={s.id} value={s.id}><span className="block max-w-[70vw] truncate">{s.siteName} ({SITE_TYPE_LABELS[s.siteType] || "未知"})</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">职务关键词</label>
        <Input className="w-full min-w-0" placeholder="例如：教授、博士" value={jobTitleFilter} onChange={(e) => { setJobTitleFilter(e.target.value); setPage(1); }} />
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">排序</label>
        <Select value={sort} onValueChange={(v) => { setSort(v || "updatedAt"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><span>{sort === "updatedAt" ? "最近更新" : sort === "createdAt" ? "创建时间" : sort === "lastFollowUpAt" ? "最近跟进" : "默认"}</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="updatedAt">最近更新</SelectItem>
            <SelectItem value="createdAt">创建时间</SelectItem>
            <SelectItem value="lastFollowUpAt">最近跟进</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOrder(order === "asc" ? "desc" : "asc")}>
          {order === "asc" ? "↑ 升序" : "↓ 降序"}
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}><X className="h-4 w-4 mr-1" />清空全部</Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-4 pb-20 max-w-full overflow-x-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">客户流转池</h1>
          <p className="text-sm text-muted-foreground">管理客户分配、收回，以及待运营和休眠客户</p>
        </div>
        <Button variant="outline" className="h-9" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
          <Layers className="h-4 w-4 mr-1" />
          {scanMutation.isPending ? "扫描中..." : "扫描生命周期"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索客户名称、编号、单位..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        {isMobile ? (
          <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
            <SheetTrigger render={<Button variant="outline" size="sm"><Filter className="h-4 w-4 mr-1" />筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</Button>} />
            <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <SheetHeader><SheetTitle>筛选条件</SheetTitle></SheetHeader>
              <div className="mt-4 max-w-full overflow-x-hidden">{FilterControls}</div>
            </SheetContent>
          </Sheet>
        ) : (
          <div className="flex gap-2 flex-wrap items-center">
            <Select value={assignmentStatus} onValueChange={(v) => { setAssignmentStatus(v || ""); setPage(1); }}>
              <SelectTrigger className="w-[100px] h-9 text-xs"><span>{assignmentStatus ? ASSIGNMENT_STATUS_LABELS[assignmentStatus] : "待处理"}</span></SelectTrigger>
              <SelectContent>
                <SelectItem value="">待处理</SelectItem>
                {CRM_ASSIGNMENT_STATUS.map((s) => (<SelectItem key={s} value={s}>{ASSIGNMENT_STATUS_LABELS[s]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={stage} onValueChange={(v) => { setStage(v || "ALL"); setPage(1); }}>
              <SelectTrigger className="w-[90px] h-9 text-xs"><SelectDisplay label="阶段" valueLabel={stage === "ALL" ? "全部" : STAGE_LABELS[stage] || "?"} placeholder="阶段" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部</SelectItem>
                {CRM_STAGES.map((s) => (<SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={personCategory} onValueChange={(v) => { setPersonCategory(v || "ALL"); setPage(1); }}>
              <SelectTrigger className="w-[90px] h-9 text-xs"><SelectDisplay label="分类" valueLabel={personCategory === "ALL" ? "全部" : PERSON_CATEGORY_LABELS[personCategory] || "?"} placeholder="分类" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部</SelectItem>
                {CRM_PERSON_CATEGORIES.map((pc) => (<SelectItem key={pc} value={pc}>{PERSON_CATEGORY_LABELS[pc]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={organizationId || "__all__"} onValueChange={(v) => { setOrganizationId(v === "__all__" ? "" : (v || "")); setSiteId(""); setPage(1); }}>
              <SelectTrigger className="w-[110px] h-9 text-xs"><span>{organizationId ? (uniqueOrgs.find((o) => o.organizationId === organizationId)?.organization?.slice(0, 8) || organizationId) : "单位"}</span></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部单位</SelectItem>
                {uniqueOrgs.slice(0, 50).map((o) => (
                  <SelectItem key={o.organizationId} value={o.organizationId!}>{o.organization}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={graduationStatus} onValueChange={(v) => { setGraduationStatus(v || "ALL"); setPage(1); }}>
              <SelectTrigger className="w-[90px] h-9 text-xs"><SelectDisplay label="毕业" valueLabel={graduationStatus === "ALL" ? "全部" : GRADUATION_STATUS_LABELS[graduationStatus] || "?"} placeholder="毕业" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部</SelectItem>
                {CRM_GRADUATION_STATUSES.map((gs) => (<SelectItem key={gs} value={gs}>{GRADUATION_STATUS_LABELS[gs]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => { setSort(v || "updatedAt"); setPage(1); }}>
              <SelectTrigger className="w-[90px] h-9 text-xs"><span>{sort === "updatedAt" ? "最近更新" : sort === "createdAt" ? "创建时间" : "排序"}</span></SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedAt">最近更新</SelectItem>
                <SelectItem value="createdAt">创建时间</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setOrder(order === "asc" ? "desc" : "asc")} className="h-9 text-xs">{order === "asc" ? "↑" : "↓"}</Button>
            {activeFilterCount > 0 && <Button variant="ghost" size="sm" onClick={clearAllFilters}><X className="h-4 w-4" /></Button>}
          </div>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="flex gap-1 flex-wrap">
          {assignmentStatus && <Badge variant="secondary" className="text-xs">状态: {ASSIGNMENT_STATUS_LABELS[assignmentStatus]}</Badge>}
          {stage !== "ALL" && <Badge variant="secondary" className="text-xs">阶段: {STAGE_LABELS[stage]}</Badge>}
          {personCategory !== "ALL" && <Badge variant="secondary" className="text-xs">分类: {PERSON_CATEGORY_LABELS[personCategory]}</Badge>}
          {graduationStatus !== "ALL" && <Badge variant="secondary" className="text-xs">毕业: {GRADUATION_STATUS_LABELS[graduationStatus]}</Badge>}
          {organizationId && <Badge variant="secondary" className="text-xs">单位: {uniqueOrgs.find((o) => o.organizationId === organizationId)?.organization || organizationId}</Badge>}
          {siteId && <Badge variant="secondary" className="text-xs">院区: {orgSites.find((s) => s.id === siteId)?.siteName || siteId}</Badge>}
          {jobTitleFilter && <Badge variant="secondary" className="text-xs">职务: {jobTitleFilter}</Badge>}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : profiles.length === 0 ? (
        <CrmEmptyState icon={Users} title="暂无待处理客户" />
      ) : isMobile ? (
        <div className="space-y-3">
          {profiles.map((p) => (
            <Card key={p.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/crm/customers/${p.sourceCustomerId}`}
                      className="block truncate text-base font-medium text-primary hover:underline"
                    >
                      {p.sourceCustomer.name}
                    </Link>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {p.sourceCustomer.customerCode}
                      {p.sourceCustomer.organization ? ` · ${p.sourceCustomer.organization}` : ""}
                    </div>
                  </div>
                  <StageBadge stage={p.stage} />
                </div>
                {p.sourceCustomer.labOrGroup && (
                  <div className="mt-1 truncate text-xs text-muted-foreground">{p.sourceCustomer.labOrGroup}</div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <PersonCategoryBadge category={p.personCategory} />
                  <AssignmentStatusBadge status={p.assignmentStatus} />
                  <span className="text-xs text-muted-foreground">{p.ownerUser.name}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <AssignButton profileId={p.id} currentOwner={p.ownerUser.name} />
                  {(p.assignmentStatus === "ASSIGNED" || p.assignmentStatus === "RECALL_CANDIDATE") && (
                    <RecallButton profileId={p.id} currentOwner={p.ownerUser.name} />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">客户</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">单位</th>
                <th className="text-left p-3 font-medium">阶段</th>
                <th className="text-left p-3 font-medium">分配状态</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">负责人</th>
                <th className="text-left p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Link href={`/crm/customers/${p.sourceCustomerId}`} className="text-primary hover:underline font-medium">
                      {p.sourceCustomer.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{p.sourceCustomer.customerCode}</div>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{p.sourceCustomer.organization || "-"}</td>
                  <td className="p-3"><StageBadge stage={p.stage} /></td>
                  <td className="p-3"><AssignmentStatusBadge status={p.assignmentStatus} /></td>
                  <td className="p-3 hidden lg:table-cell">{p.ownerUser.name}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <AssignButton profileId={p.id} currentOwner={p.ownerUser.name} />
                      {(p.assignmentStatus === "ASSIGNED" || p.assignmentStatus === "RECALL_CANDIDATE") && (
                        <RecallButton profileId={p.id} currentOwner={p.ownerUser.name} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}
    </div>
  );
}

function AssignButton({ profileId, currentOwner }: { profileId: string; currentOwner: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const queryClient = useQueryClient();

  const { data: repsData } = useQuery<{ representatives: { id: string; name: string; email: string; archived: boolean }[] }>({
    queryKey: ["admin-representatives"],
    queryFn: () => fetch("/api/representatives/list").then((r) => r.json()),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/customer-pool/${profileId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ representativeId: selected }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "分配失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("客户已分配");
      queryClient.invalidateQueries({ queryKey: ["crm-customer-pool"] });
      queryClient.invalidateQueries({ queryKey: crmKeys.profiles() });
      queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() });
      setOpen(false);
      setSelected("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reps = repsData?.representatives.filter((r) => !r.archived) || [];

  return (
    <>
      <Button variant="outline" className="h-8" onClick={() => setOpen(true)}>
        <UserCog className="h-4 w-4 mr-1" />分配
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>分配客户给代表</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">当前: {currentOwner}</p>
          <Select value={selected} onValueChange={(v) => setSelected(v || "")}>
            <SelectTrigger>
              {selected
                ? <span>{reps.find((a) => a.id === selected)?.name || selected}</span>
                : <span className="text-muted-foreground">选择代表</span>}
            </SelectTrigger>
            <SelectContent>
              {reps.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name} ({r.email})</SelectItem>
              ))}
              {reps.length === 0 && <div className="p-2 text-sm text-muted-foreground">暂无代表</div>}
            </SelectContent>
          </Select>
          <Button onClick={() => mutation.mutate()} disabled={!selected || mutation.isPending} className="w-full">
            {mutation.isPending ? "分配中..." : "确认分配"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecallButton({ profileId, currentOwner }: { profileId: string; currentOwner: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/customer-pool/${profileId}/recall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "收回失败");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("客户已收回");
      queryClient.invalidateQueries({ queryKey: ["crm-customer-pool"] });
      queryClient.invalidateQueries({ queryKey: crmKeys.profiles() });
      queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" className="h-8"><Undo2 className="h-4 w-4 mr-1" />收回</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>收回客户</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">将客户从 {currentOwner} 处收回</p>
        <Input placeholder="收回原因（可选）" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full" variant="destructive">
          {mutation.isPending ? "收回中..." : "确认收回"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
