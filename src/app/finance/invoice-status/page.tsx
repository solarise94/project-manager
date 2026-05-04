"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReceiptFormDialog } from "@/components/finance/receipt-form-dialog";
import { useMediaQuery } from "@/hooks/use-media-query";

export default function InvoiceStatusPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  if (status === "loading") return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }
  return <InvoiceContent />;
}

function InvoiceContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const initialType = searchParams.get("type") === "uninvoiced" ? "uninvoiced" : "issued_unpaid";
  const [activeTab, setActiveTab] = useState(initialType);
  const search = "";
  const [page, setPage] = useState(1);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptPrefill, setReceiptPrefill] = useState<{
    customerId?: string; projectId?: string; projectInvoiceId?: string; amount?: number;
  }>({});
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">开票与到款状态</h1>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setPage(1); }}>
        <div className="md:hidden">
          <select
            className="w-full text-sm border rounded px-2 py-1.5 bg-background"
            value={activeTab}
            onChange={(e) => { setActiveTab(e.target.value); setPage(1); }}
          >
            <option value="issued_unpaid">已开票未付款</option>
            <option value="uninvoiced">未开票项目</option>
          </select>
        </div>
        <div className="hidden md:block">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="issued_unpaid">已开票未付款</TabsTrigger>
            <TabsTrigger value="uninvoiced">未开票项目</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
            <>
              {isMobile ? (
                <div className="md:hidden space-y-3">
                  {(data?.items || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">暂无数据</p>
                  ) : (data?.items || []).map((item, i) => (
                    <Card key={i}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{String(item.projectName)}</span>
                          {activeTab === "issued_unpaid" ? (
                            <Badge variant="destructive" className="shrink-0 whitespace-nowrap">未到款 {Number(item.unpaidAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</Badge>
                          ) : (
                            <Badge variant="destructive" className="shrink-0 whitespace-nowrap">未开票 {Number(item.uninvoicedAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{String(item.customerName || "-")}</div>
                        {activeTab === "issued_unpaid" ? (
                          <>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">发票 {Number(item.invoiceAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                              <span className="text-muted-foreground">已到 {Number(item.receivedAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">开票日期: {new Date(String(item.invoiceDate)).toLocaleDateString("zh-CN")}</div>
                            <Button size="sm" variant="outline" className="w-full mt-1" onClick={() => {
                              setReceiptPrefill({
                                customerId: String(item.customerId || ""),
                                projectId: String(item.projectId),
                                projectInvoiceId: String(item.invoiceId),
                                amount: Number(item.unpaidAmount),
                              });
                              setReceiptOpen(true);
                            }}>
                              <Plus className="h-3 w-3 mr-1" />登记到款
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">应收 {Number(item.receivableAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                              <span className="text-muted-foreground">已开 {Number(item.invoicedAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">进度 {Number(item.progress)}%</div>
                            <Button size="sm" variant="outline" className="w-full mt-1" onClick={() => router.push(`/projects/${item.projectId}`)}>
                              去项目开票
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        {activeTab === "issued_unpaid" ? (
                          <>
                            <th className="text-left py-2 px-2">项目</th>
                            <th className="text-left py-2 px-2">客户</th>
                            <th className="text-right py-2 px-2">发票金额</th>
                            <th className="text-right py-2 px-2">已到款</th>
                            <th className="text-right py-2 px-2">未到款</th>
                            <th className="text-left py-2 px-2">开票日期</th>
                            <th className="text-center py-2 px-2">操作</th>
                          </>
                        ) : (
                          <>
                            <th className="text-left py-2 px-2">项目</th>
                            <th className="text-left py-2 px-2">客户</th>
                            <th className="text-right py-2 px-2">应收额</th>
                            <th className="text-right py-2 px-2">已开票</th>
                            <th className="text-right py-2 px-2">未开票</th>
                            <th className="text-center py-2 px-2">进度</th>
                            <th className="text-center py-2 px-2">操作</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.items || []).length === 0 ? (
                        <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">暂无数据</td></tr>
                      ) : (data?.items || []).map((item, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-2 px-2 font-medium">{String(item.projectName)}</td>
                          <td className="py-2 px-2 text-muted-foreground">{String(item.customerName || "-")}</td>
                          {activeTab === "issued_unpaid" ? (
                            <>
                              <td className="py-2 px-2 text-right">{Number(item.invoiceAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2 px-2 text-right">{Number(item.receivedAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2 px-2 text-right text-red-600 font-medium">{Number(item.unpaidAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2 px-2 text-muted-foreground">{new Date(String(item.invoiceDate)).toLocaleDateString("zh-CN")}</td>
                              <td className="py-2 px-2 text-center">
                                <Button size="sm" variant="outline" onClick={() => {
                                  setReceiptPrefill({
                                    customerId: String(item.customerId || ""),
                                    projectId: String(item.projectId),
                                    projectInvoiceId: String(item.invoiceId),
                                    amount: Number(item.unpaidAmount),
                                  });
                                  setReceiptOpen(true);
                                }}>
                                  <Plus className="h-3 w-3 mr-1" />登记到款
                                </Button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-2 px-2 text-right">{Number(item.receivableAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2 px-2 text-right">{Number(item.invoicedAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2 px-2 text-right text-red-600 font-medium">{Number(item.uninvoicedAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                              <td className="py-2 px-2 text-center">{Number(item.progress)}%</td>
                              <td className="py-2 px-2 text-center">
                                <Button size="sm" variant="outline" onClick={() => router.push(`/projects/${item.projectId}`)}>
                                  去项目开票
                                </Button>
                              </td>
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
            </>
          )}
        </TabsContent>
      </Tabs>

      <ReceiptFormDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        defaultCustomerId={receiptPrefill.customerId}
        defaultProjectId={receiptPrefill.projectId}
        defaultProjectInvoiceId={receiptPrefill.projectInvoiceId}
        defaultAmount={receiptPrefill.amount}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["finance", "invoice-status"] })}
      />
    </div>
  );
}
