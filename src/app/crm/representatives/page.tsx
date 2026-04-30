"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmRepresentativeOpsItem } from "@/lib/crm/types";
import Link from "next/link";
import { Search, Users, MapPin, AlertTriangle, Clock } from "lucide-react";

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

  const { data, isLoading } = useQuery<{ representatives: CrmRepresentativeOpsItem[] }>({
    queryKey: [...crmKeys.representativeOps(), search],
    queryFn: () => fetch(`/api/crm/representatives${search ? `?search=${encodeURIComponent(search)}` : ""}`).then((r) => r.json()),
  });

  const reps = data?.representatives || [];

  const totalCustomers = reps.reduce((s, r) => s + r.customerCount, 0);
  const totalCheckins = reps.reduce((s, r) => s + r.visitCheckinCount, 0);
  const totalOverdue = reps.reduce((s, r) => s + r.overdueFollowUps, 0);
  const totalLongUnvisited = reps.reduce((s, r) => s + r.longUnvisitedCount, 0);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">代表运营</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label="总客户数" value={totalCustomers} />
        <StatCard icon={MapPin} label="30天拜访" value={totalCheckins} />
        <StatCard icon={AlertTriangle} label="逾期跟进" value={totalOverdue} />
        <StatCard icon={Clock} label="长期未拜访" value={totalLongUnvisited} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索代表姓名或邮箱..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
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
                <th className="text-right p-3 font-medium">客户数</th>
                <th className="text-right p-3 font-medium hidden sm:table-cell">30天拜访</th>
                <th className="text-right p-3 font-medium hidden sm:table-cell">逾期跟进</th>
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
                  <td className="p-3 text-right font-medium">{r.customerCount}</td>
                  <td className="p-3 text-right hidden sm:table-cell">{r.visitCheckinCount}</td>
                  <td className="p-3 text-right hidden sm:table-cell">
                    <span className={r.overdueFollowUps > 0 ? "text-red-600 font-medium" : ""}>{r.overdueFollowUps}</span>
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
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="border rounded-lg p-4 flex items-center gap-3">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
