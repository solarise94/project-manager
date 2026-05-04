import { Badge } from "@/components/ui/badge";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  UNMATCHED: { label: "未匹配", variant: "secondary" },
  AUTO_MATCHED: { label: "自动匹配", variant: "default" },
  MANUAL_MATCHED: { label: "人工绑定", variant: "outline" },
  CONFLICT: { label: "冲突待确认", variant: "secondary" },
};

export function OrderMatchBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, variant: "secondary" as const };
  return (
    <Badge variant={
      status === "AUTO_MATCHED" ? "default" :
      status === "CONFLICT" ? "destructive" :
      status === "MANUAL_MATCHED" ? "outline" : "secondary"
    }>
      {config.label}
    </Badge>
  );
}
