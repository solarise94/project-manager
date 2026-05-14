"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  FolderKanban,
  FileText,
  Banknote,
  CreditCard,
  Loader2,
  Users,
  Link2,
  Receipt,
  TrendingUp,
  Calendar,
  Building2,
  Store,
  History,
  Upload,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FinanceKpiCard } from "@/components/finance/finance-kpi-card";
import { MoneyText } from "@/components/finance/money-text";
import type { FinanceSummary } from "@/lib/finance/types";
import Link from "next/link";

export default function FinancePage() {
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

  return <FinanceDashboard />;
}

function FinanceDashboard() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const { data, isLoading } = useQuery<FinanceSummary>({
    queryKey: ["finance", "summary"],
    queryFn: async () => {
      const res = await fetch("/api/finance/summary");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const summary = data;
  const totalInvoiced =
    (summary?.projectInvoicedAmount ?? 0) +
    (summary?.orderInvoicedAmount ?? 0);
  const totalReceipt = summary?.totalReceiptAmount ?? 0;
  const outstanding = totalInvoiced - totalReceipt;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">财务工作台</h1>
          <p className="text-sm text-muted-foreground mt-1">
            订单维度管理开票、回款、成本与垫付
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/orders/import/pingoodmice">
            <Button size="sm" variant="outline">
              <Upload className="h-4 w-4 mr-1" />
              导入订单
            </Button>
          </Link>
          <Link href="/finance/order-receivables">
            <Button size="sm" variant="outline">
              <CreditCard className="h-4 w-4 mr-1" />
              订单应收
            </Button>
          </Link>
          <Link href="/finance/invoices">
            <Button size="sm" variant="outline">
              <FileText className="h-4 w-4 mr-1" />
              发票工作台
            </Button>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <FinanceKpiCard
          title="有效业务额"
          value={summary?.effectiveBusinessAmount ?? 0}
          icon={FolderKanban}
          description={`项目 + 独立订单`}
        />
        <FinanceKpiCard
          title="已开票"
          value={totalInvoiced}
          icon={FileText}
          description={`待处理 ${summary?.pendingInvoiceCount ?? 0} 笔`}
        />
        <FinanceKpiCard
          title="已回款"
          value={totalReceipt}
          icon={Banknote}
          description={`${summary?.receiptCount ?? 0} 笔记录`}
          variant="success"
        />
        <FinanceKpiCard
          title="未回款"
          value={Math.max(outstanding, 0)}
          icon={AlertCircle}
          variant={outstanding > 0 ? "warning" : "default"}
        />
        <FinanceKpiCard
          title="成本"
          value={summary?.costAmount ?? 0}
          icon={Receipt}
          variant="muted"
        />
        <FinanceKpiCard
          title="利润"
          value={summary?.profitAmount ?? 0}
          icon={TrendingUp}
          variant={
            (summary?.profitAmount ?? 0) < 0
              ? "danger"
              : (summary?.profitAmount ?? 0) > 0
                ? "success"
                : "default"
          }
          description={
            summary?.profitRate != null
              ? `利润率 ${(summary.profitRate * 100).toFixed(1)}%`
              : "暂无回款数据"
          }
        />
      </div>

      {/* Pending queues */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          待处理事项
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/finance/order-matching?tab=unmatched">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer border-l-4 border-l-amber-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">待匹配订单</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      未匹配{" "}
                      <MoneyText
                        value={summary?.unmatchedOnlineOrderAmount ?? 0}
                        compact
                      />
                    </p>
                  </div>
                  <Link2 className="h-6 w-6 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/order-receivables">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">待申请开票</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      查看未开票订单
                    </p>
                  </div>
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/order-receivables">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer border-l-4 border-l-red-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">已开票未回款</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      跟踪未到账款项
                    </p>
                  </div>
                  <AlertCircle className="h-6 w-6 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Main entries */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">功能入口</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/finance/order-receivables">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">订单应收与回款</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      订单维度：金额、开票、回款、未回款
                    </p>
                  </div>
                  <CreditCard className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/invoices">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">订单发票工作台</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      订单开票、合并开票、发票上传、状态跟踪
                    </p>
                  </div>
                  <FileText className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/order-matching">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">订单匹配与开票辅助</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      未匹配{" "}
                      <MoneyText
                        value={summary?.unmatchedOnlineOrderAmount ?? 0}
                        compact
                      />{" "}
                      · 扫描绑定客户
                    </p>
                  </div>
                  <Link2 className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/costs">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">成本管理</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      采购/实验/人工成本
                    </p>
                  </div>
                  <Receipt className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/customers">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">客户财务看板</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {summary?.customerCount ?? 0} 个客户 · 按客户聚合
                    </p>
                  </div>
                  <Users className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Secondary entries */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">查询</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/finance/invoice-receipt-detail">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">回款流水</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      发票与回款流水查询
                    </p>
                  </div>
                  <Banknote className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/progress-receivables">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">进度款明细</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      本周{" "}
                      <MoneyText
                        value={summary?.weekProgressReceivable ?? 0}
                        compact
                      />{" "}
                      · 本月{" "}
                      <MoneyText
                        value={summary?.monthProgressReceivable ?? 0}
                        compact
                      />
                    </p>
                  </div>
                  <Calendar className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Legacy / Archive */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          历史归档 (只读)
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/finance/project-invoices">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group border-dashed border-muted-foreground/30 bg-muted/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-muted-foreground">
                      历史项目发票
                    </p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      仅查看历史项目发票，不再新建
                    </p>
                  </div>
                  <History className="h-8 w-8 text-muted-foreground/50" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/invoice-status?type=issued_unpaid">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group border-dashed border-muted-foreground/30 bg-muted/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-muted-foreground">
                      已开票未回款 (旧)
                    </p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      历史口径，请用订单应收与回款
                    </p>
                  </div>
                  <History className="h-8 w-8 text-muted-foreground/50" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Admin config */}
      {isAdmin && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">配置</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Link href="/admin/billing-profiles">
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">开票主体</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        管理开票主体信息
                      </p>
                    </div>
                    <Building2 className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/admin/procurement-channels">
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">采购渠道</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        管理采购渠道配置
                      </p>
                    </div>
                    <Store className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
