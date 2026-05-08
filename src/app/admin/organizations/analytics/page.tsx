"use client";

import { Suspense, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Search, ArrowRight, Users, Building2, BarChart3 } from "lucide-react";
import Link from "next/link";

interface OrgAnalyticsRow {
  organizationId: string;
  canonicalName: string;
  orgCode: string;
  customerCount: number;
  crmProfileCount: number;
  assignedProfileCount: number;
  unassignedProfileCount: number;
  representativeCount: number;
  interactionCount: number;
  checkinCount: number;
  visitDensity: number;
  interactionDensity: number;
  lastInteractionAt: string | null;
  lastCheckinAt: string | null;
  lastActivityAt: string | null;
}

export default function OrgAnalyticsPage() {
  return (
    <Suspense fallback={<div className="p-6">加载中...</div>}>
      <OrgAnalyticsInner />
    </Suspense>
  );
}

function OrgAnalyticsInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const sp = useSearchParams();

  const [search, setSearch] = useState(sp.get("search") || "");
  const [range, setRange] = useState("30");
  const [sort, setSort] = useState("customerCount");
  const [order, setOrder] = useState("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("range", range);
  params.set("sort", sort);
  params.set("order", order);
  params.set("page", String(page));
  params.set("pageSize", "25");

  const { data, isLoading } = useQuery<{
    organizations: OrgAnalyticsRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>({
    queryKey: ["org-analytics", search, range, sort, order, page],
    queryFn: () => fetch(`/api/crm/organization-analytics?${params}`).then((r) => r.json()),
    enabled: status === "authenticated" && session?.user?.role === "ADMIN",
  });

  if (status === "loading") return null;
  if (!session || session.user.role !== "ADMIN") return null;

  const orgs = data?.organizations || [];

  return (
    <div className="p-6 space-y-6 pb-20 max-w-full overflow-x-hidden">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          机构运营分析
        </h1>
        <p className="text-muted-foreground">按机构维度查看客户覆盖、沟通和拜访数据</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索机构..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={range} onValueChange={(v) => { setRange(v || "30"); setPage(1); }}>
          <SelectTrigger className="w-[120px]"><span>{range === "7" ? "近7天" : range === "30" ? "近30天" : range === "90" ? "近90天" : range + "天"}</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">近7天</SelectItem>
            <SelectItem value="30">近30天</SelectItem>
            <SelectItem value="90">近90天</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => { setSort(v || "customerCount"); setPage(1); }}>
          <SelectTrigger className="w-[130px]"><SelectDisplay label="排序" valueLabel={
            sort === "customerCount" ? "客户数" :
            sort === "crmProfileCount" ? "CRM客户" :
            sort === "checkinCount" ? "签到数" :
            sort === "interactionCount" ? "沟通数" :
            sort === "visitDensity" ? "拜访密度" :
            sort === "lastActivityAt" ? "最近活动" : "默认"
          } placeholder="排序" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="customerCount">客户数</SelectItem>
            <SelectItem value="crmProfileCount">CRM客户</SelectItem>
            <SelectItem value="checkinCount">签到数</SelectItem>
            <SelectItem value="interactionCount">沟通数</SelectItem>
            <SelectItem value="visitDensity">拜访密度</SelectItem>
            <SelectItem value="lastActivityAt">最近活动</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => setOrder(order === "asc" ? "desc" : "asc")} className="h-9 text-xs">
          {order === "asc" ? "↑ 升序" : "↓ 降序"}
        </Button>
        <Link href="/admin/organizations" className="inline-flex items-center gap-1 h-7 px-2.5 text-[0.8rem] border border-input bg-background hover:bg-muted rounded-md"><Building2 className="h-4 w-4" />机构管理</Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}</div>
      ) : orgs.length === 0 ? (
        <div className="text-sm text-muted-foreground py-12 text-center">
          {search ? "未找到匹配的机构" : "暂无数据"}
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">机构</th>
                <th className="text-right p-3 font-medium">客户</th>
                <th className="text-right p-3 font-medium hidden md:table-cell">CRM客户</th>
                <th className="text-right p-3 font-medium hidden lg:table-cell">负责代表</th>
                <th className="text-right p-3 font-medium">{range}天沟通</th>
                <th className="text-right p-3 font-medium">{range}天签到</th>
                <th className="text-right p-3 font-medium hidden sm:table-cell">拜访密度</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">最近活动</th>
                <th className="text-left p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.organizationId} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <span className="font-medium">{o.canonicalName}</span>
                    <div className="text-xs text-muted-foreground font-mono">{o.orgCode}</div>
                  </td>
                  <td className="p-3 text-right">{o.customerCount}</td>
                  <td className="p-3 text-right hidden md:table-cell">{o.crmProfileCount}</td>
                  <td className="p-3 text-right hidden lg:table-cell">{o.representativeCount}</td>
                  <td className="p-3 text-right">{o.interactionCount}</td>
                  <td className="p-3 text-right">{o.checkinCount}</td>
                  <td className="p-3 text-right font-mono hidden sm:table-cell">{o.visitDensity.toFixed(1)}</td>
                  <td className="p-3 text-muted-foreground hidden lg:table-cell">
                    {o.lastActivityAt ? new Date(o.lastActivityAt).toLocaleDateString("zh-CN") : "—"}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Link href={`/crm/customers?organizationId=${o.organizationId}&organizationName=${encodeURIComponent(o.canonicalName)}`} className="inline-flex items-center gap-1 h-6 px-2 text-xs hover:bg-muted rounded-md">
                          <Users className="h-3 w-3" />客户
                        </Link>
                        <Link href={`/admin/organizations/${o.organizationId}/analytics`} className="inline-flex items-center gap-1 h-6 px-2 text-xs hover:bg-muted rounded-md">
                          分析<ArrowRight className="h-3 w-3 ml-1" />
                        </Link>
                    </div>
                  </td>
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
