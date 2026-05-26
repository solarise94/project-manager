"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectDisplay } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmRepresentativeOpsItem } from "@/lib/crm/types";
import Link from "next/link";
import { Search, Users, MessageSquare, AlertTriangle, Clock, X, UserCog, ShoppingCart } from "lucide-react";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default function RepresentativesOpsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;
  if (session?.user?.role === "REPRESENTATIVE") { router.push("/crm"); return null; }

  return <RepOpsList />;
}

function RepOpsList() {
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState("active");
  const [hasOverdue, setHasOverdue] = useState("");
  const [hasLongUnvisited, setHasLongUnvisited] = useState("");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState("asc");
  const [regionId, setRegionId] = useState("");
  const [selectedRepIds, setSelectedRepIds] = useState<string[]>([]);
  const [period, setPeriodRaw] = useState(() => {
    if (typeof window === "undefined") return "";
    const p = new URLSearchParams(window.location.search).get("period") || "";
    return (p === "today" || p === "week") ? p : "";
  });

  // Sync period to URL
  const setPeriod = useCallback(
    (p: string) => {
      setPeriodRaw(p);
      const url = new URL(window.location.href);
      if (p) url.searchParams.set("period", p);
      else url.searchParams.delete("period");
      window.history.replaceState(null, "", url.toString());
    },
    []
  );

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (archived !== "active") params.set("archived", archived);
  if (hasOverdue) params.set("hasOverdue", hasOverdue);
  if (hasLongUnvisited) params.set("hasLongUnvisited", hasLongUnvisited);
  if (sort !== "name") params.set("sort", sort);
  if (order !== "asc") params.set("order", order);
  if (regionId) params.set("regionId", regionId);
  if (selectedRepIds.length > 0) params.set("representativeIds", selectedRepIds.join(","));
  if (period) params.set("period", period);

  const { data, isLoading } = useQuery<{ representatives: CrmRepresentativeOpsItem[] }>({
    queryKey: [...crmKeys.representativeOps(), search, archived, hasOverdue, hasLongUnvisited, sort, order, regionId, selectedRepIds.join(","), period],
    queryFn: () => fetch(`/api/crm/representatives?${params}`).then((r) => r.json()),
  });

  const { data: regionsData } = useQuery<{ regions: { id: string; name: string }[] }>({
    queryKey: ["representative-regions"],
    queryFn: () => fetch("/api/crm/representative-regions").then((r) => r.json()),
  });
  const regions = regionsData?.regions || [];

  const { data: allRepsData } = useQuery<{ representatives: CrmRepresentativeOpsItem[] }>({
    queryKey: [...crmKeys.representativeOps(), "all-reps-list"],
    queryFn: () => fetch("/api/crm/representatives?archived=all").then((r) => r.json()),
  });
  const allReps = allRepsData?.representatives || [];

  const reps = data?.representatives || [];
  const [repSelectOpen, setRepSelectOpen] = useState(false);

  const hasPeriod = period === "today" || period === "week";
  const totalCustomers = reps.reduce((s, r) => s + r.customerCount, 0);
  const totalInteractions = hasPeriod
    ? reps.reduce((s, r) => s + (r.periodInteractionCount || 0), 0)
    : reps.reduce((s, r) => s + (r.interactionCount30d || 0), 0);
  const totalNewCustomers = hasPeriod
    ? reps.reduce((s, r) => s + (r.periodNewCustomerCount || 0), 0)
    : 0;
  const totalOrders = hasPeriod
    ? reps.reduce((s, r) => s + (r.periodReservedOrderCount || 0), 0)
    : 0;
  const totalOrderAmount = hasPeriod
    ? reps.reduce((s, r) => s + (r.periodReservedOrderAmount || 0), 0)
    : 0;
  const totalOverdue = reps.reduce((s, r) => s + r.overdueFollowUps, 0);
  const totalLongUnvisited = reps.reduce((s, r) => s + r.longUnvisitedCount, 0);
  const totalDueCommunication = reps.reduce((s, r) => s + (r.dueCommunicationTaskCount || 0), 0);
  const totalDoneCommunication = reps.reduce((s, r) => s + (r.doneCommunicationTaskCount || 0), 0);
  const totalDormant = reps.reduce((s, r) => s + (r.dormantCustomerCount || 0), 0);
  const totalDormantWarning = reps.reduce((s, r) => s + (r.dormantWarningCustomerCount || 0), 0);

  const activeFilterCount = (archived !== "active" ? 1 : 0) + (hasOverdue ? 1 : 0) + (hasLongUnvisited ? 1 : 0) + (regionId ? 1 : 0) + (selectedRepIds.length > 0 ? 1 : 0) + (period ? 1 : 0);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">代表运营</h1>

      <div className={`grid grid-cols-2 gap-3 ${hasPeriod ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
        {hasPeriod ? (
          <>
            <StatCard icon={MessageSquare} label="已有客户沟通" value={totalInteractions} />
            <StatCard icon={Users} label="新增客户" value={totalNewCustomers} />
            <StatCard icon={ShoppingCart} label="下单数" value={totalOrders} />
            <StatCard icon={ShoppingCart} label="下单金额" value={formatCurrency(totalOrderAmount)} />
            <StatCard icon={AlertTriangle} label="逾期跟进" value={totalOverdue} color={totalOverdue > 0 ? "text-red-600" : undefined} />
          </>
        ) : (
          <>
            <StatCard icon={Users} label="总客户数" value={totalCustomers} />
            <StatCard icon={MessageSquare} label="30天已有客户沟通" value={totalInteractions} />
            <StatCard icon={Clock} label="沟通任务" value={totalDueCommunication} />
            <StatCard icon={Clock} label="已完成沟通" value={totalDoneCommunication} />
            <StatCard icon={AlertTriangle} label="逾期跟进" value={totalOverdue} color={totalOverdue > 0 ? "text-red-600" : undefined} />
            <StatCard icon={Clock} label="长期未拜访" value={totalLongUnvisited} color={totalLongUnvisited > 0 ? "text-orange-600" : undefined} />
            <StatCard icon={Users} label="休眠客户" value={totalDormant} color={totalDormant > 0 ? "text-slate-600" : undefined} />
            <StatCard icon={AlertTriangle} label="休眠预警" value={totalDormantWarning} color={totalDormantWarning > 0 ? "text-amber-600" : undefined} />
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索代表姓名或邮箱..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={archived} onValueChange={(v) => setArchived(v || "active")}>
          <SelectTrigger className="w-[100px] h-9 text-xs"><SelectDisplay label="状态" valueLabel={archived === "active" ? "在职" : archived === "archived" ? "已归档" : "全部"} placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">在职</SelectItem>
            <SelectItem value="archived">已归档</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
        <Select value={hasOverdue} onValueChange={(v) => setHasOverdue(v || "")}>
          <SelectTrigger className="w-[100px] h-9 text-xs"><SelectDisplay label="逾期" valueLabel={hasOverdue === "true" ? "有逾期" : hasOverdue === "false" ? "无逾期" : "全部"} placeholder="逾期" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部</SelectItem>
            <SelectItem value="true">有逾期</SelectItem>
            <SelectItem value="false">无逾期</SelectItem>
          </SelectContent>
        </Select>
        <Select value={hasLongUnvisited} onValueChange={(v) => setHasLongUnvisited(v || "")}>
          <SelectTrigger className="w-[110px] h-9 text-xs"><SelectDisplay label="长期未访" valueLabel={hasLongUnvisited === "true" ? "有长期未访" : hasLongUnvisited === "false" ? "无长期未访" : "全部"} placeholder="长期未访" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部</SelectItem>
            <SelectItem value="true">有长期未访</SelectItem>
            <SelectItem value="false">无长期未访</SelectItem>
          </SelectContent>
        </Select>
        <Select value={regionId || "__all__"} onValueChange={(v) => setRegionId(v === "__all__" ? "" : (v || ""))}>
          <SelectTrigger className="w-[100px] h-9 text-xs"><SelectDisplay label="地区" valueLabel={regionId ? (regions.find((r) => r.id === regionId)?.name || regionId) : "全部"} placeholder="地区" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部地区</SelectItem>
            {regions.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" className="h-9 text-xs" onClick={() => setRepSelectOpen(true)}>
          <UserCog className="h-3.5 w-3.5 mr-1" />
          {selectedRepIds.length > 0 ? `代表 (${selectedRepIds.length})` : "代表"}
        </Button>
        <div className="flex items-center border rounded-md">
          <button
            type="button"
            className={`px-2.5 py-1.5 text-xs ${period === "" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setPeriod("")}
          >全量</button>
          <button
            type="button"
            className={`px-2.5 py-1.5 text-xs border-l ${period === "today" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setPeriod("today")}
          >今日</button>
          <button
            type="button"
            className={`px-2.5 py-1.5 text-xs border-l ${period === "week" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setPeriod("week")}
          >本周</button>
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v || "name")}>
          <SelectTrigger className="w-[90px] h-9 text-xs"><span>排序</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">姓名</SelectItem>
            <SelectItem value="customerCount">客户数</SelectItem>
            <SelectItem value="interactionCount30d">沟通数</SelectItem>
            <SelectItem value="overdueFollowUps">逾期数</SelectItem>
            <SelectItem value="longUnvisitedCount">长期未访</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => setOrder(order === "asc" ? "desc" : "asc")} className="h-9 text-xs">
          {order === "asc" ? "↑" : "↓"}
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { setArchived("active"); setHasOverdue(""); setHasLongUnvisited(""); setRegionId(""); setSelectedRepIds([]); setPeriod(""); setSort("name"); setOrder("asc"); }}>
            <X className="h-4 w-4 mr-1" />清空
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : reps.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">暂无代表数据</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">代表</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">邮箱</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">地区</th>
                {hasPeriod ? (
                  <>
                    <th className="text-right p-3 font-medium">已有客户沟通</th>
                    <th className="text-right p-3 font-medium hidden sm:table-cell">新增客户</th>
                    <th className="text-right p-3 font-medium hidden sm:table-cell">下单数</th>
                    <th className="text-right p-3 font-medium hidden lg:table-cell">下单金额</th>
                  </>
                ) : (
                  <>
                    <th className="text-right p-3 font-medium">客户数</th>
                    <th className="text-right p-3 font-medium hidden sm:table-cell">30天已有客户沟通</th>
                    <th className="text-right p-3 font-medium hidden md:table-cell">沟通任务</th>
                    <th className="text-right p-3 font-medium hidden lg:table-cell">已完成沟通</th>
                    <th className="text-right p-3 font-medium hidden lg:table-cell">复购率</th>
                  </>
                )}
                <th className="text-right p-3 font-medium hidden sm:table-cell">逾期跟进</th>
                <th className="text-right p-3 font-medium hidden lg:table-cell">休眠</th>
                <th className="text-right p-3 font-medium hidden lg:table-cell">长期未拜访</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.representativeId} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Link href={`/crm/representatives/${r.representativeId}`} className="text-primary hover:underline font-medium">
                      {r.name}
                    </Link>
                    {r.archived && <span className="text-xs text-muted-foreground ml-2">已归档</span>}
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">{r.email}</td>
                  <td className="p-3 hidden lg:table-cell">
                    <div className="flex gap-1 flex-wrap">
                      {(r as CrmRepresentativeOpsItem & { regions?: { id: string; name: string; isPrimary: boolean }[] }).regions?.map((region) => (
                        <Badge key={region.id} variant={region.isPrimary ? "default" : "secondary"} className="text-xs">
                          {region.name}
                        </Badge>
                      )) || "-"}
                    </div>
                  </td>
                  {hasPeriod ? (
                    <>
                      <td className="p-3 text-right font-medium">{r.periodInteractionCount ?? 0}</td>
                      <td className="p-3 text-right hidden sm:table-cell">{r.periodNewCustomerCount ?? 0}</td>
                      <td className="p-3 text-right hidden sm:table-cell">{r.periodReservedOrderCount ?? 0}</td>
                      <td className="p-3 text-right hidden lg:table-cell">{formatCurrency(r.periodReservedOrderAmount ?? 0)}</td>
                    </>
                  ) : (
                    <>
                      <td className="p-3 text-right font-medium">{r.customerCount}</td>
                      <td className="p-3 text-right hidden sm:table-cell">{r.interactionCount30d ?? 0}</td>
                      <td className="p-3 text-right hidden md:table-cell">{r.dueCommunicationTaskCount ?? 0}</td>
                      <td className="p-3 text-right hidden lg:table-cell">{r.doneCommunicationTaskCount ?? 0}</td>
                      <td className="p-3 text-right hidden lg:table-cell">{Math.round((r.repeatCustomerRate30d || 0) * 100)}%</td>
                    </>
                  )}
                  <td className="p-3 text-right hidden sm:table-cell">
                    <span className={r.overdueFollowUps > 0 ? "text-red-600 font-medium" : ""}>{r.overdueFollowUps}</span>
                  </td>
                  <td className="p-3 text-right hidden lg:table-cell">
                    <span className={(r.dormantCustomerCount || 0) > 0 ? "text-slate-600 font-medium" : ""}>{r.dormantCustomerCount || 0}</span>
                  </td>
                  <td className="p-3 text-right hidden lg:table-cell">
                    <span className={r.longUnvisitedCount > 0 ? "text-orange-600 font-medium" : ""}>{r.longUnvisitedCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={repSelectOpen} onOpenChange={setRepSelectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>选择代表</DialogTitle></DialogHeader>
          <div className="border rounded-md max-h-60 overflow-y-auto p-2 space-y-1">
            {allReps.map((r) => (
              <label key={r.representativeId} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                <input
                  type="checkbox"
                  checked={selectedRepIds.includes(r.representativeId)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedRepIds([...selectedRepIds, r.representativeId]);
                    else setSelectedRepIds(selectedRepIds.filter((id) => id !== r.representativeId));
                  }}
                />
                {r.name} <span className="text-xs text-muted-foreground">{r.email}</span>
              </label>
            ))}
            {allReps.length === 0 && <p className="text-xs text-muted-foreground p-2">暂无代表</p>}
          </div>
          <Button onClick={() => setRepSelectOpen(false)} className="w-full">确定</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | string; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-2 px-3">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">{label}</span>
        </div>
        <p className={`text-xl font-bold ${color || ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
