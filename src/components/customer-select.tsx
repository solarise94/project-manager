"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

interface CustOption {
  id: string;
  customerCode: string;
  name: string;
  organization: string | null;
  organizationId: string | null;
}

interface CustomerSelectProps {
  value: string;
  displayValue?: string;
  onChange: (id: string | null, name: string, organization?: string | null, organizationId?: string | null) => void;
}

export function CustomerSelect({ value, displayValue, onChange }: CustomerSelectProps) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const isReadOnly = session?.user?.role === "REPRESENTATIVE";

  const { data } = useQuery<{ customers: CustOption[] }>({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const res = await fetch("/api/customers/list");
      if (!res.ok) throw new Error("Failed to load customers");
      return res.json();
    },
  });

  const quickCreateMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      return data.customer as CustOption;
    },
    onSuccess: (customer) => {
      toast.success(`客户 "${customer.name}" 已创建`);
      onChange(customer.id, customer.name, customer.organization, customer.organizationId);
      setQuickName("");
      setShowQuickAdd(false);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const custs = data?.customers || [];
  const selected = custs.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        {selected ? `${selected.name} (${selected.customerCode})` : displayValue || "选择客户..."}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索客户..." />
          <CommandList>
            <CommandEmpty>
              <div className="py-2 text-center text-sm text-muted-foreground">
                {isReadOnly ? "未找到客户" : "未找到客户，可快速添加"}
              </div>
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onChange(null, "");
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                不选择客户
              </CommandItem>
              {custs.map((c) => (
                <CommandItem
                  key={c.id}
                  onSelect={() => {
                    onChange(c.id, c.name, c.organization, c.organizationId);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex flex-col">
                    <span>{c.name} <span className="text-xs text-muted-foreground">({c.customerCode})</span></span>
                    {c.organization && <span className="text-xs text-muted-foreground">{c.organization}</span>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {!isReadOnly && (
              <CommandGroup>
                {showQuickAdd ? (
                  <div className="flex items-center gap-2 p-2">
                    <Input
                      placeholder="客户姓名"
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
                  <CommandItem onSelect={() => setShowQuickAdd(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    快速添加客户
                  </CommandItem>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
