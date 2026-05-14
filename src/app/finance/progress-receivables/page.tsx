"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp, FolderKanban, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceKpiCard } from "@/components/finance/finance-kpi-card";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getOrderCategoryLabel } from "@/lib/order-labels";

export default function ProgressReceivablesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  if (status === "loading") return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <ProgressContent />
    </Suspense>
  );
}

function ProgressContent() {
  const searchParams = useSearchParams();
  const period = searchParams.get("period") || "week";
  const [filter, setFilter] = useState("ALL");
  const isMobile = useMediaQuery("(max-width: 767px)");
  const router = useRouter();

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

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const projectItems = (data?.projectItems || []).filter((i) =>
    filter === "ALL" || i.eventType === filter
  );
  const orderItems = (data?.orderItems || []).filter((i) =>
    filter === "ALL" || i.eventType === filter || (filter === "SERVICE" && String(i.eventType).startsWith("SERVICE")) || (filter === "PRODUCT" && String(i.eventType).startsWith("PRODUCT"))
  );

  const filterOptions = [
    { value: "ALL", label: "全部" },
    { value: "SERVICE_START", label: "服务立项(30%)" },
    { value: "SERVICE_COMPLETED", label: "服务结项(70%)" },
    { value: "PRODUCT_START", label: "商品立项(100%)" },
    { value: "PRODUCT_ORDER", label: "商品订单(100%)" },
    { value: "SERVICE_ORDER_DEPOSIT", label: "服务订单(30%)" },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title={`${period === "month" ? "本月" : "本周"}进度款明细`}
        backHref="/finance"
        actions={
          <div className="flex gap-2">
            <Badge variant={period === "week" ? "default" : "outline"} className="cursor-pointer" onClick={() => router.push("?period=week")}>本周</Badge>
            <Badge variant={period === "month" ? "default" : "outline"} className="cursor-pointer" onClick={() => router.push("?period=month")}>本月</Badge>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <FinanceKpiCard title="进度款总额" value={data?.total ?? 0} icon={TrendingUp} />
        <FinanceKpiCard title="服务立项(30%)" value={data?.serviceDeposit ?? 0} icon={FolderKanban} />
        <FinanceKpiCard title="服务结项(70%)" value={data?.serviceFinal ?? 0} icon={FolderKanban} />
        <FinanceKpiCard title="商品项目(100%)" value={data?.productReceivable ?? 0} icon={ShoppingBag} />
      </div>

      <div>
        <select className="text-sm border rounded px-2 py-1 bg-background" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {filterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <h2 className="text-lg font-semibold">项目进度款</h2>
      {projectItems.length === 0 ? (
        <FinanceEmptyState title="暂无项目进度款" />
      ) : isMobile ? (
        <div className="md:hidden space-y-3">
          {projectItems.map((item, i) => (
            <FinanceMobileCard
              key={i}
              title={String(item.projectName)}
              badge={
                <Badge variant="outline">
                  {item.eventType === "SERVICE_START" ? "服务立项" :
                   item.eventType === "SERVICE_COMPLETED" ? "服务结项" :
                   item.eventType === "PRODUCT_START" ? "商品立项" : String(item.eventType)}
                </Badge>
              }
              subtitle={String(item.customerName || "-")}
              metrics={[
                { label: "预算", value: <MoneyText value={Number(item.budgetAmount)} compact /> },
                { label: "进度款", value: <MoneyText value={Number(item.receivableAmount)} compact /> },
                { label: "比例", value: `${Math.round(Number(item.rate) * 100)}%` },
                { label: "日期", value: new Date(String(item.eventDate)).toLocaleDateString("zh-CN") },
              ]}
            />
          ))}
        </div>
      ) : (
        <FinanceDataTable
          columns={[
            { key: "projectName", header: "项目", render: (item) => String(item.projectName) },
            { key: "customerName", header: "客户", render: (item) => String(item.customerName || "-") },
            { key: "eventType", header: "类型", align: "center", render: (item) => (
              <Badge variant="outline">
                {item.eventType === "SERVICE_START" ? "服务立项" :
                 item.eventType === "SERVICE_COMPLETED" ? "服务结项" :
                 item.eventType === "PRODUCT_START" ? "商品立项" : String(item.eventType)}
              </Badge>
            )},
            { key: "eventDate", header: "日期", render: (item) => new Date(String(item.eventDate)).toLocaleDateString("zh-CN") },
            { key: "budgetAmount", header: "预算", align: "right", render: (item) => <MoneyText value={Number(item.budgetAmount)} /> },
            { key: "receivableAmount", header: "进度款", align: "right", render: (item) => <MoneyText value={Number(item.receivableAmount)} /> },
            { key: "rate", header: "比例", align: "center", render: (item) => `${Math.round(Number(item.rate) * 100)}%` },
          ]}
          data={projectItems}
          keyExtractor={(_, i) => `p-${i}`}
        />
      )}

      <h2 className="text-lg font-semibold mt-6">独立订单进度款</h2>
      {orderItems.length === 0 ? (
        <FinanceEmptyState title="暂无独立订单进度款" />
      ) : isMobile ? (
        <div className="md:hidden space-y-3">
          {orderItems.map((item, i) => (
            <FinanceMobileCard
              key={i}
              title={String(item.orderNo || item.externalOrderNo)}
              badge={
                <Badge variant="outline">
                  {item.eventType === "PRODUCT_ORDER" ? "商品订单" : "服务订单(30%)"}
                </Badge>
              }
              subtitle={String(item.customerName || "-")}
              metrics={[
                { label: "金额", value: <MoneyText value={Number(item.amount)} compact /> },
                { label: "进度款", value: <MoneyText value={Number(item.receivableAmount)} compact /> },
                { label: "比例", value: `${Math.round(Number(item.rate) * 100)}%` },
                { label: "日期", value: new Date(String(item.eventDate)).toLocaleDateString("zh-CN") },
              ]}
            />
          ))}
        </div>
      ) : (
        <FinanceDataTable
          columns={[
            { key: "orderNo", header: "订单号", render: (item) => String(item.orderNo || item.externalOrderNo) },
            { key: "customerName", header: "客户", render: (item) => String(item.customerName || "-") },
            { key: "financeCategory", header: "分类", align: "center", render: (item) => <Badge variant="outline">{getOrderCategoryLabel(String(item.financeCategory))}</Badge> },
            { key: "eventType", header: "类型", align: "center", render: (item) => (
              <Badge variant="outline">{item.eventType === "PRODUCT_ORDER" ? "商品订单" : "服务订单(30%)"}</Badge>
            )},
            { key: "eventDate", header: "日期", render: (item) => new Date(String(item.eventDate)).toLocaleDateString("zh-CN") },
            { key: "amount", header: "金额", align: "right", render: (item) => <MoneyText value={Number(item.amount)} /> },
            { key: "receivableAmount", header: "进度款", align: "right", render: (item) => <MoneyText value={Number(item.receivableAmount)} /> },
            { key: "rate", header: "比例", align: "center", render: (item) => `${Math.round(Number(item.rate) * 100)}%` },
          ]}
          data={orderItems}
          keyExtractor={(_, i) => `o-${i}`}
        />
      )}
    </div>
  );
}
