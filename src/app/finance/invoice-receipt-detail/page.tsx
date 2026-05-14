"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { FinanceDataTable } from "@/components/finance/finance-data-table";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { Badge } from "@/components/ui/badge";
import { useMediaQuery } from "@/hooks/use-media-query";
import Link from "next/link";

interface ReceiptItem {
  id: string;
  amount: number;
  receivedAt: string;
  source: string;
  remark: string | null;
  customer: { id: string; name: string } | null;
  order: { id: string; orderNo: string } | null;
  createdBy: { id: string; name: string } | null;
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "人工录入",
  PINGOODMICE_ORDER: "拼好鼠订单",
  BANK: "银行转账",
  OTHER: "其他",
};

export default function InvoiceReceiptDetailPage() {
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
  if (session.user.role === "REPRESENTATIVE") {
    router.push("/dashboard");
    return null;
  }

  return <InvoiceReceiptDetailContent />;
}

function InvoiceReceiptDetailContent() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const isMobile = useMediaQuery("(max-width: 767px)");

  const { data, isLoading } = useQuery<{
    receipts: ReceiptItem[];
    total: number;
  }>({
    queryKey: ["finance", "receipts", search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/finance/receipts?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const receipts = data?.receipts || [];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title="订单回款流水"
        description="发票与回款流水查询（仅查询，新增回款请从订单详情页操作）"
        backHref="/finance"
      />

      <div className="relative max-w-sm min-w-0 w-full">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索客户/订单号/外部订单号..."
          className="pl-8 w-full"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : receipts.length === 0 ? (
        <FinanceEmptyState
          title="暂无到款记录"
          description="暂无符合条件的回款流水。"
        />
      ) : isMobile ? (
        <div className="md:hidden space-y-3">
          {receipts.map((r) => (
            <FinanceMobileCard
              key={r.id}
              title={
                <MoneyText value={r.amount} tone="income" />
              }
              badge={
                <Badge variant="outline">
                  {SOURCE_LABELS[r.source] || r.source}
                </Badge>
              }
              subtitle={
                <div className="space-y-0.5">
                  <p>到款日期：{new Date(r.receivedAt).toLocaleDateString("zh-CN")}</p>
                  <p>客户：{r.customer?.name || "-"}</p>
                  <p>订单：{r.order?.orderNo || "-"}</p>
                  {r.remark && <p>备注：{r.remark}</p>}
                </div>
              }
              primaryAction={
                r.order
                  ? {
                      label: "查看订单",
                      onClick: () =>
                        router.push(`/orders/${r.order!.id}?tab=finance`),
                      icon: <Eye className="h-3.5 w-3.5 mr-1" />,
                    }
                  : undefined
              }
              moreActions={
                r.customer
                  ? [
                      {
                        label: "查看客户",
                        onClick: () =>
                          router.push(`/finance/customers/${r.customer!.id}`),
                      },
                    ]
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <FinanceDataTable
          columns={[
            {
              key: "receivedAt",
              header: "到款日期",
              render: (r) =>
                new Date(r.receivedAt).toLocaleDateString("zh-CN"),
            },
            {
              key: "orderNo",
              header: "订单号",
              render: (r) => r.order?.orderNo || "-",
            },
            {
              key: "customer",
              header: "客户",
              render: (r) => r.customer?.name || "-",
            },
            {
              key: "amount",
              header: "金额",
              align: "right",
              render: (r) => <MoneyText value={r.amount} tone="income" />,
            },
            {
              key: "source",
              header: "来源",
              align: "center",
              render: (r) => (
                <Badge variant="outline">
                  {SOURCE_LABELS[r.source] || r.source}
                </Badge>
              ),
            },
            {
              key: "createdBy",
              header: "创建人",
              align: "center",
              render: (r) => r.createdBy?.name || "-",
            },
            {
              key: "remark",
              header: "备注",
              render: (r) => r.remark || "-",
            },
            {
              key: "actions",
              header: "操作",
              align: "center",
              render: (r) => (
                <div className="flex items-center justify-center gap-2">
                  {r.order && (
                    <Link
                      href={`/orders/${r.order.id}?tab=finance`}
                      className="text-primary hover:underline text-xs"
                    >
                      查看订单
                    </Link>
                  )}
                  {r.customer && (
                    <Link
                      href={`/finance/customers/${r.customer.id}`}
                      className="text-primary hover:underline text-xs"
                    >
                      查看客户
                    </Link>
                  )}
                </div>
              ),
            },
          ]}
          data={receipts}
          keyExtractor={(r) => r.id}
        />
      )}

      {data && data.total > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            共 {data.total} 条
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= Math.ceil(data.total / pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
