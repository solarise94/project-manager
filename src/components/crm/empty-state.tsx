"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface CrmEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function CrmEmptyState({ icon: Icon, title, description, className }: CrmEmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 text-muted-foreground", className)}>
      <Icon className="h-10 w-10 mb-3 opacity-40" strokeWidth={1.5} />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs mt-1 max-w-[240px] text-center">{description}</p>}
    </div>
  );
}
