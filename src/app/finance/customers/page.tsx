"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { FinanceCustomerListResponse } from "@/lib/finance/types";

export default function FinanceCustomersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return <FinanceCustomersList />;
}

function FinanceCustomersList() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery<FinanceCustomerListResponse>({
    queryKey: ["finance", "customers", search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/finance/customers?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const router = useRouter();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">客户财务看板</h1>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索客户名称/编号/单位..."
          className="pl-8"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-3 px-2">客户</th>
                  <th className="text-left py-3 px-2 hidden lg:table-cell">单位</th>
                  <th className="text-right py-3 px-2">独立订单额</th>
                  <th className="text-right py-3 px-2">项目总额</th>
                  <th className="text-right py-3 px-2 hidden lg:table-cell">关联订单</th>
                  <th className="text-right py-3 px-2">应收额</th>
                  <th className="text-right py-3 px-2">到款额</th>
                  <th className="text-right py-3 px-2">应收余额</th>
                </tr>
              </thead>
              <tbody>
                {(data?.customers || []).map((cust) => (
                  <tr
                    key={cust.id}
                    className="border-b hover:bg-muted/50 cursor-pointer"
                    onClick={() => router.push(`/finance/customers/${cust.id}`)}
                  >
                    <td className="py-3 px-2">
                      <div className="font-medium">{cust.name}</div>
                      <div className="text-xs text-muted-foreground">{cust.customerCode}</div>
                    </td>
                    <td className="py-3 px-2 text-muted-foreground hidden lg:table-cell">{cust.organization || "-"}</td>
                    <td className="py-3 px-2 text-right">
                      {cust.standaloneOnlineOrderAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      <div className="text-xs text-muted-foreground">{cust.onlineOrderCount} 笔</div>
                    </td>
                    <td className="py-3 px-2 text-right">
                      {cust.projectBudgetTotalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      <div className="text-xs text-muted-foreground">{cust.projectCount} 个</div>
                    </td>
                    <td className="py-3 px-2 text-right text-muted-foreground hidden lg:table-cell">
                      {cust.projectLinkedOrderAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-2 text-right font-medium">
                      {cust.receivableAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {cust.totalReceiptAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`py-3 px-2 text-right font-medium ${cust.outstandingAmount > 0 ? "text-red-600" : "text-green-600"}`}>
                      {cust.outstandingAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {(data?.customers || []).map((cust) => (
              <Card
                key={cust.id}
                className="cursor-pointer"
                onClick={() => router.push(`/finance/customers/${cust.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-medium">{cust.name}</div>
                      <div className="text-xs text-muted-foreground">{cust.customerCode} · {cust.organization || "无单位"}</div>
                    </div>
                    <span className={`text-sm font-bold ${cust.outstandingAmount > 0 ? "text-red-600" : "text-green-600"}`}>
                      {cust.outstandingAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>订单: {cust.onlineOrderTotalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</div>
                    <div>项目: {cust.projectBudgetTotalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</div>
                    <div>到款: {cust.totalReceiptAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {data && data.total > pageSize && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                共 {data.total} 条，第 {page}/{Math.ceil(data.total / pageSize)} 页
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / pageSize)} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
