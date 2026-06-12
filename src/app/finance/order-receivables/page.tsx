"use client";

import { useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, ShoppingBag, FileText, Banknote, AlertCircle, Eye, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceKpiCard } from "@/components/finance/finance-kpi-card";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { PaymentStatusBadge } from "@/components/finance/finance-status-badge";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PaymentVoucherWizard } from "@/components/finance/payment-voucher-wizard";
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

type ViewFilter = "all" | "uninvoiced" | "invoiced_unpaid" | "paid";

const VIEW_LABELS: Record<ViewFilter, string> = {
  all: "全部",
  uninvoiced: "待申请开票",
  invoiced_unpaid: "已开票未回款",
  paid: "已回款",
};

const VIEW_EMPTY: Record<ViewFilter, { title: string; description: string }> = {
  all: { title: "暂无订单记录", description: "没有符合条件的订单。" },
  uninvoiced: { title: "暂无待申请开票的订单", description: "所有订单均已开票或暂无订单。" },
  invoiced_unpaid: { title: "暂无已开票未回款的订单", description: "所有已开票订单均已回款或暂无订单。" },
  paid: { title: "暂无已回款的订单", description: "暂无已完成回款的订单。" },
};

export default function OrderReceivablesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    }>
      <OrderReceivablesInner />
    </Suspense>
  );
}

function OrderReceivablesInner() {
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
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [voucherWizardOpen, setVoucherWizardOpen] = useState(false);
  const pageSize = 50;
  const isMobile = useMediaQuery("(max-width: 767px)");

  const VALID_VIEWS: ViewFilter[] = ["all", "uninvoiced", "invoiced_unpaid", "paid"];
  const rawView = searchParams.get("view") as ViewFilter | null;
  const view: ViewFilter = rawView && VALID_VIEWS.includes(rawView) ? rawView : "all";

  const setView = (v: ViewFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "all") {
      params.delete("view");
    } else {
      params.set("view", v);
    }
    params.delete("page");
    router.push(`/finance/order-receivables?${params.toString()}`);
    setPage(1);
  };

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
    queryKey: ["order-receivables", search, page, view],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: String(pageSize), page: String(page) });
      if (search) params.set("search", search);
      if (view !== "all") params.set("view", view);
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
        title="应收回款工作台"
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

      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-sm min-w-0 w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索订单号..."
              className="pl-8 w-full"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          {(session?.user?.role === "ADMIN" || session?.user?.role === "USER") && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setVoucherWizardOpen(true)}
            >
              <Receipt className="h-4 w-4 mr-1" />
              凭证匹配
            </Button>
          )}
        </div>

        <Tabs value={view} onValueChange={(v) => setView(v as ViewFilter)}>
          <TabsList>
            {(Object.keys(VIEW_LABELS) as ViewFilter[]).map((v) => (
              <TabsTrigger key={v} value={v}>
                {VIEW_LABELS[v]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <>
          {list.length === 0 ? (
            <FinanceEmptyState
              title={VIEW_EMPTY[view].title}
              description={VIEW_EMPTY[view].description}
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
      <PaymentVoucherWizard
        open={voucherWizardOpen}
        onOpenChange={setVoucherWizardOpen}
      />
    </div>
  );
}
