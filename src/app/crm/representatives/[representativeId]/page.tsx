"use client";

import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmRepresentativeDetail } from "@/lib/crm/types";
import { StageBadge, ImportanceBadge, FollowUpStatusBadge } from "@/components/crm/badges";
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

  const { representative, linkedUser, customerCount, visitCheckinCount, lastCheckinAt, overdueFollowUps, longUnvisitedCount, customers, recentCheckins, openFollowUps, relationCount } = data;

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

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        {(["overview", "customers", "checkins", "followUps"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm rounded ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {t === "overview" ? "概览" : t === "customers" ? "名下客户" : t === "checkins" ? "拜访记录" : "跟进任务"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <h3 className="font-medium mb-2">代表信息</h3>
              <dl className="text-sm space-y-1">
                <div className="flex gap-2"><dt className="text-muted-foreground">姓名:</dt><dd>{representative.name}</dd></div>
                <div className="flex gap-2"><dt className="text-muted-foreground">邮箱:</dt><dd>{representative.email}</dd></div>
                <div className="flex gap-2"><dt className="text-muted-foreground">系统用户:</dt><dd>{linkedUser?.name || "未关联"}</dd></div>
              </dl>
            </div>
            <div className="border rounded-lg p-4">
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
            </div>
          </div>
        </div>
      )}

      {tab === "customers" && (
        customers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">暂无客户</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
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
          </div>
        )
      )}

      {tab === "checkins" && (
        recentCheckins.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">暂无签到记录</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
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
          </div>
        )
      )}

      {tab === "followUps" && (
        openFollowUps.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">暂无待处理跟进</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
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
          </div>
        )
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="border rounded-lg p-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <div className="text-xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
