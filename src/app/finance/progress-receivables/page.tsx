"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/finance/stat-card";
import { FolderKanban, ShoppingBag, TrendingUp } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";

export default function ProgressReceivablesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  if (status === "loading") return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }
  return <ProgressContent />;
}

function ProgressContent() {
  const searchParams = useSearchParams();
  const period = searchParams.get("period") || "week";
  const [filter, setFilter] = useState("ALL");
  const isMobile = useMediaQuery("(max-width: 767px)");

  const { data, isLoading } = useQuery({
    queryKey: ["finance", "progress-receivables", period],
    queryFn: async () => {
      const res = await fetch(`/api/finance/progress-receivables?period=${period}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<{
        period: string; total: number;
        serviceDeposit: number; serviceFinal: number; productReceivable: number;
        projectItems: Array<Record<string, unknown>>;
        orderItems: Array<Record<string, unknown>>;
      }>;
    },
  });

  const router = useRouter();

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const projectItems = (data?.projectItems || []).filter((i) =>
    filter === "ALL" || i.eventType === filter
  );
  const orderItems = (data?.orderItems || []).filter((i) =>
    filter === "ALL" || i.eventType === filter || (filter === "SERVICE" && String(i.eventType).startsWith("SERVICE")) || (filter === "PRODUCT" && String(i.eventType).startsWith("PRODUCT"))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{period === "month" ? "本月" : "本周"}进度款明细</h1>
        <div className="flex gap-2">
          <Badge variant={period === "week" ? "default" : "outline"} className="cursor-pointer" onClick={() => router.push("?period=week")}>本周</Badge>
          <Badge variant={period === "month" ? "default" : "outline"} className="cursor-pointer" onClick={() => router.push("?period=month")}>本月</Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="进度款总额" value={data?.total ?? 0} icon={TrendingUp} />
        <StatCard title="服务立项(30%)" value={data?.serviceDeposit ?? 0} icon={FolderKanban} />
        <StatCard title="服务结项(70%)" value={data?.serviceFinal ?? 0} icon={FolderKanban} />
        <StatCard title="商品项目(100%)" value={data?.productReceivable ?? 0} icon={ShoppingBag} />
      </div>

      <div>
        <select className="text-sm border rounded px-2 py-1" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">全部</option>
          <option value="SERVICE_START">服务立项(30%)</option>
          <option value="SERVICE_COMPLETED">服务结项(70%)</option>
          <option value="PRODUCT_START">商品项目(100%)</option>
          <option value="PRODUCT_ORDER">商品订单(100%)</option>
          <option value="SERVICE_ORDER_DEPOSIT">服务订单(30%)</option>
        </select>
      </div>

      <h2 className="text-lg font-semibold mt-4">项目进度款</h2>
      {isMobile ? (
        <div className="md:hidden space-y-3">
          {projectItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">暂无数据</p>
          ) : projectItems.map((item, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{String(item.projectName)}</span>
                  <Badge variant="outline" className="shrink-0 whitespace-nowrap">
                    {item.eventType === "SERVICE_START" ? "服务立项" :
                     item.eventType === "SERVICE_COMPLETED" ? "服务结项" :
                     item.eventType === "PRODUCT_START" ? "商品立项" : String(item.eventType)}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">{String(item.customerName || "-")}</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{new Date(String(item.eventDate)).toLocaleDateString("zh-CN")}</span>
                  <span className="font-medium">{Math.round(Number(item.rate) * 100)}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">预算 {Number(item.budgetAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                  <span className="font-medium">进度款 {Number(item.receivableAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 px-2">项目</th>
                <th className="text-left py-2 px-2">客户</th>
                <th className="text-center py-2 px-2">类型</th>
                <th className="text-left py-2 px-2">日期</th>
                <th className="text-right py-2 px-2">预算</th>
                <th className="text-right py-2 px-2">进度款</th>
                <th className="text-center py-2 px-2">比例</th>
              </tr>
            </thead>
            <tbody>
              {projectItems.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">暂无数据</td></tr>
              ) : projectItems.map((item, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 px-2 font-medium">{String(item.projectName)}</td>
                  <td className="py-2 px-2 text-muted-foreground">{String(item.customerName || "-")}</td>
                  <td className="py-2 px-2 text-center">
                    <Badge variant="outline">
                      {item.eventType === "SERVICE_START" ? "服务立项" :
                       item.eventType === "SERVICE_COMPLETED" ? "服务结项" :
                       item.eventType === "PRODUCT_START" ? "商品立项" : String(item.eventType)}
                    </Badge>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{new Date(String(item.eventDate)).toLocaleDateString("zh-CN")}</td>
                  <td className="py-2 px-2 text-right">{Number(item.budgetAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-2 text-right font-medium">{Number(item.receivableAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-2 text-center">{Math.round(Number(item.rate) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-lg font-semibold mt-6">独立订单进度款</h2>
      {isMobile ? (
        <div className="md:hidden space-y-3">
          {orderItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">暂无数据</p>
          ) : orderItems.map((item, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="font-mono text-xs truncate">{String(item.externalOrderNo)}</span>
                  <Badge variant="outline" className="shrink-0 whitespace-nowrap">
                    {item.eventType === "PRODUCT_ORDER" ? "商品订单" : "服务订单(30%)"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">{String(item.customerName || "-")}</div>
                <div className="text-xs text-muted-foreground">分类: {String(item.financeCategory)}</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{new Date(String(item.eventDate)).toLocaleDateString("zh-CN")}</span>
                  <span className="font-medium">{Math.round(Number(item.rate) * 100)}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">金额 {Number(item.amount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                  <span className="font-medium">进度款 {Number(item.receivableAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 px-2">订单号</th>
                <th className="text-left py-2 px-2">客户</th>
                <th className="text-center py-2 px-2">分类</th>
                <th className="text-center py-2 px-2">类型</th>
                <th className="text-left py-2 px-2">日期</th>
                <th className="text-right py-2 px-2">金额</th>
                <th className="text-right py-2 px-2">进度款</th>
                <th className="text-center py-2 px-2">比例</th>
              </tr>
            </thead>
            <tbody>
              {orderItems.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">暂无数据</td></tr>
              ) : orderItems.map((item, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 px-2 font-mono text-xs">{String(item.externalOrderNo)}</td>
                  <td className="py-2 px-2 text-muted-foreground">{String(item.customerName || "-")}</td>
                  <td className="py-2 px-2 text-center"><Badge variant="outline">{String(item.financeCategory)}</Badge></td>
                  <td className="py-2 px-2 text-center">
                    <Badge variant="outline">{item.eventType === "PRODUCT_ORDER" ? "商品订单" : "服务订单(30%)"}</Badge>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{new Date(String(item.eventDate)).toLocaleDateString("zh-CN")}</td>
                  <td className="py-2 px-2 text-right">{Number(item.amount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-2 text-right font-medium">{Number(item.receivableAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 px-2 text-center">{Math.round(Number(item.rate) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import React from "react";
