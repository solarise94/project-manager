"use client";

import { useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import { FinancePageHeader } from "@/components/finance/finance-page-header";
import { LegacyFinanceBanner } from "@/components/finance/legacy-finance-banner";
import { InvoiceCard } from "@/components/finance/invoice-card";
import type { InvoiceRecord } from "@/components/invoice-form-dialog";

const STATUS_OPTIONS: Record<string, string> = {
  "": "全部状态", DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票", CANCELLED: "已取消",
};

interface InvoiceWithProject extends InvoiceRecord {
  project?: { id: string; name: string; cust?: { id: string; name: string } | null } | null;
}

export default function ProjectInvoicesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  if (status === "loading") return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) { router.push("/login"); return null; }
  if (session.user.role === "REPRESENTATIVE") { router.push("/dashboard"); return null; }
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <ProjectInvoicesContent />
    </Suspense>
  );
}

function ProjectInvoicesContent() {
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId") || "";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery<{ invoices: InvoiceWithProject[]; total: number; totalPages: number }>({
    queryKey: ["finance", "project-invoices", search, statusFilter, initialProjectId, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (initialProjectId) params.set("projectId", initialProjectId);
      const res = await fetch(`/api/finance/project-invoices?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const invoices = data?.invoices || [];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <FinancePageHeader
        title="历史项目发票"
        backHref="/finance"
      />

      <LegacyFinanceBanner />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm min-w-0 w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索公司名、项目名、联系人..."
            className="pl-8"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { if (v !== null) { setStatusFilter(v); setPage(1); } }}>
          <SelectTrigger className="w-28"><SelectDisplay label="状态" valueLabel={STATUS_OPTIONS[statusFilter] || "全部状态"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="DRAFT">草稿</SelectItem>
            <SelectItem value="REQUESTED">已申请</SelectItem>
            <SelectItem value="ISSUED">已开具</SelectItem>
            <SelectItem value="CANCELLED">已取消</SelectItem>
          </SelectContent>
        </Select>
        {initialProjectId && (
          <span className="text-xs text-muted-foreground">已筛选项目</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">暂无开票申请</div>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <div key={inv.id}>
              {inv.project && (
                <div className="text-xs text-muted-foreground mb-1 px-1">
                  项目：{inv.project.name}
                  {inv.project.cust && <span> · {inv.project.cust.name}</span>}
                </div>
              )}
              <InvoiceCard inv={inv} />
            </div>
          ))}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">共 {data.total} 条</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
