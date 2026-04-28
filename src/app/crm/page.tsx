"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INTERACTION_TYPE_LABELS } from "@/lib/crm/constants";
import { StageBadge } from "@/components/crm/badges";
import type { CrmDashboardStats } from "@/lib/crm/types";
import { Users, ClipboardList, AlertTriangle, MapPin } from "lucide-react";
import Link from "next/link";

export default function CrmDashboardPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <CrmDashboard />;
}

function CrmDashboard() {
  const { data, isLoading } = useQuery<{ stats: CrmDashboardStats }>({
    queryKey: ["crm-dashboard"],
    queryFn: () => fetch("/api/crm/dashboard").then((r) => r.json()),
  });

  if (isLoading) return <div className="p-6">加载中...</div>;
  const stats = data?.stats;
  if (!stats) return <div className="p-6">暂无数据</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">CRM 总览</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Users className="h-5 w-5" />} label="客户总数" value={stats.totalProfiles} />
        <StatCard icon={<ClipboardList className="h-5 w-5" />} label="待跟进" value={stats.pendingFollowUps} />
        <StatCard icon={<AlertTriangle className="h-5 w-5 text-red-500" />} label="已逾期" value={stats.overdueFollowUps} color="text-red-600" />
        <StatCard icon={<MapPin className="h-5 w-5" />} label="本周签到" value={stats.thisWeekCheckins} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">阶段分布</CardTitle></CardHeader>
          <CardContent>
            {stats.stageDistribution.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            ) : (
              <div className="space-y-2">
                {stats.stageDistribution.map((s) => (
                  <div key={s.stage} className="flex items-center justify-between">
                    <StageBadge stage={s.stage} />
                    <span className="text-sm font-medium">{s._count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">最近沟通</CardTitle></CardHeader>
          <CardContent>
            {stats.recentInteractions.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无记录</p>
            ) : (
              <div className="space-y-3">
                {stats.recentInteractions.slice(0, 5).map((i) => (
                  <div key={i.id} className="text-sm">
                    <span className="text-muted-foreground">{INTERACTION_TYPE_LABELS[i.type] || i.type}</span>
                    <span className="mx-1">·</span>
                    <span>{i.summary}</span>
                    <span className="mx-1">·</span>
                    <span className="text-muted-foreground">{i.createdByUser.name}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <Link href="/crm/customers" className="text-sm text-blue-600 hover:underline">客户池 →</Link>
        <Link href="/crm/follow-ups" className="text-sm text-blue-600 hover:underline">跟进工作台 →</Link>
        <Link href="/crm/relations" className="text-sm text-blue-600 hover:underline">关系网络 →</Link>
        <Link href="/crm/graph" className="text-sm text-blue-600 hover:underline">关系图谱 →</Link>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <p className={`text-2xl font-bold ${color || ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
