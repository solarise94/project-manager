"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShoppingBag, FileText, Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceKpiCard } from "@/components/finance/finance-kpi-card";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { LegacyFinanceBanner } from "@/components/finance/legacy-finance-banner";
import { MatchStatusBadge } from "@/components/finance/finance-status-badge";
import type { CustomerFinanceDetail } from "@/lib/finance/types";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import Link from "next/link";

export default function CustomerFinanceDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return <CustomerFinanceDetail />;
}

function CustomerFinanceDetail() {
  const params = useParams();
  const customerId = params.customerId as string;
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [activeTab, setActiveTab] = useState("orders");

  const { data, isLoading } = useQuery<CustomerFinanceDetail>({
    queryKey: ["finance", "customer", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/finance/customers/${customerId}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <FinanceEmptyState title="客户不存在" />
      </div>
    );
  }

  const tabs = [
    { value: "orders", label: "订单" },
    { value: "invoices", label: "开票" },
    { value: "receipts", label: "到款" },
    { value: "projects", label: "项目" },
  ];

  const outstanding = data.summary.receivableAmount - data.summary.totalReceiptAmount;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title={data.customer.name}
        description={`${data.customer.customerCode}${data.customer.organization ? ` · ${data.customer.organization}` : ""}`}
        backHref="/finance/customers"
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <FinanceKpiCard
          title="平台订单额"
          value={data.summary.onlineOrderTotal}
          icon={ShoppingBag}
        />
        <FinanceKpiCard
          title="已开票"
          value={data.summary.projectInvoicedAmount + data.summary.orderInvoicedAmount}
          icon={FileText}
        />
        <FinanceKpiCard
          title="已回款"
          value={data.summary.totalReceiptAmount}
          icon={Banknote}
          variant="success"
        />
        <FinanceKpiCard
          title="应收余额"
          value={outstanding}
          icon={ShoppingBag}
          variant={outstanding > 0 ? "warning" : "default"}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {isMobile ? (
          <Select value={activeTab} onValueChange={(v) => v && setActiveTab(v)}>
            <SelectTrigger className="w-full"><SelectDisplay label="标签页" valueLabel={tabs.find(t => t.value === activeTab)?.label} /></SelectTrigger>
            <SelectContent>
              {tabs.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <TabsList className="w-full sm:w-auto">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        )}

        {/* Orders tab */}
        <TabsContent value="orders" className="mt-4">
          {data.onlineOrders.length === 0 ? (
            <FinanceEmptyState title="暂无订单" />
          ) : (
            <FinanceDataTable
              columns={[
                { key: "orderNo", header: "订单号" },
                { key: "totalAmount", header: "金额", align: "right", money: true },
                { key: "orderedAt", header: "日期", render: (o) => o.orderedAt ? new Date(o.orderedAt).toLocaleDateString("zh-CN") : "-" },
                { key: "customerMatchStatus", header: "匹配", align: "center", render: (o) => <MatchStatusBadge status={o.customerMatchStatus} /> },
                { key: "financeTreatment", header: "计入方式", align: "center", render: (o) => (
                  <Badge variant={o.financeTreatment === "STANDALONE" ? "default" : o.financeTreatment === "PROJECT_INCLUDED" ? "secondary" : o.financeTreatment === "EXCLUDED" ? "destructive" : "outline"}>
                    {o.financeTreatment === "AUTO" ? "自动" : o.financeTreatment === "STANDALONE" ? "独立计入" : o.financeTreatment === "PROJECT_INCLUDED" ? "并入项目" : o.financeTreatment === "EXCLUDED" ? "排除" : o.financeTreatment}
                  </Badge>
                )},
                {
                  key: "actions",
                  header: "操作",
                  align: "center",
                  render: (o) => (
                    <Link href={`/orders/${o.id}?tab=finance`} className="text-primary hover:underline text-xs">
                      查看
                    </Link>
                  ),
                },
              ]}
              data={data.onlineOrders}
              keyExtractor={(o) => o.id}
              onRowClick={(o) => router.push(`/orders/${o.id}?tab=finance`)}
            />
          )}
        </TabsContent>

        {/* Invoices tab */}
        <TabsContent value="invoices" className="mt-4">
          <div className="space-y-4">
            <LegacyFinanceBanner message="历史项目发票已停用新建。新开票请从订单详情页操作。" />
            {[...data.projectInvoices, ...data.orderInvoices].length === 0 ? (
              <FinanceEmptyState title="暂无开票记录" />
            ) : (
              <FinanceDataTable
                columns={[
                  { key: "type", header: "类型", render: (_i, idx) => idx < data.projectInvoices.length ? "项目发票" : "订单发票" },
                  { key: "totalAmount", header: "金额", align: "right", money: true },
                  {
                    key: "status",
                    header: "状态",
                    align: "center",
                    render: (inv) => (
                      <Badge variant={inv.status === "ISSUED" ? "default" : inv.status === "CANCELLED" ? "destructive" : "outline"}>
                        {inv.status === "ISSUED" ? "已开票" : inv.status === "DRAFT" ? "草稿" : inv.status === "REQUESTED" ? "已申请" : inv.status}
                      </Badge>
                    ),
                  },
                  { key: "createdAt", header: "日期", render: (inv) => new Date(inv.createdAt).toLocaleDateString("zh-CN") },
                ]}
                data={[...data.projectInvoices, ...data.orderInvoices]}
                keyExtractor={(inv) => inv.id}
              />
            )}
          </div>
        </TabsContent>

        {/* Receipts tab */}
        <TabsContent value="receipts" className="mt-4">
          {data.receipts.length === 0 ? (
            <FinanceEmptyState title="暂无到款记录" />
          ) : (
            <FinanceDataTable
              columns={[
                { key: "amount", header: "金额", align: "right", render: (r) => <MoneyText value={r.amount} tone="income" /> },
                { key: "receivedAt", header: "到款日期", render: (r) => new Date(r.receivedAt).toLocaleDateString("zh-CN") },
                { key: "source", header: "来源", align: "center", render: (r) => <Badge variant="outline">{r.source}</Badge> },
                { key: "remark", header: "备注", render: (r) => r.remark || "-" },
              ]}
              data={data.receipts}
              keyExtractor={(r) => r.id}
            />
          )}
        </TabsContent>

        {/* Projects tab */}
        <TabsContent value="projects" className="mt-4">
          <div className="space-y-4">
            <LegacyFinanceBanner message="项目相关财务已迁移到订单维度。项目信息仅做参考。" />
            {data.projects.length === 0 ? (
              <FinanceEmptyState title="暂无项目" />
            ) : (
              <FinanceDataTable
                columns={[
                  { key: "name", header: "项目名称" },
                  { key: "budgetAmount", header: "预算金额", align: "right", render: (p) => <MoneyText value={p.budgetAmount || 0} /> },
                  { key: "status", header: "状态", align: "center", render: (p) => <Badge variant="outline">{p.status}</Badge> },
                  { key: "progress", header: "进度", align: "center", render: (p) => `${p.progress}%` },
                ]}
                data={data.projects}
                keyExtractor={(p) => p.id}
                onRowClick={(p) => router.push(`/projects/${p.id}`)}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
