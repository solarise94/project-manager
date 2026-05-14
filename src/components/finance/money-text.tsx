import { cn } from "@/lib/utils";

interface MoneyTextProps {
  value: number | null | undefined;
  tone?: "default" | "income" | "expense" | "warning" | "muted";
  compact?: boolean;
  showCurrency?: boolean;
  className?: string;
}

export function MoneyText({
  value,
  tone = "default",
  compact = false,
  showCurrency = true,
  className,
}: MoneyTextProps) {
  const num = value ?? 0;
  const formatted = num.toLocaleString("zh-CN", {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: 2,
  });

  return (
    <span
      className={cn(
        "tabular-nums",
        tone === "income" && "text-green-600",
        tone === "expense" && "text-red-600",
        tone === "warning" && "text-amber-600",
        tone === "muted" && "text-muted-foreground",
        className
      )}
    >
      {showCurrency && "¥"}
      {formatted}
    </span>
  );
}
