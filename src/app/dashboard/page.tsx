"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, FolderPlus, Clock, AlertCircle, TrendingUp, Users, UserPlus, ClipboardList, ShoppingCart, Building2, Store, Settings, UserCog, Building, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import type { DashboardStats } from "@/lib/types";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "#94a3b8",
  IN_PROGRESS: "#3b82f6",
  COMPLETED: "#22c55e",
  ON_HOLD: "#f59e0b",
};

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  ON_HOLD: "暂停",
};

type ActionCardItem = { label: string; href: string; icon: React.ElementType; description: string };

interface WorkbenchGroup {
  title: string;
  items: ActionCardItem[];
  roles?: string[];
}

function getWorkbenchGroups(role: string | undefined): WorkbenchGroup[] {
  const groups: WorkbenchGroup[] = [
    {
      title: "项目与工单",
      items: [
        ...(role !== "REPRESENTATIVE"
          ? [{ label: "新建项目", href: "/projects?create=1", icon: FolderPlus, description: "创建新的科研项目" }]
          : []),
        { label: "项目列表", href: "/projects", icon: FolderOpen, description: "查看所有项目" },
        { label: "待处理工单", href: "/tickets", icon: AlertCircle, description: "需要关注的工单" },
      ],
    },
    {
      title: "CRM",
      items: [
        { label: "CRM客户池", href: "/crm/customers", icon: Users, description: "管理客户档案" },
        { label: "跟进工作台", href: "/crm/follow-ups", icon: ClipboardList, description: "待办跟进任务" },
        { label: "客户申请", href: "/crm/customer-applications", icon: UserPlus, description: role === "REPRESENTATIVE" ? "提交或查看客户准入申请" : "处理新客户申请" },
      ],
    },
  ];

  if (role !== "REPRESENTATIVE") {
    groups.push({
      title: "订单与开票",
      items: [
        { label: "拼好鼠订单", href: "/external-orders", icon: ShoppingCart, description: "导入线上平台订单、匹配客户、合并开票" },
      ],
    });
  }

  if (role === "ADMIN") {
    groups.push({
      title: "管理",
      items: [
        { label: "用户管理", href: "/admin/users", icon: UserCog, description: "管理系统用户" },
        { label: "代表账号管理", href: "/admin/representatives", icon: Settings, description: "管理代表账号" },
        { label: "单位主数据", href: "/admin/organizations", icon: Building, description: "管理单位信息" },
        { label: "开票主体", href: "/admin/billing-profiles", icon: Building2, description: "管理开票主体信息" },
        { label: "采购渠道", href: "/admin/procurement-channels", icon: Store, description: "管理采购渠道" },
      ],
    });
  }

  return groups;
}

function ActionCard({ action }: { action: ActionCardItem }) {
  return (
    <Link href={action.href}>
      <Card className="group cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/30 h-full">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
              <action.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug line-clamp-2">{action.label}</p>
              <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{action.description}</p>
            </div>
            <ArrowRight className="hidden sm:block h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/stats");
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    enabled: status === "authenticated",
  });

  if (status === "loading") {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (!session) return null;

  const pieData =
    stats?.statusDistribution?.map((item) => ({
      name: STATUS_LABELS[item.status] || item.status,
      value: item._count.status,
      color: STATUS_COLORS[item.status] || "#8884d8",
    })) || [];

  const lineData =
    stats?.ticketTrend?.map((item) => ({
      date: item.date.slice(5),
      count: Number(item.count),
    })) || [];

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">仪表盘</h1>
        <p className="text-muted-foreground">欢迎回来，{session.user.name}</p>
      </div>

      {getWorkbenchGroups(session.user.role).map((group) => (
        <div key={group.title}>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">{group.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.items.map((action) => (
              <ActionCard key={action.label} action={action} />
            ))}
          </div>
        </div>
      ))}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="总项目"
          value={isLoading ? "-" : stats?.totalProjects ?? 0}
          icon={FolderOpen}
          description="全部科研项目"
        />
        <StatCard
          title="进行中"
          value={isLoading ? "-" : stats?.inProgressProjects ?? 0}
          icon={Clock}
          description="活跃项目数量"
        />
        <StatCard
          title="待处理工单"
          value={isLoading ? "-" : stats?.pendingTickets ?? 0}
          icon={AlertCircle}
          description="需要关注的工单"
        />
        <StatCard
          title="本周新增"
          value={isLoading ? "-" : `${stats?.weekProjects ?? 0} 项目 / ${stats?.weekTickets ?? 0} 工单`}
          icon={TrendingUp}
          description="较上周变化"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>项目状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                暂无项目数据
              </div>
            )}
            <div className="flex flex-wrap gap-3 justify-center mt-2">
              {pieData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  {entry.name}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>近7天工单趋势</CardTitle>
          </CardHeader>
          <CardContent>
            {lineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                近7天无工单数据
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
