"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ShoppingBag, FolderKanban, FileText, Banknote, CreditCard, Loader2,
  Users, Link2, Receipt, TrendingUp, Calendar, AlertCircle, FileWarning,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/finance/stat-card";
import type { FinanceSummary } from "@/lib/finance/types";
import Link from "next/link";

export default function FinancePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") {
    router.push("/dashboard");
    return null;
  }

  return <FinanceDashboard />;
}

function FinanceDashboard() {
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
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">财务管理</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">财务管理</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="有效业务额" value={data?.effectiveBusinessAmount ?? 0} icon={FolderKanban} description={`项目 ${(data?.totalProjectBudgetAmount ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })} + 独立订单 ${(data?.standaloneOnlineOrderAmount ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })}`} />
        <StatCard title="项目关联订单额" value={data?.projectLinkedOrderAmount ?? 0} icon={ShoppingBag} description="已并入项目，不重复计入" />
        <Link href="/finance/progress-receivables?period=week" className="block">
          <StatCard title="本周进度款" value={data?.weekProgressReceivable ?? 0} icon={TrendingUp} description={`立项30% ${(data?.weekServiceDeposit ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })} · 结项70% ${(data?.weekServiceFinal ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })} · 商品 ${(data?.weekProductReceivable ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })}`} />
        </Link>
        <Link href="/finance/progress-receivables?period=month" className="block">
          <StatCard title="本月进度款" value={data?.monthProgressReceivable ?? 0} icon={Calendar} description={`立项30% ${(data?.monthServiceDeposit ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })} · 结项70% ${(data?.monthServiceFinal ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })} · 商品 ${(data?.monthProductReceivable ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })}`} />
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="已开票总额" value={(data?.projectInvoicedAmount ?? 0) + (data?.orderInvoicedAmount ?? 0)} icon={FileText} description={`待处理 ${data?.pendingInvoiceCount ?? 0} 笔`} />
        <StatCard title="已到款总额" value={data?.totalReceiptAmount ?? 0} icon={Banknote} description={`${data?.receiptCount ?? 0} 笔记录`} />
        <StatCard title="成本总额" value={data?.costAmount ?? 0} icon={Receipt} description="所有已登记成本" />
        <StatCard title="利润 (回款-成本)" value={data?.profitAmount ?? 0} icon={TrendingUp} description={data?.profitRate != null ? `利润率 ${(data.profitRate * 100).toFixed(1)}%` : "暂无回款数据"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link href="/finance/order-matching">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">拼好鼠订单匹配</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    未匹配 {(data?.unmatchedOnlineOrderAmount ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })} · 扫描绑定客户
                  </p>
                </div>
                <Link2 className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/invoices">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">发票工作台</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    统一发票管理：项目开票 + 订单开票
                  </p>
                </div>
                <FileText className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/project-invoices">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">项目开票</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    标准项目开票申请与管理
                  </p>
                </div>
                <FileText className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/project-receivables">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">项目应收与回款</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {data?.projectCount ?? 0} 个项目 · 应收管理
                  </p>
                </div>
                <CreditCard className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/invoice-status?type=issued_unpaid">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">已开票未付款</p>
                  <p className="text-sm text-muted-foreground mt-1">追踪已开发票的到款情况</p>
                </div>
                <AlertCircle className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/invoice-status?type=uninvoiced">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">未开票项目</p>
                  <p className="text-sm text-muted-foreground mt-1">有应收但尚未开票的项目</p>
                </div>
                <FileWarning className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/invoice-receipt-detail">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">开票/到款明细</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    发票与回款流水查询
                  </p>
                </div>
                <Receipt className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
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
                  <p className="text-sm text-muted-foreground mt-1">登记采购/实验/人工等成本</p>
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
                    {data?.customerCount ?? 0} 个客户 · 查看应收和到款明细
                  </p>
                </div>
                <Users className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
