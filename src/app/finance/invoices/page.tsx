"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

const STATUS_LABELS: Record<string, string> = { DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开具", CANCELLED: "已取消" };
const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = { DRAFT: "secondary", REQUESTED: "default", ISSUED: "default", CANCELLED: "destructive" };

export default function InvoicesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
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
  const orderId = searchParams.get("orderId");

  if (status === "loading") return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/finance" className="text-sm text-muted-foreground hover:underline">&larr; 返回财务</Link>
          <h1 className="text-xl font-bold mt-1">订单发票工作台</h1>
        </div>
      </div>


      <InvoicesSearchSection search={search} setSearch={setSearch} tab={tab} setTab={setTab} orderId={orderId} />
    </div>
  );
}

function InvoicesSearchSection({ search, setSearch, tab, setTab, orderId }: { search: string; setSearch: (s: string) => void; tab: string; setTab: (t: string) => void; orderId: string | null }) {
  const router = useRouter();
  const p = new URLSearchParams();
  if (search) p.set("search", search);
  if (tab !== "all") p.set("status", tab.toUpperCase());
  p.set("pageSize", "50");
  if (orderId) p.set("orderId", orderId);

  const { data: orderData, isLoading } = useQuery<{ invoices: Array<Record<string, unknown>>; total: number }>({
    queryKey: ["finance", "all-invoices", "order", search, tab, orderId],
    queryFn: () => fetch(`/api/finance/order-invoices?${p.toString()}`).then(r => r.ok ? r.json() : { invoices: [], total: 0 }),
  });

  const invoices = orderData?.invoices || [];
  const total = orderData?.total || 0;

  return (
    <div className="space-y-3">
      {orderId && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          <span>当前仅查看该订单的发票</span>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => router.push("/finance/invoices")}>
            <X className="h-3 w-3 mr-1" />清除筛选
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Input placeholder="搜索发票..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="draft">草稿</TabsTrigger>
            <TabsTrigger value="requested">已申请</TabsTrigger>
            <TabsTrigger value="issued">已开具</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground space-y-3">
          {orderId ? (
            <>
              <p>该订单暂无发票</p>
              <Link href={`/orders/${orderId}?tab=finance&action=invoice`}>
                <Button size="sm"><Plus className="h-3 w-3 mr-1" />返回订单财务页新建</Button>
              </Link>
            </>
          ) : (
            <p>暂无发票记录</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv: Record<string, unknown>) => (
            <Card key={inv.id as string} className="p-3 text-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant={STATUS_VARIANTS[inv.status as string] || "outline"} className="text-xs">{STATUS_LABELS[inv.status as string] || inv.status as string}</Badge>
                <Badge variant="outline" className="text-xs">{inv.orderId ? "订单" : "项目"}</Badge>
                <div>
                  <div className="font-medium">{(inv.buyerOrganizationName as string) || (inv.contentSummary as string) || "未命名"}</div>
                  <div className="text-xs text-muted-foreground">{inv.orderId ? `订单: ${(inv.order as Record<string, unknown>)?.orderNo as string || "-"}` : `项目: ${(inv.project as Record<string, unknown>)?.name as string || "-"}`}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">¥{(inv.totalAmount as number || 0).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">{(inv.invoiceType as string) === "SPECIAL" ? "专票" : "普票"}</div>
              </div>
            </Card>
          ))}
          {total > 50 && <div className="text-xs text-muted-foreground text-center">显示前50条，更多请前往对应工作台</div>}
        </div>
      )}
    </div>
  );
}
