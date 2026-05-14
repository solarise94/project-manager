import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { MoneyText } from "./money-text";

interface FinanceKpiCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  description?: string;
  variant?: "default" | "warning" | "danger" | "success" | "muted";
  className?: string;
}

export function FinanceKpiCard({
  title,
  value,
  icon: Icon,
  description,
  variant = "default",
  className,
}: FinanceKpiCardProps) {
  const tone =
    variant === "warning"
      ? "warning"
      : variant === "danger"
        ? "expense"
        : variant === "success"
          ? "income"
          : variant === "muted"
            ? "muted"
            : "default";

  return (
    <Card
      className={cn(
        variant === "warning" && "border-amber-500/50 bg-amber-50/30",
        variant === "danger" && "border-red-500/50 bg-red-50/30",
        variant === "success" && "border-green-500/50 bg-green-50/30",
        variant === "muted" && "border-muted-foreground/20 bg-muted/20",
        className
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          <MoneyText value={value} tone={tone} />
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
