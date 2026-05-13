"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ArrowLeft, ShoppingBag, FolderKanban, FileText, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/finance/stat-card";
import type { CustomerFinanceDetail } from "@/lib/finance/types";

import { useMediaQuery } from "@/hooks/use-media-query";
import {
  Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger,
} from "@/components/ui/select";

export default function CustomerFinanceDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return <CustomerFinanceDetail />;
}

function CustomerFinanceDetail() {
  const params = useParams();
  const customerId = params.customerId as string;
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [activeTab, setActiveTab] = useState("overview");

  const { data, isLoading } = useQuery<CustomerFinanceDetail>({
    queryKey: ["finance", "customer", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/finance/customers/${customerId}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });


  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="h-28 rounded-xl" />))}
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-12 text-muted-foreground">客户不存在</div>;
  }

  const tabs = [
    { value: "overview", label: "概览" },
    { value: "projects", label: "项目" },
    { value: "orders", label: "拼好鼠订单" },
    { value: "invoices", label: "开票" },
    { value: "receipts", label: "到款" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/finance/customers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{data.customer.name}</h1>
          <p className="text-sm text-muted-foreground">
            {data.customer.customerCode}{data.customer.organization ? ` · ${data.customer.organization}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="拼好鼠订单额" value={data.summary.onlineOrderTotal} icon={ShoppingBag} />
        <StatCard title="项目总额" value={data.summary.projectBudgetTotal} icon={FolderKanban} />
        <StatCard title="已开票" value={data.summary.projectInvoicedAmount + data.summary.orderInvoicedAmount} icon={FileText} />
        <StatCard
          title="应收余额"
          value={data.summary.outstandingAmount}
          icon={Banknote}
          variant={data.summary.outstandingAmount > 0 ? "warning" : "default"}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {isMobile ? (
          <Select value={activeTab} onValueChange={(v) => v && setActiveTab(v)}>
            <SelectTrigger className="w-full"><SelectDisplay label="标签页" valueLabel={tabs.find(t => t.value === activeTab)?.label} placeholder="选择标签页" /></SelectTrigger>
            <SelectContent>
              {tabs.map((t) => (<SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>))}
            </SelectContent>
          </Select>
        ) : (
          <TabsList className="w-full sm:w-auto">
            {tabs.map((t) => (<TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>))}
          </TabsList>
        )}

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <h3 className="font-medium mb-2">客户信息</h3>
                <div className="text-sm space-y-1">
                  <p>姓名：{data.customer.name}</p>
                  <p>编号：{data.customer.customerCode}</p>
                  <p>单位：{data.customer.organization || "-"}</p>
                  <p>微信号：{data.customer.wechat || "-"}</p>
                  <p>负责人：{data.customer.principal || "-"}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <h3 className="font-medium mb-2">财务汇总</h3>
                <div className="text-sm space-y-1">
                  <p>拼好鼠订单：{data.summary.onlineOrderTotal.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} ({data.onlineOrders.length} 笔)</p>
                  <p>项目预算：{data.summary.projectBudgetTotal.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} ({data.projects.length} 个)</p>
                  <p>开票总额：{(data.summary.projectInvoicedAmount + data.summary.orderInvoicedAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</p>
                  <p>到款总额：{data.summary.totalReceiptAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</p>
                  <p className="font-medium text-red-600">
                    应收余额：{data.summary.outstandingAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2">项目名称</th>
                  <th className="text-right py-2 px-2">预算金额</th>
                  <th className="text-center py-2 px-2">状态</th>
                  <th className="text-center py-2 px-2">进度</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.length === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">暂无项目</td></tr>
                ) : (
                  data.projects.map((p) => (
                    <tr key={p.id} className="border-b hover:bg-muted/50 cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                      <td className="py-2 px-2 font-medium">{p.name}</td>
                      <td className="py-2 px-2 text-right">{(p.budgetAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 px-2 text-center"><Badge variant="outline">{p.status}</Badge></td>
                      <td className="py-2 px-2 text-center">{p.progress}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2">订单号</th>
                  <th className="text-right py-2 px-2">金额</th>
                  <th className="text-left py-2 px-2">日期</th>
                  <th className="text-center py-2 px-2">匹配状态</th>
                  <th className="text-center py-2 px-2">计入方式</th>
                </tr>
              </thead>
              <tbody>
                {data.onlineOrders.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">暂无订单</td></tr>
                ) : (
                  data.onlineOrders.map((o) => {
                    const label = o.financeTreatment === "AUTO" ? "自动" : o.financeTreatment === "PROJECT_INCLUDED" ? "并入项目" : o.financeTreatment === "STANDALONE" ? "独立计入" : o.financeTreatment === "EXCLUDED" ? "排除" : o.financeTreatment;
                    return (
                    <tr key={o.id} className="border-b">
                      <td className="py-2 px-2 font-mono text-xs">{o.orderNo}</td>
                      <td className="py-2 px-2 text-right">{(o.totalAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 px-2 text-muted-foreground">{o.orderedAt ? new Date(o.orderedAt).toLocaleDateString("zh-CN") : "-"}</td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant={o.customerMatchStatus === "AUTO_MATCHED" ? "default" : "outline"}>
                          {o.customerMatchStatus === "AUTO_MATCHED" ? "自动匹配" : o.customerMatchStatus === "MANUAL_MATCHED" ? "人工绑定" : o.customerMatchStatus}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant={
                          o.financeTreatment === "STANDALONE" ? "default" :
                          o.financeTreatment === "PROJECT_INCLUDED" ? "secondary" :
                          o.financeTreatment === "EXCLUDED" ? "destructive" : "outline"
                        }>
                          {label}
                        </Badge>
                      </td>
                    </tr>
                  );})
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 px-2">类型</th>
                  <th className="text-right py-2 px-2">金额</th>
                  <th className="text-center py-2 px-2">状态</th>
                  <th className="text-left py-2 px-2">日期</th>
                </tr>
              </thead>
              <tbody>
                {[...data.projectInvoices, ...data.orderInvoices].length === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">暂无开票记录</td></tr>
                ) : (
                  [...data.projectInvoices.map((i) => ({ ...i, type: "项目发票" })),
                   ...data.orderInvoices.map((i) => ({ ...i, type: "订单发票" }))]
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((inv) => (
                      <tr key={inv.id} className="border-b">
                        <td className="py-2 px-2">{inv.type}</td>
                        <td className="py-2 px-2 text-right">{inv.totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 px-2 text-center">
                          <Badge variant={inv.status === "ISSUED" ? "default" : inv.status === "CANCELLED" ? "destructive" : "outline"}>
                            {inv.status === "ISSUED" ? "已开票" : inv.status === "DRAFT" ? "草稿" : inv.status === "REQUESTED" ? "已申请" : inv.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString("zh-CN")}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="receipts" className="mt-4">
          <div className="flex justify-end mb-3">
            <span className="text-xs text-muted-foreground">回款请从订单详情页操作</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-right py-2 px-2">金额</th>
                  <th className="text-left py-2 px-2">到款日期</th>
                  <th className="text-center py-2 px-2">来源</th>
                  <th className="text-left py-2 px-2">备注</th>
                </tr>
              </thead>
              <tbody>
                {data.receipts.length === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">暂无到款记录</td></tr>
                ) : (
                  data.receipts.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2 px-2 text-right font-medium">{r.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 px-2 text-muted-foreground">{new Date(r.receivedAt).toLocaleDateString("zh-CN")}</td>
                      <td className="py-2 px-2 text-center"><Badge variant="outline">{r.source}</Badge></td>
                      <td className="py-2 px-2 text-muted-foreground">{r.remark || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
