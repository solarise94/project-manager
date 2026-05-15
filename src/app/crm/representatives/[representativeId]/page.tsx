"use client";

import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmRepresentativeDetail } from "@/lib/crm/types";
import { RepresentativeReportPanel } from "@/components/crm/representative-report-panel";
import { RepresentativeRegionEditor } from "@/components/crm/representative-region-editor";
import { StageBadge, ImportanceBadge, FollowUpStatusBadge } from "@/components/crm/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Users, MapPin, AlertTriangle, Clock, Network } from "lucide-react";

export default function RepDetailPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <RepDetail />;
}

function RepDetail() {
  const params = useParams<{ representativeId: string }>();
  const repId = params.representativeId;
  const router = useRouter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [regionEditorOpen, setRegionEditorOpen] = useState(false);

  const { data, isLoading } = useQuery<CrmRepresentativeDetail>({
    queryKey: crmKeys.representativeOpsDetail(repId),
    queryFn: () => fetch(`/api/crm/representatives/${repId}`).then((r) => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
  });

  const [tab, setTab] = useState("overview");

  if (isLoading) return <div className="p-6">加载中...</div>;
  if (!data) return <div className="p-6">未找到代表</div>;

  const { representative, linkedUser, customerCount, visitCheckinCount, lastCheckinAt, overdueFollowUps, longUnvisitedCount, customers, recentCheckins, openFollowUps, relationCount, regions } = data;

  return (
    <div className="p-6 space-y-4">
      <button onClick={() => router.push("/crm/representatives")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />返回代表运营
      </button>

      <div>
        <h1 className="text-2xl font-bold">{representative.name}</h1>
        <p className="text-sm text-muted-foreground">{representative.email}</p>
        {linkedUser && <p className="text-xs text-muted-foreground">系统用户: {linkedUser.name}</p>}
        {representative.archived && <span className="text-xs bg-gray-100 text-gray-600 rounded px-2 py-0.5 mt-1 inline-block">已归档</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Users} label="客户数" value={customerCount} />
        <StatCard icon={MapPin} label="30天拜访" value={visitCheckinCount} />
        <StatCard icon={AlertTriangle} label="逾期跟进" value={overdueFollowUps} />
        <StatCard icon={Clock} label="长期未拜访" value={longUnvisitedCount} />
        <StatCard icon={Network} label="关系网络" value={relationCount} />
      </div>

      {lastCheckinAt && (
        <p className="text-xs text-muted-foreground">最近签到: {new Date(lastCheckinAt).toLocaleString("zh-CN")}</p>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="customers">名下客户</TabsTrigger>
          <TabsTrigger value="checkins">拜访记录</TabsTrigger>
          <TabsTrigger value="followUps">跟进任务</TabsTrigger>
          <TabsTrigger value="report">周报</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4">
                <h3 className="font-medium mb-2">代表信息</h3>
                <dl className="text-sm space-y-1">
                  <div className="flex gap-2"><dt className="text-muted-foreground">姓名:</dt><dd>{representative.name}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted-foreground">邮箱:</dt><dd>{representative.email}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted-foreground">系统用户:</dt><dd>{linkedUser?.name || "未关联"}</dd></div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">所属地区</h3>
                  {session?.user?.role === "ADMIN" && (
                    <Button variant="outline" size="sm" onClick={() => setRegionEditorOpen(true)}>
                      编辑地区
                    </Button>
                  )}
                </div>
                {regions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">未设置地区</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {regions.map((r) => (
                      <Badge key={r.id} variant="secondary" className="text-xs">
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <h3 className="font-medium mb-2">近期动态</h3>
                {recentCheckins.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无签到记录</p>
                ) : (
                  <ul className="text-sm space-y-1">
                    {recentCheckins.slice(0, 5).map((c) => (
                      <li key={c.id} className="text-muted-foreground">
                        {new Date(c.createdAt).toLocaleString("zh-CN")} — {c.addressSnapshot || "未知地点"}
                        {c.photoCount > 0 && <span className="ml-1">({c.photoCount}张照片)</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {session?.user?.role === "ADMIN" && (
            <RepresentativeRegionEditor
              open={regionEditorOpen}
              onOpenChange={setRegionEditorOpen}
              representativeId={repId}
              onSaved={() => {
                queryClient.invalidateQueries({ queryKey: crmKeys.representativeOpsDetail(repId) });
                queryClient.invalidateQueries({ queryKey: crmKeys.representativeOps() });
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="customers" className="mt-4">
          {customers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">暂无客户</p>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">客户</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">单位</th>
                    <th className="text-left p-3 font-medium">阶段</th>
                    <th className="text-left p-3 font-medium hidden sm:table-cell">重要度</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((p) => (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <Link href={`/crm/customers/${p.sourceCustomerId}`} className="text-primary hover:underline font-medium">
                          {p.sourceCustomer.name}
                        </Link>
                      </td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">{p.sourceCustomer.organization || "-"}</td>
                      <td className="p-3"><StageBadge stage={p.stage} /></td>
                      <td className="p-3 hidden sm:table-cell"><ImportanceBadge importance={p.importance} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="checkins" className="mt-4">
          {recentCheckins.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">暂无签到记录</p>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">时间</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">地址</th>
                    <th className="text-right p-3 font-medium">照片</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCheckins.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">{new Date(c.createdAt).toLocaleString("zh-CN")}</td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">{c.addressSnapshot || "-"}</td>
                      <td className="p-3 text-right">{c.photoCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="followUps" className="mt-4">
          {openFollowUps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">暂无待处理跟进</p>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">任务</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">客户</th>
                    <th className="text-left p-3 font-medium">截止</th>
                    <th className="text-left p-3 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {openFollowUps.map((f) => (
                    <tr key={f.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">{f.title}</td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">
                        {f.profile?.sourceCustomer?.name || "-"}
                      </td>
                      <td className="p-3">{new Date(f.dueAt).toLocaleDateString("zh-CN")}</td>
                      <td className="p-3"><FollowUpStatusBadge status={f.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="report" className="mt-4">
          <RepresentativeReportPanel representativeId={representative.id} readOnly />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-2 px-3">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">{label}</span>
        </div>
        <p className="text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
