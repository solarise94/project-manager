"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X, Plus, Search, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { InvoiceStatusBadge } from "@/components/finance/finance-status-badge";
import { useMediaQuery } from "@/hooks/use-media-query";
import Link from "next/link";

interface InvoiceItem {
  id: string;
  status: string;
  buyerOrganizationName: string | null;
  orderId: string | null;
  order: { orderNo: string } | null;
  project: { name: string } | null;
  totalAmount: number;
  invoiceType: string;
  actualInvoiceNo: string | null;
  createdAt: string;
}

export default function InvoicesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <InvoicesContent />
    </Suspense>
  );
}

function InvoicesContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const orderId = searchParams.get("orderId");
  const isMobile = useMediaQuery("(max-width: 767px)");

  const p = new URLSearchParams();
  if (search) p.set("search", search);
  if (tab !== "all") p.set("status", tab.toUpperCase());
  p.set("pageSize", String(pageSize));
  p.set("page", String(page));
  if (orderId) p.set("orderId", orderId);

  const { data: orderData, isLoading } = useQuery<{
    invoices: InvoiceItem[];
    total: number;
  }>({
    queryKey: ["finance", "all-invoices", "order", search, tab, orderId, page],
    queryFn: () =>
      fetch(`/api/finance/order-invoices?${p.toString()}`).then((r) =>
        r.ok ? r.json() : { invoices: [], total: 0 }
      ),
  });

  if (status === "loading")
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  if (!session) {
    router.push("/login");
    return null;
  }
  if (session.user.role === "REPRESENTATIVE") {
    router.push("/dashboard");
    return null;
  }

  const invoices = orderData?.invoices || [];

  const isHistorical = (inv: InvoiceItem) => !inv.orderId && inv.project;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
      <FinancePageHeader
        title="订单发票工作台"
        description="查询和处理订单发票"
        backHref="/finance"
      />

      {orderId && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          <span>当前仅查看该订单的发票</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => router.push("/finance/invoices")}
          >
            <X className="h-3 w-3 mr-1" />
            清除筛选
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative max-w-sm min-w-0 w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索发票..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8"
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="draft">草稿</TabsTrigger>
            <TabsTrigger value="requested">已申请</TabsTrigger>
            <TabsTrigger value="issued">已开具</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        <FinanceEmptyState
          title={orderId ? "该订单暂无发票" : "暂无发票记录"}
          description="请进入订单详情页创建订单发票。"
          action={
            orderId ? (
              <Link href={`/orders/${orderId}?tab=finance&action=invoice`}>
                <Button size="sm">
                  <Plus className="h-3 w-3 mr-1" />
                  返回订单财务页新建
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : isMobile ? (
        <div className="md:hidden space-y-3">
          {invoices.map((inv) => (
            <FinanceMobileCard
              key={inv.id}
              title={
                inv.buyerOrganizationName ||
                inv.order?.orderNo ||
                "未命名"
              }
              badge={
                <div className="flex items-center gap-1">
                  <InvoiceStatusBadge status={inv.status} />
                  {isHistorical(inv) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground">
                      历史
                    </span>
                  )}
                </div>
              }
              metrics={[
                {
                  label: "金额",
                  value: <MoneyText value={inv.totalAmount} />,
                },
                {
                  label: "类型",
                  value: inv.invoiceType === "SPECIAL" ? "专票" : "普票",
                },
              ]}
              subtitle={
                <div className="space-y-0.5">
                  {inv.order?.orderNo && (
                    <p>订单：{inv.order.orderNo}</p>
                  )}
                  <p>
                    {new Date(inv.createdAt).toLocaleDateString("zh-CN")}
                  </p>
                </div>
              }
              primaryAction={
                inv.orderId
                  ? {
                      label: "查看订单",
                      onClick: () =>
                        router.push(`/orders/${inv.orderId}?tab=finance`),
                      icon: <Eye className="h-3.5 w-3.5 mr-1" />,
                    }
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <FinanceDataTable
          columns={[
            {
              key: "status",
              header: "状态",
              align: "center",
              render: (inv) => (
                <div className="flex items-center justify-center gap-1">
                  <InvoiceStatusBadge status={inv.status} />
                  {isHistorical(inv) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground">
                      历史
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "buyerOrganizationName",
              header: "购方单位",
              render: (inv) =>
                inv.buyerOrganizationName || "-",
            },
            {
              key: "orderNo",
              header: "订单号",
              render: (inv) => inv.order?.orderNo || "-",
            },
            {
              key: "totalAmount",
              header: "金额",
              align: "right",
              money: true,
            },
            {
              key: "invoiceType",
              header: "发票类型",
              align: "center",
              render: (inv) =>
                inv.invoiceType === "SPECIAL" ? "专票" : "普票",
            },
            {
              key: "actualInvoiceNo",
              header: "实际发票号",
              render: (inv) => inv.actualInvoiceNo || "-",
            },
            {
              key: "createdAt",
              header: "创建时间",
              render: (inv) =>
                new Date(inv.createdAt).toLocaleDateString("zh-CN"),
            },
            {
              key: "actions",
              header: "操作",
              align: "center",
              render: (inv) =>
                inv.orderId ? (
                  <Link
                    href={`/orders/${inv.orderId}?tab=finance`}
                    className="text-primary hover:underline text-xs"
                  >
                    查看订单
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">-</span>
                ),
            },
          ]}
          data={invoices}
          keyExtractor={(inv) => inv.id}
        />
      )}

      {(orderData?.total ?? 0) > pageSize && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">共 {orderData?.total} 条</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= Math.ceil((orderData?.total ?? 0) / pageSize)} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
