"use client";

import { Badge } from "@/components/ui/badge";
import type { InvoiceSheetData } from "@/lib/invoice-sheet";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿", REQUESTED: "已申请", ISSUED: "已开票", CANCELLED: "已取消",
};

function formatAmount(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words whitespace-pre-wrap">{value}</span>
    </div>
  );
}

export function InvoiceFinanceSheet({
  data, className,
}: {
  data: InvoiceSheetData;
  className?: string;
}) {
  const hasSeller = data.sellerName || data.sellerTaxId || data.sellerBankName;
  const hasBuyer = data.buyerOrganizationName || data.buyerTaxId;

  return (
    <div data-invoice-sheet className={`border rounded-lg bg-white text-black p-5 space-y-4 max-w-[640px] mx-auto overflow-hidden ${className || ""}`}>
      {/* Title */}
      <div className="text-center space-y-1">
        <h2 className="text-base font-bold tracking-wide">开票申请单</h2>
        <div className="flex items-center justify-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {data.invoiceType === "SPECIAL" ? "专票" : "普票"}
          </Badge>
          {data.status && (
            <Badge variant="secondary" className="text-[10px]">
              {STATUS_LABELS[data.status] || data.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Basic info */}
      {(data.contactName || data.projectCode) && (
        <div className="border-t pt-3 space-y-1">
          <InfoRow label="联系人" value={data.contactName} />
          <InfoRow label="项目编号" value={data.projectCode} />
        </div>
      )}

      {/* Seller */}
      {hasSeller && (
        <div className="border-t pt-3 space-y-1">
          <div className="text-xs font-medium text-muted-foreground mb-1">开票方</div>
          <div className="space-y-1">
            <InfoRow label="名称" value={data.sellerName} />
            <InfoRow label="税号" value={data.sellerTaxId} />
            <InfoRow label="开户行" value={data.sellerBankName} />
            <InfoRow label="银行账号" value={data.sellerBankAccount} />
            <InfoRow label="地址" value={data.sellerAddress} />
            <InfoRow label="电话" value={data.sellerPhone} />
          </div>
        </div>
      )}

      {/* Buyer */}
      {hasBuyer && (
        <div className="border-t pt-3 space-y-1">
          <div className="text-xs font-medium text-muted-foreground mb-1">购买方</div>
          <div className="space-y-1">
            <InfoRow label="公司名称" value={data.buyerOrganizationName} />
            <InfoRow label="税号" value={data.buyerTaxId} />
          </div>
        </div>
      )}

      {/* Content summary */}
      {data.contentSummary && (
        <div className="border-t pt-3">
          <InfoRow label="开票内容" value={data.contentSummary} />
        </div>
      )}

      {/* Items table */}
      {data.items.length > 0 && (
        <div className="border-t pt-3">
          <table className="w-full text-xs border-collapse table-fixed">
            <thead>
              <tr className="bg-muted/50">
                <th className="border px-2 py-1 text-left w-[2rem]">序号</th>
                <th className="border px-2 py-1 text-left">项目名称</th>
                <th className="border px-2 py-1 text-left w-[4.5rem]">规格</th>
                <th className="border px-2 py-1 text-left w-[3rem]">单位</th>
                <th className="border px-2 py-1 text-right w-[3rem]">数量</th>
                <th className="border px-2 py-1 text-right w-[5.5rem]">金额</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={i}>
                  <td className="border px-2 py-1 align-top">{i + 1}</td>
                  <td className="border px-2 py-1 align-top break-words whitespace-pre-wrap">{it.itemName}</td>
                  <td className="border px-2 py-1 align-top break-words">{it.spec || "—"}</td>
                  <td className="border px-2 py-1 align-top">{it.unit || "—"}</td>
                  <td className="border px-2 py-1 text-right align-top">{it.quantity != null ? it.quantity : "—"}</td>
                  <td className="border px-2 py-1 text-right align-top">{formatAmount(it.amount)}</td>
                </tr>
              ))}
              <tr className="font-medium bg-muted/30">
                <td colSpan={5} className="border px-2 py-1 text-right">合计</td>
                <td className="border px-2 py-1 text-right">{formatAmount(data.totalAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Remark */}
      {data.remark && (
        <div className="border-t pt-3">
          <InfoRow label="备注" value={data.remark} />
        </div>
      )}

      {/* Footer */}
      {(data.createdByName || data.createdAt) && (
        <div className="border-t pt-3 flex justify-between text-[10px] text-muted-foreground">
          {data.createdByName && <span>创建人：{data.createdByName}</span>}
          {data.createdAt && (
            <span>创建时间：{new Date(data.createdAt).toLocaleString("zh-CN")}</span>
          )}
        </div>
      )}
    </div>
  );
}
