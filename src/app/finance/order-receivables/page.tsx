"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, ShoppingBag, FileText, Banknote, AlertCircle, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceKpiCard } from "@/components/finance/finance-kpi-card";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { PaymentStatusBadge } from "@/components/finance/finance-status-badge";
import { useMediaQuery } from "@/hooks/use-media-query";
import Link from "next/link";

interface OrderReceivable {
  id: string;
  orderNo: string;
  title: string;
  customer: { id: string; name: string } | null;
  totalAmount: number;
  invoicedAmount: number;
  receivedAmount: number;
  status: string;
  orderedAt: string | null;
}

export default function OrderReceivablesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!session) {
    router.push("/login");
    return null;
  }

  return <OrderReceivablesContent />;
}

function OrderReceivablesContent() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const isMobile = useMediaQuery("(max-width: 767px)");
  const router = useRouter();

  const { data: orders, isLoading } = useQuery<{
    orders: OrderReceivable[];
    total: number;
    totalPages: number;
    aggregate: {
      totalAmount: number;
      invoiceTotal: number;
      receiptTotal: number;
      unpaidTotal: number;
    };
  }>({
    queryKey: ["order-receivables", search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: String(pageSize), page: String(page) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/finance/order-receivables?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const list = orders?.orders || [];
  const stats = orders?.aggregate;
  const totalAmount = stats?.totalAmount || 0;
  const totalInvoiced = stats?.invoiceTotal || 0;
  const totalReceived = stats?.receiptTotal || 0;
  const unpaidTotal = stats?.unpaidTotal || 0;

  const getPaymentStatus = (o: OrderReceivable) => {
    const unreceived = Math.max(o.invoicedAmount - o.receivedAmount, 0);
    if (o.invoicedAmount === 0) return "UNPAID";
    if (unreceived <= 0) return "PAID";
    return "PARTIAL";
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title="订单应收与回款"
        description="订单维度管理金额、开票、回款与未回款"
        backHref="/finance"
      />

      <div className="grid gap-4 md:grid-cols-4">
        <FinanceKpiCard title="订单金额" value={totalAmount} icon={ShoppingBag} />
        <FinanceKpiCard title="已开票" value={totalInvoiced} icon={FileText} />
        <FinanceKpiCard
          title="已到款"
          value={totalReceived}
          icon={Banknote}
          variant="success"
        />
        <FinanceKpiCard
          title="未到款"
          value={unpaidTotal}
          icon={AlertCircle}
          variant={unpaidTotal > 0 ? "warning" : "default"}
        />
      </div>

      <div className="relative max-w-sm min-w-0 w-full">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索订单号..."
          className="pl-8 w-full"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <>
          {list.length === 0 ? (
            <FinanceEmptyState
              title="暂无订单记录"
              description="没有符合条件的订单。"
            />
          ) : isMobile ? (
            <div className="md:hidden space-y-3">
              {list.map((o) => {
                const unreceived = Math.max(
                  o.invoicedAmount - o.receivedAmount,
                  0
                );
                const payStatus = getPaymentStatus(o);
                return (
                  <FinanceMobileCard
                    key={o.id}
                    title={o.orderNo}
                    badge={<PaymentStatusBadge status={payStatus} />}
                    subtitle={o.customer?.name || "-"}
                    metrics={[
                      { label: "金额", value: <MoneyText value={o.totalAmount} /> },
                      {
                        label: "已开票",
                        value: <MoneyText value={o.invoicedAmount} />,
                      },
                      {
                        label: "已到款",
                        value: (
                          <MoneyText value={o.receivedAmount} tone="income" />
                        ),
                      },
                      {
                        label: "未到款",
                        value: (
                          <MoneyText
                            value={unreceived}
                            tone={unreceived > 0 ? "warning" : "default"}
                          />
                        ),
                      },
                    ]}
                    primaryAction={{
                      label: "查看订单",
                      onClick: () => router.push(`/orders/${o.id}?tab=finance`),
                      icon: <Eye className="h-3.5 w-3.5 mr-1" />,
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <FinanceDataTable
              columns={[
                { key: "orderNo", header: "订单号" },
                { key: "customer", header: "客户", render: (o) => o.customer?.name || "-" },
                {
                  key: "totalAmount",
                  header: "金额",
                  align: "right",
                  money: true,
                },
                {
                  key: "invoicedAmount",
                  header: "已开票",
                  align: "right",
                  money: true,
                },
                {
                  key: "receivedAmount",
                  header: "已到款",
                  align: "right",
                  render: (o) => (
                    <MoneyText value={o.receivedAmount} tone="income" />
                  ),
                },
                {
                  key: "unreceived",
                  header: "未到款",
                  align: "right",
                  render: (o) => {
                    const v = Math.max(o.invoicedAmount - o.receivedAmount, 0);
                    return <MoneyText value={v} tone={v > 0 ? "warning" : "default"} />;
                  },
                },
                {
                  key: "status",
                  header: "状态",
                  align: "center",
                  render: (o) => (
                    <PaymentStatusBadge status={getPaymentStatus(o)} />
                  ),
                },
                {
                  key: "actions",
                  header: "操作",
                  align: "center",
                  render: (o) => (
                    <Link
                      href={`/orders/${o.id}?tab=finance`}
                      className="text-primary hover:underline text-xs"
                    >
                      查看
                    </Link>
                  ),
                },
              ]}
              data={list}
              keyExtractor={(o) => o.id}
              onRowClick={(o) => router.push(`/orders/${o.id}?tab=finance`)}
            />
          )}

          {(orders?.totalPages ?? 0) > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-muted-foreground">共 {orders?.total ?? 0} 条</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                <Button variant="outline" size="sm" disabled={page >= (orders?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
