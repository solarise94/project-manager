"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ReceiptItem {
  id: string;
  amount: number;
  receivedAt: string;
  source: string;
  remark: string | null;
  customer: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  externalOrder: { id: string; externalOrderNo: string } | null;
  createdBy: { id: string; name: string } | null;
}

export default function InvoiceReceiptDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }

  return <InvoiceReceiptDetailContent />;
}

function InvoiceReceiptDetailContent() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery<{ receipts: ReceiptItem[]; total: number }>({
    queryKey: ["finance", "receipts", search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/finance/receipts?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const sourceLabels: Record<string, string> = {
    MANUAL: "人工录入",
    PINGOODMICE_ORDER: "拼好鼠订单",
    BANK: "银行转账",
    OTHER: "其他",
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">开票/到款明细</h1>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="搜索客户/项目/订单..." className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-right py-2 px-2">金额</th>
                  <th className="text-left py-2 px-2">到款日期</th>
                  <th className="text-left py-2 px-2">客户</th>
                  <th className="text-left py-2 px-2">项目</th>
                  <th className="text-center py-2 px-2">来源</th>
                  <th className="text-left py-2 px-2">备注</th>
                </tr>
              </thead>
              <tbody>
                {(data?.receipts || []).length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">暂无到款记录</td></tr>
                ) : (
                  (data?.receipts || []).map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2 px-2 text-right font-medium">
                        {r.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {new Date(r.receivedAt).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="py-2 px-2">{r.customer?.name || "-"}</td>
                      <td className="py-2 px-2">{r.project?.name || "-"}</td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant="outline">{sourceLabels[r.source] || r.source}</Badge>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground">{r.remark || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data && data.total > pageSize && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">共 {data.total} 条</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / pageSize)} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
