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
import { Users, ClipboardList, AlertTriangle, MapPin, ClipboardCheck, CalendarClock, Network, Share2, ArrowRight, BarChart3, UserCog, Layers, Handshake, MessageSquare } from "lucide-react";
import Link from "next/link";

export default function CrmDashboardPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <CrmDashboard />;
}

function CrmDashboard() {
  const { data: session } = useSession();
  const isRep = session?.user?.role === "REPRESENTATIVE";
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

  if (isLoading) return <div className="p-6">加载中...</div>;
  const stats = data?.stats;
  if (!stats) return <div className="p-6">暂无数据</div>;

  return (
    <div className="p-6 space-y-6 pb-20">
      <h1 className="text-2xl font-bold">CRM 总览</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Users className="h-5 w-5" />} label="客户总数" value={stats.totalProfiles} />
        <StatCard icon={<ClipboardList className="h-5 w-5" />} label="待跟进" value={stats.pendingFollowUps} />
        <StatCard icon={<AlertTriangle className="h-5 w-5 text-red-500" />} label="已逾期" value={stats.overdueFollowUps} color="text-red-600" />
        <StatCard icon={<MapPin className="h-5 w-5" />} label="本周签到" value={stats.thisWeekCheckins} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">快捷操作</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <CustomerProfilePicker
            title="添加沟通"
            actionLabel="开始记录沟通"
            trigger={
              <Button variant="outline" size="sm" className="h-auto py-3 flex-col gap-1 w-full">
                <MessageSquare className="h-4 w-4" />
                <span className="text-xs">添加沟通</span>
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
              <Button variant="outline" size="sm" className="h-auto py-3 flex-col gap-1 w-full">
                <MapPin className="h-4 w-4" />
                <span className="text-xs">现场签到</span>
              </Button>
            }
            onPick={(profileId, sourceCustomerId) => {
              setQuickProfileId(profileId);
              setQuickCustomerId(sourceCustomerId);
              setQuickAction("checkin");
            }}
          />
          <Link
            href="/crm/relations"
            className="inline-flex flex-col items-center gap-1 py-3 px-2 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          >
            <Network className="h-4 w-4" />
            <span className="text-xs">客户关系</span>
          </Link>
          <Link
            href="/crm/customers"
            className="inline-flex flex-col items-center gap-1 py-3 px-2 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          >
            <Users className="h-4 w-4" />
            <span className="text-xs">客户池</span>
          </Link>
          <Link
            href="/crm/follow-ups"
            className="inline-flex flex-col items-center gap-1 py-3 px-2 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          >
            <CalendarClock className="h-4 w-4" />
            <span className="text-xs">跟进任务</span>
          </Link>
        </div>
      </div>

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

      <div className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">工作台</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Link href="/crm/customers">
            <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">客户池</p>
                    <p className="text-xs text-muted-foreground mt-0.5">管理客户档案和销售阶段</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/crm/customer-applications">
            <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{isRep ? "申请新增客户" : "客户申请审核"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{isRep ? "提交或查看客户准入进度" : "处理代表提交的新客户申请"}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/crm/follow-ups">
            <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <CalendarClock className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">跟进工作台</p>
                    <p className="text-xs text-muted-foreground mt-0.5">查看和完成待办跟进任务</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
        {!isRep && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Link href="/crm/representatives">
              <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <BarChart3 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">代表运营</p>
                      <p className="text-xs text-muted-foreground mt-0.5">查看代表客户、拜访和跟进数据</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/crm/customer-pool">
              <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Layers className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">客户流转池</p>
                      <p className="text-xs text-muted-foreground mt-0.5">管理客户分配、收回和待收回客户</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
            {session?.user?.role === "ADMIN" && (
              <>
                <Link href="/crm/region-managers">
                  <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
                    <CardContent className="pt-5 pb-5">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <UserCog className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">地区经理设置</p>
                          <p className="text-xs text-muted-foreground mt-0.5">配置地区经理和负责的代表</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/admin/representatives">
                  <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
                    <CardContent className="pt-5 pb-5">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Handshake className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">代表账号管理</p>
                          <p className="text-xs text-muted-foreground mt-0.5">创建代表、重发登录链接和归档</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </>
            )}
          </div>
        )}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">分析工具</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Link href="/crm/relations">
              <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Network className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">关系网络</p>
                      <p className="text-xs text-muted-foreground mt-0.5">查看和管理客户关系</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/crm/graph">
              <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Share2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">关系图谱</p>
                      <p className="text-xs text-muted-foreground mt-0.5">可视化客户关系网络</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
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
