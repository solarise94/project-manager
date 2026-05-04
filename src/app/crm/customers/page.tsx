"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StageBadge, ImportanceBadge, AssignmentStatusBadge, PersonCategoryBadge, GraduationStatusBadge } from "@/components/crm/badges";
import { ActivateProfileDialog } from "@/components/crm/activate-profile-dialog";
import { CustomerApplicationFormDialog } from "@/components/crm/customer-application-form-dialog";
import { CRM_STAGES, STAGE_LABELS, CRM_IMPORTANCE, IMPORTANCE_LABELS, CRM_PERSON_CATEGORIES, PERSON_CATEGORY_LABELS, CRM_GRADUATION_STATUSES, GRADUATION_STATUS_LABELS, CRM_SITE_TYPES, SITE_TYPE_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmCustomerProfileItem } from "@/lib/crm/types";
import { toast } from "sonner";
import Link from "next/link";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Search, UserCog, Filter, X } from "lucide-react";

export default function CrmCustomersPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <CustomerPool />;
}

function CustomerPool() {
  const { data: session } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("ALL");
  const [importance, setImportance] = useState("ALL");
  const [personCategory, setPersonCategory] = useState("ALL");
  const [graduationStatus, setGraduationStatus] = useState("ALL");
  const [siteType, setSiteType] = useState("ALL");
  const [jobTitle, setJobTitle] = useState("");
  const [sort, setSort] = useState("updatedAt");
  const [order, setOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (stage !== "ALL") params.set("stage", stage);
  if (importance !== "ALL") params.set("importance", importance);
  if (personCategory !== "ALL") params.set("personCategory", personCategory);
  if (graduationStatus !== "ALL") params.set("graduationStatus", graduationStatus);
  if (siteType !== "ALL") params.set("siteType", siteType);
  if (jobTitle) params.set("jobTitle", jobTitle);
  params.set("sort", sort);
  params.set("order", order);
  params.set("page", String(page));
  params.set("pageSize", "20");

  const { data, isLoading } = useQuery<{ profiles: CrmCustomerProfileItem[]; total: number; page: number; pageSize: number; totalPages: number }>({
    queryKey: ["crm-profiles", search, stage, importance, personCategory, graduationStatus, siteType, jobTitle, sort, order, page],
    queryFn: () => fetch(`/api/crm/profiles?${params}`).then((r) => r.json()),
  });

  const profiles = data?.profiles || [];
  const isRep = session?.user?.role === "REPRESENTATIVE";
  const isMobile = useMediaQuery("(max-width: 767px)");

  const activeFilterCount = [stage, importance, personCategory, graduationStatus, siteType].filter((v) => v !== "ALL").length + (jobTitle ? 1 : 0);

  function clearAllFilters() {
    setStage("ALL");
    setImportance("ALL");
    setPersonCategory("ALL");
    setGraduationStatus("ALL");
    setSiteType("ALL");
    setJobTitle("");
    setSort("updatedAt");
    setOrder("desc");
  }

  function handleCardClick(e: React.MouseEvent, href: string) {
    e.preventDefault();
    router.push(href);
  }

  const FilterControls = (
    <div className="space-y-4 max-w-full overflow-x-hidden">
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">阶段</label>
        <Select value={stage} onValueChange={(v) => { setStage(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><SelectDisplay label="阶段" valueLabel={stage === "ALL" ? "全部阶段" : STAGE_LABELS[stage] || "未知"} placeholder="阶段" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部阶段</SelectItem>
            {CRM_STAGES.map((s) => (
              <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">重要度</label>
        <Select value={importance} onValueChange={(v) => { setImportance(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><SelectDisplay label="重要度" valueLabel={importance === "ALL" ? "全部重要度" : IMPORTANCE_LABELS[importance] || "未知"} placeholder="重要度" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部重要度</SelectItem>
            {CRM_IMPORTANCE.map((i) => (
              <SelectItem key={i} value={i}>{IMPORTANCE_LABELS[i]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">人员分类</label>
        <Select value={personCategory} onValueChange={(v) => { setPersonCategory(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><SelectDisplay label="分类" valueLabel={personCategory === "ALL" ? "全部分类" : PERSON_CATEGORY_LABELS[personCategory] || "未知"} placeholder="全部分类" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部分类</SelectItem>
            {CRM_PERSON_CATEGORIES.map((pc) => (
              <SelectItem key={pc} value={pc}>{PERSON_CATEGORY_LABELS[pc]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">毕业状态</label>
        <Select value={graduationStatus} onValueChange={(v) => { setGraduationStatus(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><SelectDisplay label="毕业" valueLabel={graduationStatus === "ALL" ? "全部状态" : GRADUATION_STATUS_LABELS[graduationStatus] || "未知"} placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            {CRM_GRADUATION_STATUSES.map((gs) => (
              <SelectItem key={gs} value={gs}>{GRADUATION_STATUS_LABELS[gs]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">院区/学院/大楼</label>
        <Select value={siteType} onValueChange={(v) => { setSiteType(v || "ALL"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><SelectDisplay label="类型" valueLabel={siteType === "ALL" ? "全部类型" : SITE_TYPE_LABELS[siteType] || "未知"} placeholder="全部类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部类型</SelectItem>
            {CRM_SITE_TYPES.map((st) => (
              <SelectItem key={st} value={st}>{SITE_TYPE_LABELS[st]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">排序</label>
        <Select value={sort} onValueChange={(v) => { setSort(v || "updatedAt"); setPage(1); }}>
          <SelectTrigger className="w-full min-w-0"><span>{sort === "updatedAt" ? "最近更新" : sort === "createdAt" ? "创建时间" : sort === "lastFollowUpAt" ? "最近跟进" : sort === "nextFollowUpAt" ? "下次跟进" : sort === "stage" ? "阶段" : "默认"}</span></SelectTrigger>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">CRM 客户池</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <CustomerApplicationFormDialog />
          {!isRep && <ActivateProfileDialog />}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索客户名称、编号、单位..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
            <Select value={stage} onValueChange={(v) => { setStage(v || "ALL"); setPage(1); }}>
              <SelectTrigger className="w-[110px] h-9 text-xs"><SelectDisplay label="阶段" valueLabel={stage === "ALL" ? "全部阶段" : STAGE_LABELS[stage] || "未知"} placeholder="阶段" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部阶段</SelectItem>
                {CRM_STAGES.map((s) => (<SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={importance} onValueChange={(v) => { setImportance(v || "ALL"); setPage(1); }}>
              <SelectTrigger className="w-[110px] h-9 text-xs"><SelectDisplay label="重要度" valueLabel={importance === "ALL" ? "全部" : IMPORTANCE_LABELS[importance] || "未知"} placeholder="重要度" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部</SelectItem>
                {CRM_IMPORTANCE.map((i) => (<SelectItem key={i} value={i}>{IMPORTANCE_LABELS[i]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={personCategory} onValueChange={(v) => { setPersonCategory(v || "ALL"); setPage(1); }}>
              <SelectTrigger className="w-[110px] h-9 text-xs"><SelectDisplay label="分类" valueLabel={personCategory === "ALL" ? "全部分类" : PERSON_CATEGORY_LABELS[personCategory] || "未知"} placeholder="分类" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部分类</SelectItem>
                {CRM_PERSON_CATEGORIES.map((pc) => (<SelectItem key={pc} value={pc}>{PERSON_CATEGORY_LABELS[pc]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={graduationStatus} onValueChange={(v) => { setGraduationStatus(v || "ALL"); setPage(1); }}>
              <SelectTrigger className="w-[110px] h-9 text-xs"><SelectDisplay label="毕业" valueLabel={graduationStatus === "ALL" ? "全部" : GRADUATION_STATUS_LABELS[graduationStatus] || "未知"} placeholder="毕业" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部</SelectItem>
                {CRM_GRADUATION_STATUSES.map((gs) => (<SelectItem key={gs} value={gs}>{GRADUATION_STATUS_LABELS[gs]}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => { setSort(v || "updatedAt"); setPage(1); }}>
              <SelectTrigger className="w-[100px] h-9 text-xs"><span>{sort === "updatedAt" ? "最近更新" : sort === "createdAt" ? "创建时间" : "排序"}</span></SelectTrigger>
              <SelectContent>
                <SelectItem value="updatedAt">最近更新</SelectItem>
                <SelectItem value="createdAt">创建时间</SelectItem>
                <SelectItem value="lastFollowUpAt">最近跟进</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setOrder(order === "asc" ? "desc" : "asc")} className="h-9 text-xs">{order === "asc" ? "↑" : "↓"}</Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters}><X className="h-4 w-4" /></Button>
            )}
          </div>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="flex gap-1 flex-wrap">
          {stage !== "ALL" && <Badge variant="secondary" className="text-xs">阶段: {STAGE_LABELS[stage]}</Badge>}
          {importance !== "ALL" && <Badge variant="secondary" className="text-xs">重要度: {IMPORTANCE_LABELS[importance]}</Badge>}
          {personCategory !== "ALL" && <Badge variant="secondary" className="text-xs">分类: {PERSON_CATEGORY_LABELS[personCategory]}</Badge>}
          {graduationStatus !== "ALL" && <Badge variant="secondary" className="text-xs">毕业: {GRADUATION_STATUS_LABELS[graduationStatus]}</Badge>}
          {siteType !== "ALL" && <Badge variant="secondary" className="text-xs">院区: {SITE_TYPE_LABELS[siteType]}</Badge>}
          {jobTitle && <Badge variant="secondary" className="text-xs">职务: {jobTitle}</Badge>}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : profiles.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">暂无 CRM 客户档案</div>
      ) : isMobile ? (
        <div className="space-y-3">
          {profiles.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={(e) => handleCardClick(e, `/crm/customers/${p.sourceCustomerId}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-medium">{p.sourceCustomer.name}</div>
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
                  <span className="text-xs text-muted-foreground">{p.ownerUser.name}</span>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  {p.nextFollowUpAt ? (
                    <span>下次跟进: {new Date(p.nextFollowUpAt).toLocaleDateString("zh-CN")}</span>
                  ) : (
                    <span>暂无跟进计划</span>
                  )}
                </div>
                {!isRep && (
                  <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                    <AssignButton profileId={p.id} currentOwner={p.ownerUser.name} />
                  </div>
                )}
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
                <th className="text-left p-3 font-medium hidden md:table-cell">单位/课题组</th>
                <th className="text-left p-3 font-medium">阶段</th>
                <th className="text-left p-3 font-medium hidden sm:table-cell">重要度</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">分类</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">分配状态</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">负责人</th>
                {!isRep && <th className="text-left p-3 font-medium">操作</th>}
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
                  <td className="p-3 hidden md:table-cell text-muted-foreground">
                    <div>{p.sourceCustomer.organization || "-"}</div>
                    {p.sourceCustomer.labOrGroup && <div className="text-xs">{p.sourceCustomer.labOrGroup}</div>}
                  </td>
                  <td className="p-3"><StageBadge stage={p.stage} /></td>
                  <td className="p-3 hidden sm:table-cell"><ImportanceBadge importance={p.importance} /></td>
                  <td className="p-3 hidden lg:table-cell"><PersonCategoryBadge category={p.personCategory} /></td>
                  <td className="p-3 hidden md:table-cell"><AssignmentStatusBadge status={p.assignmentStatus} /></td>
                  <td className="p-3 hidden lg:table-cell">{p.ownerUser.name}</td>
                  {!isRep && (
                    <td className="p-3">
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
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
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
