"use client";

import { useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { LegacyFinanceBanner } from "@/components/finance/legacy-finance-banner";
import { FinanceEmptyState } from "@/components/finance/finance-empty-state";
import { MoneyText } from "@/components/finance/money-text";
import { FinanceMobileCard } from "@/components/finance/finance-mobile-card";
import { useMediaQuery } from "@/hooks/use-media-query";

export default function InvoiceStatusPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  if (status === "loading") return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <InvoiceContent />
    </Suspense>
  );
}

function InvoiceContent() {
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") === "uninvoiced" ? "uninvoiced" : "issued_unpaid";
  const [activeTab, setActiveTab] = useState(initialType);
  const search = "";
  const [page, setPage] = useState(1);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const { data, isLoading } = useQuery({
    queryKey: ["finance", "invoice-status", activeTab, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ type: activeTab, page: String(page), pageSize: "20" });
      if (search) params.set("search", search);
      const res = await fetch(`/api/finance/invoice-status?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{
        items: Array<Record<string, unknown>>; total: number; page: number; totalPages: number;
      }>;
    },
  });

  const items = data?.items || [];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title="开票与回款状态 (历史口径)"
        description="历史项目口径数据，仅做参考"
        backHref="/finance"
      />

      <LegacyFinanceBanner />

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setPage(1); }}>
        <div className="md:hidden">
          <select
            className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            value={activeTab}
            onChange={(e) => { setActiveTab(e.target.value); setPage(1); }}
          >
            <option value="issued_unpaid">已开票未付款</option>
            <option value="uninvoiced">未开票 (旧口径)</option>
          </select>
        </div>
        <div className="hidden md:block">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="issued_unpaid">已开票未付款</TabsTrigger>
            <TabsTrigger value="uninvoiced">未开票 (旧口径)</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : items.length === 0 ? (
            <FinanceEmptyState title="暂无数据" description="历史口径下暂无记录。" />
          ) : isMobile ? (
            <div className="md:hidden space-y-3">
              {items.map((item, i) => (
                <FinanceMobileCard
                  key={i}
                  title={String(item.projectName)}
                  subtitle={String(item.customerName || "-")}
                  badge={
                    activeTab === "issued_unpaid" ? (
                      <Badge variant="destructive">未到款 <MoneyText value={Number(item.unpaidAmount)} compact /></Badge>
                    ) : (
                      <Badge variant="destructive">未开票 <MoneyText value={Number(item.uninvoicedAmount)} compact /></Badge>
                    )
                  }
                  metrics={
                    activeTab === "issued_unpaid" ? [
                      { label: "发票", value: <MoneyText value={Number(item.invoiceAmount)} compact /> },
                      { label: "已到", value: <MoneyText value={Number(item.receivedAmount)} compact /> },
                    ] : [
                      { label: "应收", value: <MoneyText value={Number(item.receivableAmount)} compact /> },
                      { label: "已开", value: <MoneyText value={Number(item.invoicedAmount)} compact /> },
                    ]
                  }
                />
              ))}
            </div>
          ) : (
            <div className="hidden md:block overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="border-b text-muted-foreground">
                    {activeTab === "issued_unpaid" ? (
                      <>
                        <th className="text-left py-2.5 px-3">项目</th>
                        <th className="text-left py-2.5 px-3">客户</th>
                        <th className="text-right py-2.5 px-3">发票金额</th>
                        <th className="text-right py-2.5 px-3">已到款</th>
                        <th className="text-right py-2.5 px-3">未到款</th>
                        <th className="text-left py-2.5 px-3">开票日期</th>
                      </>
                    ) : (
                      <>
                        <th className="text-left py-2.5 px-3">项目</th>
                        <th className="text-left py-2.5 px-3">客户</th>
                        <th className="text-right py-2.5 px-3">应收额</th>
                        <th className="text-right py-2.5 px-3">已开票</th>
                        <th className="text-right py-2.5 px-3">未开票</th>
                        <th className="text-center py-2.5 px-3">进度</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className="border-b hover:bg-muted/50">
                      <td className="py-2.5 px-3 font-medium">{String(item.projectName)}</td>
                      <td className="py-2.5 px-3 text-muted-foreground">{String(item.customerName || "-")}</td>
                      {activeTab === "issued_unpaid" ? (
                        <>
                          <td className="py-2.5 px-3 text-right"><MoneyText value={Number(item.invoiceAmount)} /></td>
                          <td className="py-2.5 px-3 text-right"><MoneyText value={Number(item.receivedAmount)} /></td>
                          <td className="py-2.5 px-3 text-right"><MoneyText value={Number(item.unpaidAmount)} tone="warning" /></td>
                          <td className="py-2.5 px-3 text-muted-foreground">{new Date(String(item.invoiceDate)).toLocaleDateString("zh-CN")}</td>
                        </>
                      ) : (
                        <>
                          <td className="py-2.5 px-3 text-right"><MoneyText value={Number(item.receivableAmount)} /></td>
                          <td className="py-2.5 px-3 text-right"><MoneyText value={Number(item.invoicedAmount)} /></td>
                          <td className="py-2.5 px-3 text-right"><MoneyText value={Number(item.uninvoicedAmount)} tone="warning" /></td>
                          <td className="py-2.5 px-3 text-center">{Number(item.progress)}%</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">共 {data.total} 条</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
