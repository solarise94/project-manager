"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, FolderKanban, FileText, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/finance/stat-card";
import { ReceiptFormDialog } from "@/components/finance/receipt-form-dialog";
import { computeProjectReceivable } from "@/lib/finance/types";
import { useMediaQuery } from "@/hooks/use-media-query";

interface ProjectReceivable {
  id: string;
  name: string;
  cust: { id: string; name: string } | null;
  budgetAmount: number | null;
  projectType: string | null;
  status: string;
  progress: number;
  invoicedAmount: number;
  receivedAmount: number;
}

export default function ProjectReceivablesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return <ProjectReceivablesContent />;
}

function ProjectReceivablesContent() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");

  const { data: projects, isLoading } = useQuery<{ projects: ProjectReceivable[]; total: number }>({
    queryKey: ["projects", "receivables", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("pageSize", "50");
      const res = await fetch(`/api/projects?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();

      // Enrich with invoice and receipt data
      const enriched = await Promise.all(
        (data.projects || []).map(async (p: { id: string; name: string; cust?: { id: string; name: string } | null; budgetAmount?: number | null; status: string; progress: number; projectType?: string | null }) => {
          const [invoiceRes, receiptRes] = await Promise.all([
            fetch(`/api/projects/${p.id}/invoices?pageSize=100`),
            fetch(`/api/finance/receipts?projectId=${p.id}&pageSize=100`),
          ]);
          let invoiced = 0;
          let received = 0;
          try {
            if (invoiceRes.ok) {
              const invData = await invoiceRes.json();
              invoiced = (invData.invoices || []).reduce((s: number, i: { totalAmount: number; status: string }) =>
                i.status !== "CANCELLED" ? s + i.totalAmount : s, 0);
            }
          } catch {}
          try {
            if (receiptRes.ok) {
              const recData = await receiptRes.json();
              received = (recData.receipts || []).reduce((s: number, r: { amount: number }) => s + r.amount, 0);
            }
          } catch {}

          return {
            ...p,
            invoicedAmount: invoiced,
            receivedAmount: received,
          };
        })
      );

      return { projects: enriched, total: data.total };
    },
  });

  const totalReceivable = (projects?.projects || []).reduce((s, p) => s + computeProjectReceivable(p), 0);
  const totalReceived = (projects?.projects || []).reduce((s, p) => s + p.receivedAmount, 0);
  const totalInvoiced = (projects?.projects || []).reduce((s, p) => s + p.invoicedAmount, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">项目应收与回款</h1>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard title="应收总额" value={totalReceivable} icon={FolderKanban} />
        <StatCard title="已开票" value={totalInvoiced} icon={FileText} />
        <StatCard title="已到款" value={totalReceived} icon={Banknote} />
        <StatCard title="未开票" value={Math.max(totalReceivable - totalInvoiced, 0)} icon={FileText} variant={totalReceivable > totalInvoiced ? "warning" : "default"} />
      </div>

      <div className="relative max-w-sm min-w-0 w-full">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="搜索项目名称..." className="pl-8 w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <>
          {isMobile ? (
            <div className="md:hidden space-y-3">
              {(projects?.projects || []).map((p) => {
                const receivable = computeProjectReceivable(p);
                const uninvoiced = Math.max(receivable - p.invoicedAmount, 0);
                const unreceived = Math.max(p.invoicedAmount - p.receivedAmount, 0);
                return (
                  <Card key={p.id}>
                    <CardContent className="p-4 space-y-2">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.cust?.name || "-"}</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">应收</span>
                          <span className="font-medium">{receivable.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">已开票</span>
                          <span>{p.invoicedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">已到款</span>
                          <span>{p.receivedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">进度</span>
                          <span>{p.progress}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">未开票</span>
                          <span className={uninvoiced > 0 ? "text-red-600" : "text-green-600"}>{uninvoiced.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">未到款</span>
                          <span className={unreceived > 0 ? "text-red-600" : "text-green-600"}>{unreceived.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full mt-1"
                        onClick={() => { setSelectedProjectId(p.id); setReceiptOpen(true); }}
                      >
                        <Plus className="h-3 w-3 mr-1" />回款
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 px-2">项目名称</th>
                    <th className="text-left py-2 px-2">客户</th>
                    <th className="text-right py-2 px-2">应收额</th>
                    <th className="text-right py-2 px-2">已开票</th>
                    <th className="text-right py-2 px-2">已到款</th>
                    <th className="text-right py-2 px-2">未开票</th>
                    <th className="text-right py-2 px-2">未到款</th>
                    <th className="text-center py-2 px-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(projects?.projects || []).map((p) => {
                    const receivable = computeProjectReceivable(p);
                    const uninvoiced = Math.max(receivable - p.invoicedAmount, 0);
                    const unreceived = Math.max(p.invoicedAmount - p.receivedAmount, 0);
                    const excessInvoice = Math.max(p.invoicedAmount - receivable, 0);
                    const excessReceipt = Math.max(p.receivedAmount - receivable, 0);
                    return (
                      <tr key={p.id} className="border-b">
                        <td className="py-2 px-2 font-medium">{p.name}</td>
                        <td className="py-2 px-2 text-muted-foreground">{p.cust?.name || "-"}</td>
                        <td className="py-2 px-2 text-right">{receivable.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</td>
                        <td className="py-2 px-2 text-right">
                          {p.invoicedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                          {excessInvoice > 0 && <div className="text-xs text-amber-600">超额 {excessInvoice.toLocaleString("zh-CN", { minimumFractionDigits: 0 })}</div>}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {p.receivedAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                          {excessReceipt > 0 && <div className="text-xs text-amber-600">超额 {excessReceipt.toLocaleString("zh-CN", { minimumFractionDigits: 0 })}</div>}
                        </td>
                        <td className={`py-2 px-2 text-right ${uninvoiced > 0 ? "text-red-600" : "text-green-600"}`}>
                          {uninvoiced.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className={`py-2 px-2 text-right ${unreceived > 0 ? "text-red-600" : "text-green-600"}`}>
                          {unreceived.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setSelectedProjectId(p.id); setReceiptOpen(true); }}
                          >
                            <Plus className="h-3 w-3 mr-1" />回款
                          </Button>
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

      <ReceiptFormDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        defaultProjectId={selectedProjectId ?? undefined}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["projects", "receivables"] })}
      />
    </div>
  );
}
