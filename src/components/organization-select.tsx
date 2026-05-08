"use client";

import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

interface OrgOption {
  id: string;
  orgCode: string;
  canonicalName: string;
  address: string | null;
  taxId: string | null;
}

interface OrganizationSelectProps {
  value: string;
  displayValue?: string;
  disabled?: boolean;
  onChange: (id: string | null, canonicalName: string, address?: string | null, taxId?: string | null) => void;
}

export function OrganizationSelect({ value, displayValue, disabled, onChange }: OrganizationSelectProps) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [quickName, setQuickName] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const isRep = session?.user?.role === "REPRESENTATIVE";

  const { data } = useQuery<{ organizations: OrgOption[] }>({
    queryKey: ["organizations-list", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/organizations/list?${params}`);
      if (!res.ok) throw new Error("Failed to load organizations");
      return res.json();
    },
    enabled: !isRep && open,
  });

  const quickCreateMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/organizations/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonicalName: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      return { org: data.organization as OrgOption, created: data.created as boolean };
    },
    onSuccess: ({ org, created }) => {
      if (created) {
        toast.success(`单位 "${org.canonicalName}" 已创建`);
      } else {
        toast.info(`已存在同名单位：${org.canonicalName}`);
      }
      onChange(org.id, org.canonicalName, org.address, org.taxId);
      setQuickName("");
      setShowQuickAdd(false);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["organizations-list"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const orgs = data?.organizations || [];
  const selected = orgs.find((o) => o.id === value);

  // Rep-only: uncontrolled input, resolution triggered on blur to avoid calling resolve on every keystroke
  const repInputRef = useRef<HTMLInputElement>(null);

  if (isRep) {
    return (
      <Input
        ref={repInputRef}
        key={displayValue || "__rep_empty__"}
        placeholder="输入单位名称"
        defaultValue={displayValue || ""}
        onBlur={() => {
          const v = repInputRef.current?.value?.trim() || "";
          if (v !== (displayValue || "")) {
            onChange(null, v);
          }
        }}
        disabled={disabled}
      />
    );
  }

  if (disabled) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-muted/50">
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span>{displayValue || "未选择单位"}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSearch(""); setShowQuickAdd(false); } }}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          />
        }
      >
          <span className="truncate">
            {selected ? `${selected.canonicalName} (${selected.orgCode})` : displayValue || "选择单位..."}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="p-2">
          <Input
            placeholder="搜索单位..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          <div
            className="px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded-sm mx-1"
            onClick={() => { onChange(null, ""); setOpen(false); }}
          >
            <div className="flex items-center gap-2">
              <Check className={cn("h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
              不选择单位
            </div>
          </div>
          {orgs.map((o) => (
            <div
              key={o.id}
              className="px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded-sm mx-1"
              onClick={() => { onChange(o.id, o.canonicalName, o.address, o.taxId); setOpen(false); }}
            >
              <div className="flex items-center gap-2">
                <Check className={cn("h-4 w-4", value === o.id ? "opacity-100" : "opacity-0")} />
                <div className="flex flex-col min-w-0">
                  <span className="truncate">{o.canonicalName} <span className="text-xs text-muted-foreground">({o.orgCode})</span></span>
                  {o.address && <span className="text-xs text-muted-foreground truncate">{o.address}</span>}
                </div>
              </div>
            </div>
          ))}
          {orgs.length === 0 && search && (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">
              未找到匹配单位
            </div>
          )}
        </div>
        <div className="border-t p-2">
          {showQuickAdd ? (
            <div className="flex items-center gap-2">
              <Input
                placeholder="单位名称"
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && quickName.trim()) {
                    e.preventDefault();
                    quickCreateMutation.mutate(quickName.trim());
                  }
                  if (e.key === "Escape") setShowQuickAdd(false);
                }}
                className="h-8 text-sm"
                autoFocus
              />
              <Button
                size="sm"
                className="h-8 shrink-0"
                disabled={!quickName.trim() || quickCreateMutation.isPending}
                onClick={() => quickName.trim() && quickCreateMutation.mutate(quickName.trim())}
              >
                {quickCreateMutation.isPending ? "..." : "添加"}
              </Button>
            </div>
          ) : (
            <div
              className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded-sm"
              onClick={() => setShowQuickAdd(true)}
            >
              <Plus className="h-4 w-4" />
              快速添加单位
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
