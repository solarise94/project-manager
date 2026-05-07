"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { InvoiceRecord } from "@/components/invoice-form-dialog";
import Link from "next/link";

interface ProjectInvoiceSectionProps {
  projectId: string;
  projectCode?: string | null;
  customerOrgId?: string | null;
  customerOrgName?: string | null;
  readOnly?: boolean;
}

function formatAmount(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票", CANCELLED: "已取消",
};
const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "secondary", REQUESTED: "default", ISSUED: "outline", CANCELLED: "destructive",
};

export function ProjectInvoiceSection({
  projectId,
}: ProjectInvoiceSectionProps) {
  const { data: invoicesData, isLoading } = useQuery<{ invoices: InvoiceRecord[] }>({
    queryKey: ["project-invoices", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/invoices`);
      if (!res.ok) throw new Error("Failed to load invoices");
      return res.json();
    },
  });
  const invoices = invoicesData?.invoices || [];

  const draftCount = invoices.filter((i) => i.status === "DRAFT").length;
  const requestedCount = invoices.filter((i) => i.status === "REQUESTED").length;
  const issuedCount = invoices.filter((i) => i.status === "ISSUED").length;
  const totalAmount = invoices.reduce((s, i) => i.status !== "CANCELLED" ? s + i.totalAmount : s, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <FileText className="h-4 w-4" /> 开票概览
        </h3>
        <Link href={`/finance/project-invoices?projectId=${projectId}`}>
          <Button size="sm" variant="outline">
            <ExternalLink className="mr-1 h-3 w-3" /> 在财务管理中处理开票
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">
          暂无开票申请
          <div className="mt-2">
            <Link href={`/finance/project-invoices?projectId=${projectId}`}>
              <Button size="sm" variant="outline">
                <ExternalLink className="mr-1 h-3 w-3" /> 去财务模块新建
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <span className="text-muted-foreground">共 {invoices.length} 笔</span>
            {draftCount > 0 && <Badge variant="secondary">草稿 {draftCount}</Badge>}
            {requestedCount > 0 && <Badge variant="default">已申请 {requestedCount}</Badge>}
            {issuedCount > 0 && <Badge variant="outline">已开票 {issuedCount}</Badge>}
            {totalAmount > 0 && <span className="font-medium">有效金额 {formatAmount(totalAmount)}</span>}
          </div>

          <div className="space-y-1.5">
            {invoices.slice(0, 5).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 text-sm py-1.5 px-2 rounded hover:bg-muted/50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-muted-foreground">{inv.buyerOrganizationName}</span>
                  <Badge variant={inv.invoiceType === "SPECIAL" ? "default" : "secondary"} className="text-[10px] shrink-0">
                    {inv.invoiceType === "SPECIAL" ? "专票" : "普票"}
                  </Badge>
                  <Badge variant={STATUS_VARIANTS[inv.status] || "outline"} className="text-[10px] shrink-0">
                    {STATUS_LABELS[inv.status] || inv.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(inv.createdAt), { addSuffix: true, locale: zhCN })}
                  </span>
                  <span className="font-medium">{formatAmount(inv.totalAmount)}</span>
                </div>
              </div>
            ))}
            {invoices.length > 5 && (
              <div className="text-center text-xs text-muted-foreground py-1">
                还有 {invoices.length - 5} 笔...
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
