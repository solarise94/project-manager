"use client";

import { Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StageBadge, ImportanceBadge, AssignmentStatusBadge, PersonCategoryBadge, GraduationStatusBadge } from "@/components/crm/badges";
import { ActivateProfileDialog } from "@/components/crm/activate-profile-dialog";
import { CustomerApplicationFormDialog } from "@/components/crm/customer-application-form-dialog";
import { CRM_STAGES, STAGE_LABELS, CRM_IMPORTANCE, IMPORTANCE_LABELS, CRM_PERSON_CATEGORIES, PERSON_CATEGORY_LABELS, CRM_GRADUATION_STATUSES, GRADUATION_STATUS_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmCustomerProfileItem } from "@/lib/crm/types";
import { toast } from "sonner";
import Link from "next/link";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Search, UserCog, Filter, X, Users } from "lucide-react";
import { CrmEmptyState } from "@/components/crm/empty-state";

export default function CrmCustomersPage() {
  return (
    <Suspense fallback={<div className="p-6">加载中...</div>}>
      <CrmCustomersWrapper />
    </Suspense>
  );
}

function CrmCustomersWrapper() {
  const { status } = useSession();
  const router = useRouter();
  const sp = useSearchParams();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <CustomerPool initialSearch={sp.get("search") || ""} initialOrganizationId={sp.get("organizationId") || ""} initialOrganizationName={sp.get("organizationName") || ""} initialAssignee={sp.get("assignee") || ""} initialStage={sp.get("stage") || ""} initialSiteId={sp.get("siteId") || ""} />;
}

function CustomerPool({ initialSearch, initialOrganizationId, initialOrganizationName, initialAssignee, initialStage, initialSiteId }: { initialSearch: string; initialOrganizationId: string; initialOrganizationName: string; initialAssignee: string; initialStage: string; initialSiteId: string }) {
  const { data: session } = useSession();
  const [search, setSearch] = useState(initialSearch);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [organizationName, setOrganizationName] = useState(initialOrganizationName);
  const [siteId, setSiteId] = useState(initialSiteId);
  const [stage, setStage] = useState(initialStage || "ALL");
  const [importance, setImportance] = useState("ALL");
  const [personCategory, setPersonCategory] = useState("ALL");
  const [graduationStatus, setGraduationStatus] = useState("ALL");
  const [jobTitle, setJobTitle] = useState("");
  const [sort, setSort] = useState("updatedAt");
  const [order, setOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [assignee, setAssignee] = useState(initialAssignee || "ALL");

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (organizationId) params.set("organizationId", organizationId);
  if (siteId) params.set("siteId", siteId);
  if (stage !== "ALL") params.set("stage", stage);
  if (importance !== "ALL") params.set("importance", importance);
  if (personCategory !== "ALL") params.set("personCategory", personCategory);
  if (graduationStatus !== "ALL") params.set("graduationStatus", graduationStatus);
  if (jobTitle) params.set("jobTitle", jobTitle);
  if (assignee !== "ALL") params.set("assignee", assignee);
  params.set("sort", sort);
  params.set("order", order);
  params.set("page", String(page));
  params.set("pageSize", "20");

  const { data, isLoading } = useQuery<{ profiles: CrmCustomerProfileItem[]; total: number; page: number; pageSize: number; totalPages: number }>({
    queryKey: ["crm-profiles", search, organizationId, siteId, stage, importance, personCategory, graduationStatus, jobTitle, assignee, sort, order, page],
    queryFn: () => fetch(`/api/crm/profiles?${params}`).then((r) => r.json()),
  });

  const { data: assigneesData } = useQuery<{ assignees: AssigneeOption[] }>({
    queryKey: ["crm-assignees"],
    queryFn: () => fetch("/api/crm/assignees").then((r) => r.json()),
  });

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

  const { data: siteMetaData } = useQuery<{
    site: { id: string; siteName: string; siteType: string; organizationId: string; organizationName: string } | null;
  }>({
    queryKey: ["organization-site-meta", siteId],
    queryFn: () => fetch(`/api/organization-sites/${siteId}`).then((r) => r.json()),
    enabled: !!siteId && !organizationId,
  });
  const siteMeta = siteMetaData?.site;

  const backfilledRef = useRef(false);
  useEffect(() => {
    if (siteMeta && !organizationId && !backfilledRef.current) {
      backfilledRef.current = true;
      setOrganizationId(siteMeta.organizationId);
      setOrganizationName(siteMeta.organizationName);
    }
  }, [siteMeta, organizationId]);

  const siteDisplayName = siteMeta?.siteName || orgSites.find((s) => s.id === siteId)?.siteName || siteId;

  const profiles = data?.profiles || [];
  const isRep = session?.user?.role === "REPRESENTATIVE";
  const isMobile = useMediaQuery("(max-width: 767px)");

  const activeFilterCount = [stage, importance, personCategory, graduationStatus, assignee].filter((v) => v !== "ALL").length + (jobTitle ? 1 : 0) + (organizationId ? 1 : 0) + (siteId ? 1 : 0);

  function clearAllFilters() {
    setStage("ALL");
    setImportance("ALL");
    setPersonCategory("ALL");
    setGraduationStatus("ALL");
    setJobTitle("");
    setAssignee("ALL");
    setOrganizationId("");
    setOrganizationName("");
    setSiteId("");
    setSort("updatedAt");
    setOrder("desc");
    setPage(1);
  }

  const FilterControls = (
    <div className="space-y-4 max-w-full overflow-x-hidden">
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">阶段</label>
        <Select value={stage} onValueChange={(v) => { setStage(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectDisplay label="阶段" valueLabel={stage === "ALL" ? "全部阶段" : STAGE_LABELS[stage] || "未知"} placeholder="阶段" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部阶段</SelectItem>
            {CRM_STAGES.map((s) => (
              <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">重要度</label>
        <Select value={importance} onValueChange={(v) => { setImportance(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectDisplay label="重要度" valueLabel={importance === "ALL" ? "全部重要度" : IMPORTANCE_LABELS[importance] || "未知"} placeholder="重要度" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部重要度</SelectItem>
            {CRM_IMPORTANCE.map((i) => (
              <SelectItem key={i} value={i}>{IMPORTANCE_LABELS[i]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">人员分类</label>
        <Select value={personCategory} onValueChange={(v) => { setPersonCategory(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectDisplay label="分类" valueLabel={personCategory === "ALL" ? "全部分类" : PERSON_CATEGORY_LABELS[personCategory] || "未知"} placeholder="全部分类" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部分类</SelectItem>
            {CRM_PERSON_CATEGORIES.map((pc) => (
              <SelectItem key={pc} value={pc}>{PERSON_CATEGORY_LABELS[pc]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">毕业状态</label>
        <Select value={graduationStatus} onValueChange={(v) => { setGraduationStatus(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectDisplay label="毕业" valueLabel={graduationStatus === "ALL" ? "全部状态" : GRADUATION_STATUS_LABELS[graduationStatus] || "未知"} placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            {CRM_GRADUATION_STATUSES.map((gs) => (
              <SelectItem key={gs} value={gs}>{GRADUATION_STATUS_LABELS[gs]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">单位</label>
        <Select value={organizationId || "__all__"} onValueChange={(v) => { const id = v === "__all__" ? "" : (v || ""); setOrganizationId(id); setOrganizationName(""); setSiteId(""); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0 h-8 text-xs"><span className="block truncate">{organizationId ? (uniqueOrgs.find((o) => o.organizationId === organizationId)?.organization?.slice(0, 12) || organizationId) : "全部单位"}</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部单位</SelectItem>
            {uniqueOrgs.slice(0, 50).map((o) => (
              <SelectItem key={o.organizationId} value={o.organizationId!}>{o.organization}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {organizationId && (orgSites.length > 0 || siteMeta) && (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground font-medium">院区</label>
          <Select value={siteId || "__all__"} onValueChange={(v) => { setSiteId(v === "__all__" ? "" : (v || "")); setPage(1); }}>
            <SelectTrigger className="w-full min-w-0 h-8 text-xs"><span className="block truncate">{siteId ? siteDisplayName : "全部院区"}</span></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部院区</SelectItem>
              {orgSites.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.siteName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">负责人</label>
        <Select value={assignee} onValueChange={(v) => { setAssignee(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectDisplay label="负责人" valueLabel={assignee === "ALL" ? "全部" : assignee === "UNASSIGNED" ? "未指派" : (assigneesData?.assignees || []).find((a) => a.userId === assignee)?.name || assignee} placeholder="全部" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部</SelectItem>
            <SelectItem value="UNASSIGNED">未指派</SelectItem>
            {(assigneesData?.assignees || []).map((a) => (
              <SelectItem key={a.userId} value={a.userId}>{a.name}{a.kind === "representative" ? " (代表)" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground font-medium">排序</label>
        <Select value={sort} onValueChange={(v) => { setSort(v || "updatedAt"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0 h-8 text-xs"><span>{sort === "updatedAt" ? "最近更新" : sort === "createdAt" ? "创建时间" : sort === "lastFollowUpAt" ? "最近跟进" : sort === "nextFollowUpAt" ? "下次跟进" : sort === "stage" ? "阶段" : "默认"}</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="updatedAt">最近更新</SelectItem>
            <SelectItem value="createdAt">创建时间</SelectItem>
            <SelectItem value="lastFollowUpAt">最近跟进</SelectItem>
            <SelectItem value="nextFollowUpAt">下次跟进</SelectItem>
            <SelectItem value="stage">阶段</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOrder(order === "asc" ? "desc" : "asc")} className="h-7 text-xs">
          {order === "asc" ? "↑ 升序" : "↓ 降序"}
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-7 text-xs"><X className="h-3 w-3 mr-1" />清空</Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-4 pb-20 max-w-full overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">客户档案库</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <CustomerApplicationFormDialog />
          {!isRep && <ActivateProfileDialog />}
        </div>
      </div>

      {/* Search bar */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索客户名称、编号、单位..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        {isMobile && (
          <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
            <SheetTrigger render={<Button variant="outline" size="sm"><Filter className="h-4 w-4 mr-1" />筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</Button>} />
            <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <SheetHeader><SheetTitle>筛选条件</SheetTitle></SheetHeader>
              <div className="mt-4 max-w-full overflow-x-hidden">{FilterControls}</div>
            </SheetContent>
          </Sheet>
        )}
        {!isMobile && (
          <div className="flex gap-1.5 items-center flex-wrap">
            <Select value={organizationId || "__all__"} onValueChange={(v) => { setOrganizationId(v === "__all__" ? "" : (v || "")); setOrganizationName(""); setSiteId(""); setPage(1); }}>
              <SelectTrigger className="w-[110px] h-9 text-xs"><span>{organizationId ? (uniqueOrgs.find((o) => o.organizationId === organizationId)?.organization?.slice(0, 8) || organizationId) : "单位"}</span></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部单位</SelectItem>
                {uniqueOrgs.slice(0, 50).map((o) => (
                  <SelectItem key={o.organizationId} value={o.organizationId!}>{o.organization}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {organizationId && orgSites.length > 0 && (
              <Select value={siteId || "__all__"} onValueChange={(v) => { setSiteId(v === "__all__" ? "" : (v || "")); setPage(1); }}>
                <SelectTrigger className="w-[110px] h-9 text-xs"><span>{siteId ? (orgSites.find((s) => s.id === siteId)?.siteName || siteId) : "院区"}</span></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部院区</SelectItem>
                  {orgSites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.siteName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={graduationStatus} onValueChange={(v) => { setGraduationStatus(v || "ALL"); setPage(1); }}>
              <SelectTrigger className="w-[90px] h-9 text-xs"><SelectDisplay label="毕业" valueLabel={graduationStatus === "ALL" ? "全部" : GRADUATION_STATUS_LABELS[graduationStatus] || "?"} placeholder="毕业" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部</SelectItem>
                {CRM_GRADUATION_STATUSES.map((gs) => (<SelectItem key={gs} value={gs}>{GRADUATION_STATUS_LABELS[gs]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => { setSort(v || "updatedAt"); setPage(1); }}>
              <SelectTrigger className="w-[100px] h-9 text-xs"><span>{sort === "updatedAt" ? "最近更新" : sort === "createdAt" ? "创建时间" : sort === "lastFollowUpAt" ? "最近跟进" : sort === "stage" ? "阶段" : "排序"}</span></SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedAt">最近更新</SelectItem>
                <SelectItem value="createdAt">创建时间</SelectItem>
                <SelectItem value="lastFollowUpAt">最近跟进</SelectItem>
                <SelectItem value="nextFollowUpAt">下次跟进</SelectItem>
                <SelectItem value="stage">阶段</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setOrder(order === "asc" ? "desc" : "asc")} className="h-9 text-xs">{order === "asc" ? "↑" : "↓"}</Button>
          </div>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="flex gap-1 flex-wrap">
          {stage !== "ALL" && <Badge variant="secondary" className="text-xs">阶段: {STAGE_LABELS[stage]}</Badge>}
          {importance !== "ALL" && <Badge variant="secondary" className="text-xs">重要度: {IMPORTANCE_LABELS[importance]}</Badge>}
          {personCategory !== "ALL" && <Badge variant="secondary" className="text-xs">分类: {PERSON_CATEGORY_LABELS[personCategory]}</Badge>}
          {graduationStatus !== "ALL" && <Badge variant="secondary" className="text-xs">毕业: {GRADUATION_STATUS_LABELS[graduationStatus]}</Badge>}
          {assignee !== "ALL" && <Badge variant="secondary" className="text-xs">负责人: {assignee === "UNASSIGNED" ? "未指派" : (assigneesData?.assignees || []).find((a) => a.userId === assignee)?.name || assignee}</Badge>}
          {jobTitle && <Badge variant="secondary" className="text-xs">职务: {jobTitle}</Badge>}
          {organizationId && (
            <Badge variant="secondary" className="text-xs gap-1">
              机构: {organizationName || organizationId}
              <button type="button" className="hover:text-red-500" onClick={() => { setOrganizationId(""); setOrganizationName(""); setSiteId(""); setPage(1); }}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {siteId && (
            <Badge variant="secondary" className="text-xs gap-1">
              院区: {siteDisplayName}
              <button type="button" className="hover:text-red-500" onClick={() => { setSiteId(""); setPage(1); }}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>
      )}

      <div className="flex gap-5">
        {/* Desktop sidebar */}
        {!isMobile && (
          <div className="w-52 shrink-0 hidden md:block">
            <div className="sticky top-4 space-y-4">
              {FilterControls}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : profiles.length === 0 ? (
            <CrmEmptyState icon={Users} title="暂无 CRM 客户档案" />
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
                  <ImportanceBadge importance={p.importance} />
                  <PersonCategoryBadge category={p.personCategory} />
                  <GraduationStatusBadge status={p.graduationStatus || null} />
                  <AssignmentStatusBadge status={p.assignmentStatus} />
                  <span className="text-xs text-muted-foreground">{p.assignmentStatus === "ASSIGNED" ? p.ownerUser.name : "未指派"}</span>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  {p.nextFollowUpAt ? (
                    <span>下次跟进: {new Date(p.nextFollowUpAt).toLocaleDateString("zh-CN")}</span>
                  ) : (
                    <span>暂无跟进计划</span>
                  )}
                  <span className="ml-auto">{p._count?.interactions ?? 0} 沟通 · {p._count?.visitCheckins ?? 0} 签到</span>
                </div>
                {!isRep && (
                  <div className="flex gap-2 mt-3">
                    <AssignButton profileId={p.id} currentOwner={p.ownerUser.name} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium">客户</th>
                <th className="text-left p-2 font-medium hidden md:table-cell">单位/课题组</th>
                <th className="text-left p-2 font-medium hidden lg:table-cell">院区</th>
                <th className="text-left p-2 font-medium">阶段</th>
                <th className="text-left p-2 font-medium hidden sm:table-cell">重要度</th>
                <th className="text-left p-2 font-medium hidden lg:table-cell">分类</th>
                <th className="text-left p-2 font-medium hidden lg:table-cell">毕业状态</th>
                <th className="text-center p-2 font-medium hidden lg:table-cell">沟通</th>
                <th className="text-center p-2 font-medium hidden lg:table-cell">签到</th>
                <th className="text-left p-2 font-medium hidden xl:table-cell">最近跟进</th>
                <th className="text-left p-2 font-medium hidden xl:table-cell">下次跟进</th>
                <th className="text-left p-2 font-medium hidden md:table-cell">负责人</th>
                {!isRep && <th className="text-left p-2 font-medium w-14">操作</th>}
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/30">
                  <td className="p-2">
                    <Link href={`/crm/customers/${p.sourceCustomerId}`} className="text-primary hover:underline font-medium text-sm">
                      {p.sourceCustomer.name}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">{p.sourceCustomer.customerCode}</div>
                  </td>
                  <td className="p-2 hidden md:table-cell text-muted-foreground">
                    <div className="text-sm">{p.sourceCustomer.organization || "-"}</div>
                    {p.sourceCustomer.labOrGroup && <div className="text-xs">{p.sourceCustomer.labOrGroup}</div>}
                  </td>
                  <td className="p-2 hidden lg:table-cell text-muted-foreground text-sm">
                    {p.sourceCustomer.orgSite?.siteName || "-"}
                  </td>
                  <td className="p-2"><StageBadge stage={p.stage} /></td>
                  <td className="p-2 hidden sm:table-cell"><ImportanceBadge importance={p.importance} /></td>
                  <td className="p-2 hidden lg:table-cell"><PersonCategoryBadge category={p.personCategory} /></td>
                  <td className="p-2 hidden lg:table-cell"><GraduationStatusBadge status={p.graduationStatus || null} /></td>
                  <td className="p-2 text-center text-sm hidden lg:table-cell">{p._count?.interactions ?? 0}</td>
                  <td className="p-2 text-center text-sm hidden lg:table-cell">{p._count?.visitCheckins ?? 0}</td>
                  <td className="p-2 text-sm text-muted-foreground hidden xl:table-cell">{p.lastFollowUpAt ? new Date(p.lastFollowUpAt).toLocaleDateString("zh-CN") : "—"}</td>
                  <td className="p-2 text-sm hidden xl:table-cell">{p.nextFollowUpAt ? <span className={new Date(p.nextFollowUpAt) < new Date() ? "text-red-500" : ""}>{new Date(p.nextFollowUpAt).toLocaleDateString("zh-CN")}</span> : "—"}</td>
                  <td className="p-2 hidden md:table-cell">
                    {p.assignmentStatus === "ASSIGNED" ? (
                      <span className="text-sm">{p.ownerUser.name}</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </td>
                  {!isRep && (
                    <td className="p-2">
                      <AssignButton profileId={p.id} currentOwner={p.ownerUser.name} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

          {data?.totalPages && data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
              <span className="text-sm text-muted-foreground">{page} / {data.totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface AssigneeOption {
  userId: string;
  name: string;
  kind: "self" | "representative";
}

function AssignButton({ profileId, currentOwner }: { profileId: string; currentOwner: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const queryClient = useQueryClient();

  const { data: assigneesData } = useQuery<{ assignees: AssigneeOption[] }>({
    queryKey: ["crm-assignees"],
    queryFn: () => fetch("/api/crm/assignees").then((r) => r.json()),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUserId: selected }),
      });
      if (!res.ok) throw new Error("指派失败");
      return res.json();
    },
    onSuccess: async (data: { profile?: { sourceCustomer?: { id?: string } } }) => {
      toast.success("负责人已更新");
      const scId = data.profile?.sourceCustomer?.id;
      const promises: Promise<void>[] = [
        queryClient.invalidateQueries({ queryKey: crmKeys.profiles() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
      ];
      if (scId) {
        promises.push(queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(scId) }));
      }
      await Promise.all(promises);
      setOpen(false);
      setSelected("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const assignees = assigneesData?.assignees || [];

  return (
    <>
      <Button variant="outline" className="h-8" onClick={() => setOpen(true)}>
        <UserCog className="h-4 w-4 mr-1" />指派
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>指派负责人</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">当前: {currentOwner}</p>
          <Select value={selected} onValueChange={(v) => setSelected(v || "")}>
            <SelectTrigger>
              {selected
                ? <span>{assignees.find((a) => a.userId === selected)?.name || selected}</span>
                : <span className="text-muted-foreground">选择负责人</span>}
            </SelectTrigger>
            <SelectContent>
              {assignees.map((a) => (
                <SelectItem key={a.userId} value={a.userId}>
                  {a.name}{a.kind === "representative" ? " (代表)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => mutation.mutate()} disabled={!selected || mutation.isPending} className="w-full">
            {mutation.isPending ? "保存中..." : "确认指派"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
