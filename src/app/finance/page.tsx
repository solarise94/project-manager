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
        <StatCard
          title="有效业务额"
          value={data?.effectiveBusinessAmount ?? 0}
          icon={FolderKanban}
          description={`项目 ${(data?.totalProjectBudgetAmount ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })} + 独立订单 ${(data?.standaloneOnlineOrderAmount ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })}`}
        />
        <StatCard
          title="本周进度款"
          value={data?.weekProgressReceivable ?? 0}
          icon={TrendingUp}
          description={`立项30% ${(data?.weekServiceDeposit ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })} · 商品 ${(data?.weekProductReceivable ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })}`}
        />
        <Link href="/finance/progress-receivables?period=month" className="block">
          <StatCard
            title="本月进度款"
            value={data?.monthProgressReceivable ?? 0}
            icon={Calendar}
            description={`结项70% ${(data?.monthServiceFinal ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })} · 商品 ${(data?.monthProductReceivable ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 0 })}`}
          />
        </Link>
        <StatCard
          title="利润 (回款-成本)"
          value={data?.profitAmount ?? 0}
          icon={TrendingUp}
          description={data?.profitRate != null ? `利润率 ${(data.profitRate * 100).toFixed(1)}%` : "暂无回款数据"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="已开票总额"
          value={(data?.projectInvoicedAmount ?? 0) + (data?.orderInvoicedAmount ?? 0)}
          icon={FileText}
          description={`待处理 ${data?.pendingInvoiceCount ?? 0} 笔`}
        />
        <StatCard
          title="已到款总额"
          value={data?.totalReceiptAmount ?? 0}
          icon={Banknote}
          description={`${data?.receiptCount ?? 0} 笔记录`}
        />
        <StatCard
          title="成本总额"
          value={data?.costAmount ?? 0}
          icon={Receipt}
        />
        <StatCard
          title="客户数"
          value={data?.customerCount ?? 0}
          icon={Users}
          description="有财务记录的客户"
        />
      </div>

      {/* ── Order-centric finance ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">订单财务</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/finance/order-matching">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">订单匹配与开票辅助</p>
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

          <Link href="/finance/invoice-receipt-detail">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">订单回款流水</p>
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
                      {data?.customerCount ?? 0} 个客户 · 按客户聚合
                    </p>
                  </div>
                  <Users className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* ── Legacy / History ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">历史记录 (只读)</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/finance/project-invoices">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group border-dashed">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">历史项目发票</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      仅查看历史项目发票，不再新建
                    </p>
                  </div>
                  <History className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/finance/invoice-status?type=issued_unpaid">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer group border-dashed">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">已开票未回款 (旧)</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      历史口径，请用订单应收与回款
                    </p>
                  </div>
                  <History className="h-8 w-8 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {isAdmin && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">财务配置</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Link href="/admin/billing-profiles">
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer group">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">开票主体</p>
                      <p className="text-sm text-muted-foreground mt-1">管理开票主体信息</p>
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
                      <p className="text-sm text-muted-foreground mt-1">管理采购渠道配置</p>
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
