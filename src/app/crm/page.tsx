"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { INTERACTION_TYPE_LABELS } from "@/lib/crm/constants";
import { StageBadge } from "@/components/crm/badges";
import { CustomerProfilePicker } from "@/components/crm/customer-profile-picker";
import { InteractionFormDialog } from "@/components/crm/interaction-form-dialog";
import { CheckinFlow } from "@/components/crm/checkin-flow";
import type { CrmDashboardStats } from "@/lib/crm/types";
import {
  Users, ClipboardList, AlertTriangle, MapPin,
  CalendarClock, Network, BarChart3, UserCog,
  MessageSquare, ClipboardCheck, Building2,
  ChevronRight, Inbox,
} from "lucide-react";
import Link from "next/link";
import { CrmEmptyState } from "@/components/crm/empty-state";

export default function CrmDashboardPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <CrmDashboard />;
}

function CrmDashboard() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isRep = role === "REPRESENTATIVE";
  const isAdmin = role === "ADMIN";
  const [quickAction, setQuickAction] = useState<"interaction" | "checkin" | null>(null);
  const [quickProfileId, setQuickProfileId] = useState("");
  const [quickCustomerId, setQuickCustomerId] = useState("");

  function clearQuickAction() {
    setQuickAction(null);
    setQuickProfileId("");
    setQuickCustomerId("");
  }

  const { data, isLoading } = useQuery<{ stats: CrmDashboardStats }>({
    queryKey: ["crm-dashboard"],
    queryFn: () => fetch("/api/crm/dashboard").then((r) => r.json()),
  });

  const { data: analyticsData } = useQuery<{
    global: { interactionCount7d: number; interactionCount30d: number; checkinCount7d: number; checkinCount30d: number };
    representatives: Array<{ representativeId: string; name: string; email: string; hasUser: boolean; profileCount: number; checkinCount30d: number; lastCheckinAt: string | null; overdueFollowUps: number; interactionCount30d: number; visitDensity: number; interactionDensity: number }>;
  }>({
    queryKey: ["crm-admin-analytics"],
    queryFn: () => fetch("/api/crm/admin-analytics").then((r) => r.json()),
    enabled: isAdmin,
  });

  if (isLoading) return <div className="p-6">加载中...</div>;
  const stats = data?.stats;
  if (!stats) return <CrmEmptyState icon={Inbox} title="暂无数据" className="py-20" />;

  return (
    <div className="p-4 sm:p-6 space-y-5 pb-20 max-w-full overflow-x-hidden">
      {/* Header + Quick actions toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold">CRM 工作台</h1>
        <div className="flex items-center gap-1.5 flex-wrap">
          <CustomerProfilePicker
            title="添加沟通"
            actionLabel="开始记录沟通"
            trigger={
              <Button variant="outline" size="sm">
                <MessageSquare className="h-3.5 w-3.5 mr-1" />添加沟通
              </Button>
            }
            onPick={(profileId, sourceCustomerId) => {
              setQuickProfileId(profileId);
              setQuickCustomerId(sourceCustomerId);
              setQuickAction("interaction");
            }}
          />
          <CustomerProfilePicker
            title="现场签到"
            actionLabel="开始签到"
            trigger={
              <Button variant="outline" size="sm">
                <MapPin className="h-3.5 w-3.5 mr-1" />现场签到
              </Button>
            }
            onPick={(profileId, sourceCustomerId) => {
              setQuickProfileId(profileId);
              setQuickCustomerId(sourceCustomerId);
              setQuickAction("checkin");
            }}
          />
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard icon={<Users className="h-4 w-4" />} label="客户总数" value={stats.totalProfiles} />
        <MetricCard icon={<ClipboardList className="h-4 w-4" />} label="待跟进" value={stats.pendingFollowUps} />
        <MetricCard icon={<AlertTriangle className="h-4 w-4 text-red-500" />} label="已逾期" value={stats.overdueFollowUps} color="text-red-600" />
        <MetricCard icon={<MapPin className="h-4 w-4" />} label="本周签到" value={stats.thisWeekCheckins} />
        {!isRep && <MetricCard icon={<Users className="h-4 w-4" />} label="我的客户" value={stats.myProfiles} />}
        {isAdmin && analyticsData && (
          <>
            <MetricCard icon={<MessageSquare className="h-4 w-4" />} label="7天沟通" value={analyticsData.global.interactionCount7d} />
          </>
        )}
      </div>

      {/* Admin analytics section */}
      {isAdmin && analyticsData && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">运营概览</CardTitle>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span>7天沟通 {analyticsData.global.interactionCount7d}</span>
                <span>·</span>
                <span>30天沟通 {analyticsData.global.interactionCount30d}</span>
                <span>·</span>
                <span>7天签到 {analyticsData.global.checkinCount7d}</span>
                <span>·</span>
                <span>30天签到 {analyticsData.global.checkinCount30d}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1.5 pr-2 font-medium">代表</th>
                    <th className="py-1.5 pr-2 font-medium text-right">客户</th>
                    <th className="py-1.5 pr-2 font-medium text-right">30天签到</th>
                    <th className="py-1.5 pr-2 font-medium text-right">30天沟通</th>
                    <th className="py-1.5 pr-2 font-medium text-right">逾期</th>
                    <th className="py-1.5 pr-2 font-medium text-right">拜访密度</th>
                    <th className="py-1.5 font-medium">最近签到</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.representatives.map((r) => (
                    <tr key={r.representativeId} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">
                        <Link href={`/crm/representatives/${r.representativeId}`} className="text-primary hover:underline">
                          {r.name}
                        </Link>
                        {!r.hasUser && <span className="text-amber-500 ml-1" title="未登录">⚠</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{r.profileCount}</td>
                      <td className="py-1.5 pr-2 text-right">{r.checkinCount30d}</td>
                      <td className="py-1.5 pr-2 text-right">{r.interactionCount30d}</td>
                      <td className="py-1.5 pr-2 text-right">{r.overdueFollowUps > 0 ? <span className="text-red-500">{r.overdueFollowUps}</span> : 0}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{r.visitDensity.toFixed(1)}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {r.lastCheckinAt ? new Date(r.lastCheckinAt).toLocaleDateString("zh-CN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main content grid */}
      <div className="grid md:grid-cols-2 gap-5">
        {/* Stage distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">阶段分布</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.stageDistribution.length === 0 ? (
              <CrmEmptyState icon={BarChart3} title="暂无数据" className="py-8" />
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

        {/* Recent interactions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">最近沟通</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recentInteractions.length === 0 ? (
              <CrmEmptyState icon={MessageSquare} title="暂无记录" className="py-8" />
            ) : (
              <div className="space-y-2.5">
                {stats.recentInteractions.slice(0, 8).map((i) => (
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

      {/* Quick navigation */}
      <div className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">快捷导航</h2>
        <nav className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          <QuickNavCard
            href="/crm/customers"
            icon={<Users className="h-5 w-5" />}
            label="客户池"
            color="border-l-blue-500"
          />
          <QuickNavCard
            href="/crm/follow-ups"
            icon={<CalendarClock className="h-5 w-5" />}
            label="跟进任务"
            color="border-l-orange-500"
          />
          {!isRep && !isAdmin && (
            <QuickNavCard
              href="/crm/customer-pool"
              icon={<Users className="h-5 w-5" />}
              label="客户流转池"
              color="border-l-sky-500"
            />
          )}
          <QuickNavCard
            href="/crm/customer-applications"
            icon={<ClipboardCheck className="h-5 w-5" />}
            label={isRep ? "客户申请" : "申请审核"}
            color="border-l-green-500"
          />
          <QuickNavCard
            href="/crm/relations"
            icon={<Network className="h-5 w-5" />}
            label="关系网络"
            color="border-l-purple-500"
          />
          <QuickNavCard
            href="/crm/graph"
            icon={<Network className="h-5 w-5" />}
            label="关系图谱"
            color="border-l-indigo-500"
          />
          {isAdmin && (
            <>
              <QuickNavCard
                href="/admin/organizations/analytics"
                icon={<Building2 className="h-5 w-5" />}
                label="机构分析"
                color="border-l-cyan-500"
              />
              <QuickNavCard
                href="/crm/representatives"
                icon={<BarChart3 className="h-5 w-5" />}
                label="代表运营"
                color="border-l-pink-500"
              />
              <QuickNavCard
                href="/crm/region-managers"
                icon={<UserCog className="h-5 w-5" />}
                label="地区经理"
                color="border-l-amber-500"
              />
            </>
          )}
        </nav>
      </div>

      {/* Quick action dialogs */}
      {quickAction === "interaction" && quickProfileId && (
        <InteractionFormDialog
          profileId={quickProfileId}
          sourceCustomerId={quickCustomerId}
          startOpen
          onClose={clearQuickAction}
        />
      )}
      {quickAction === "checkin" && quickProfileId && (
        <CheckinFlow
          profileId={quickProfileId}
          sourceCustomerId={quickCustomerId}
          autoStart
          onDone={clearQuickAction}
        />
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-2 px-3">
        <div className="flex items-center gap-1.5 mb-0.5">
          {icon}
          <span className="text-[11px] text-muted-foreground">{label}</span>
        </div>
        <p className={`text-xl font-bold ${color || ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function QuickNavCard({
  href,
  icon,
  label,
  color,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 h-14 md:h-12 px-4 border border-input bg-background hover:bg-muted/80 rounded-md border-l-4 ${color} active:scale-[0.98] transition-transform`}
    >
      <span className="text-muted-foreground group-hover:text-foreground transition-colors">
        {icon}
      </span>
      <span className="text-sm font-medium flex-1">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
    </Link>
  );
}
