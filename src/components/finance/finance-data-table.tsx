import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { FinanceEmptyState } from "./finance-empty-state";
import { MoneyText } from "./money-text";

type ColumnAlign = "left" | "right" | "center";

interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: ColumnAlign;
  width?: string;
  className?: string;
  render?: (row: T, index: number) => React.ReactNode;
  money?: boolean;
}

interface FinanceDataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function FinanceDataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  className,
}: FinanceDataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <FinanceEmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  const alignClass = (align?: ColumnAlign) =>
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";

  return (
    <div className={cn("overflow-x-auto rounded-lg border", className)}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 sticky top-0">
          <tr className="border-b">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "py-2.5 px-3 font-medium text-muted-foreground whitespace-nowrap",
                  alignClass(col.align),
                  col.className
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr
              key={keyExtractor(row, rowIndex)}
              className={cn(
                "border-b transition-colors",
                onRowClick && "hover:bg-muted/50 cursor-pointer"
              )}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "py-2.5 px-3",
                    alignClass(col.align),
                    col.className
                  )}
                >
                  {col.render ? (
                    col.render(row, rowIndex)
                  ) : col.money ? (
                    <MoneyText
                      value={((row as Record<string, unknown>)[col.key] as number) ?? 0}
                      className="justify-end"
                    />
                  ) : (
                    String(((row as Record<string, unknown>)[col.key] as string) ?? "-")
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
