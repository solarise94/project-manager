import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MetricItem {
  label: string;
  value: React.ReactNode;
}

interface FinanceMobileCardProps {
  title: React.ReactNode;
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  metrics?: MetricItem[];
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  moreActions?: Array<{
    label: string;
    onClick: () => void;
    destructive?: boolean;
  }>;
  onClick?: () => void;
  className?: string;
}

export function FinanceMobileCard({
  title,
  badge,
  subtitle,
  metrics,
  primaryAction,
  moreActions,
  onClick,
  className,
}: FinanceMobileCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer hover:bg-muted/30 transition-colors",
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        {/* Top: title + badge */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{title}</span>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>

        {/* Subtitle row */}
        {subtitle && (
          <div className="text-xs text-muted-foreground truncate">
            {subtitle}
          </div>
        )}

        {/* Metrics */}
        {metrics && metrics.length > 0 && (
          <div
            className={cn(
              "grid gap-x-4 gap-y-1 text-sm",
              metrics.length <= 2
                ? "grid-cols-2"
                : metrics.length <= 4
                  ? "grid-cols-2"
                  : "grid-cols-2"
            )}
          >
            {metrics.map((m, i) => (
              <div key={i} className="flex justify-between min-w-0">
                <span className="text-muted-foreground text-xs shrink-0">
                  {m.label}
                </span>
                <span className="font-medium truncate">{m.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Bottom actions */}
        {(primaryAction || (moreActions && moreActions.length > 0)) && (
          <div
            className="flex items-center gap-2 pt-1"
            onClick={(e) => e.stopPropagation()}
          >
            {primaryAction && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-9"
                onClick={(e) => {
                  e.stopPropagation();
                  primaryAction.onClick();
                }}
              >
                {primaryAction.icon}
                {primaryAction.label}
              </Button>
            )}
            {moreActions && moreActions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="h-9 px-2"><MoreHorizontal className="h-4 w-4" /></Button>} />
                <DropdownMenuContent align="end">
                  {moreActions.map((a, i) => (
                    <DropdownMenuItem
                      key={i}
                      onClick={(e) => {
                        e.stopPropagation();
                        a.onClick();
                      }}
                      className={cn(a.destructive && "text-destructive")}
                    >
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
