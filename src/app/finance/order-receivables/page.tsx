"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, ShoppingBag, FileText, Banknote } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/finance/stat-card";
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
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!session) { router.push("/login"); return null; }

  return <OrderReceivablesContent />;
}

function OrderReceivablesContent() {
  const [search, setSearch] = useState("");
  const isMobile = useMediaQuery("(max-width: 767px)");

  const { data: orders, isLoading } = useQuery<{ orders: OrderReceivable[]; total: number; totalPages: number; aggregate: { totalAmount: number; invoiceTotal: number; receiptTotal: number; unpaidTotal: number } }>({
    queryKey: ["order-receivables", search],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: "50" });
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">订单应收与回款</h1>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="订单金额" value={totalAmount} icon={ShoppingBag} />
        <StatCard title="已开票" value={totalInvoiced} icon={FileText} />
        <StatCard title="已到款" value={totalReceived} icon={Banknote} />
        <StatCard title="未到款" value={stats?.unpaidTotal || 0} icon={Banknote} variant={(stats?.unpaidTotal || 0) > 0 ? "warning" : "default"} />
      </div>

      <div className="relative max-w-sm min-w-0 w-full">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="搜索订单号..." className="pl-8 w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <>
          {isMobile ? (
            <div className="md:hidden space-y-3">
              {list.map((o) => {
                const unreceived = Math.max(o.invoicedAmount - o.receivedAmount, 0);
                return (
                  <Link key={o.id} href={`/orders/${o.id}`}>
                    <Card>
                      <CardContent className="p-4 space-y-2">
                        <div className="text-sm font-medium truncate">{o.orderNo}</div>
                        <div className="text-xs text-muted-foreground truncate">{o.customer?.name || "-"}</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          <div className="flex justify-between"><span className="text-muted-foreground">金额</span><span className="font-medium">{o.totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">已开票</span><span>{o.invoicedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">已到款</span><span>{o.receivedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">未到款</span><span className={unreceived > 0 ? "text-red-600" : "text-green-600"}>{unreceived.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span></div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 px-2">订单号</th>
                    <th className="text-left py-2 px-2">客户</th>
                    <th className="text-right py-2 px-2">金额</th>
                    <th className="text-right py-2 px-2">已开票</th>
                    <th className="text-right py-2 px-2">已到款</th>
                    <th className="text-right py-2 px-2">未到款</th>
                    <th className="text-center py-2 px-2">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((o) => {
                    const unreceived = Math.max(o.invoicedAmount - o.receivedAmount, 0);
                    return (
                      <tr key={o.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-2 font-medium">{o.orderNo}</td>
                        <td className="py-2 px-2 text-muted-foreground">{o.customer?.name || "-"}</td>
                        <td className="py-2 px-2 text-right">{o.totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 px-2 text-right">{o.invoicedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 px-2 text-right">{o.receivedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                        <td className={`py-2 px-2 text-right ${unreceived > 0 ? "text-red-600" : "text-green-600"}`}>{unreceived.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 px-2 text-center">
                          <Link href={`/orders/${o.id}`} className="text-primary hover:underline text-xs">查看</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
