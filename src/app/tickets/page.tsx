"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Ticket, Filter, ArrowRight } from "lucide-react";
import { TicketItem } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger } from "@/components/ui/select";

const PRIORITY_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  LOW: { label: "低", variant: "secondary" },
  MEDIUM: { label: "中", variant: "default" },
  HIGH: { label: "高", variant: "destructive" },
  URGENT: { label: "紧急", variant: "destructive" },
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  OPEN: { label: "打开", variant: "secondary" },
  IN_PROGRESS: { label: "处理中", variant: "default" },
  CLOSED: { label: "已关闭", variant: "outline" },
};

export default function TicketsPage() {
  const { status } = useSession();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const TICKET_STATUS_LABELS: Record<string, string> = { ALL: "全部状态", OPEN: "打开", IN_PROGRESS: "处理中", CLOSED: "已关闭" };

  const { data, isLoading } = useQuery<{ tickets: TicketItem[] }>({
    queryKey: ["tickets", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await fetch(`/api/tickets?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json();
    },
    enabled: status === "authenticated",
  });

  if (status === "loading") return null;

  const tickets = data?.tickets || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">工单</h1>
          <p className="text-muted-foreground">跟踪项目中的任务与问题</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v || "ALL")}>
            <SelectTrigger className="w-[140px]">
              <SelectDisplay label="状态" valueLabel={TICKET_STATUS_LABELS[statusFilter]} placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部状态</SelectItem>
              <SelectItem value="OPEN">打开</SelectItem>
              <SelectItem value="IN_PROGRESS">处理中</SelectItem>
              <SelectItem value="CLOSED">已关闭</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <Ticket className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">暂无工单</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Card key={ticket.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium">{ticket.title}</h3>
                      <Badge variant={PRIORITY_CONFIG[ticket.priority]?.variant || "secondary"}>
                        {PRIORITY_CONFIG[ticket.priority]?.label || ticket.priority}
                      </Badge>
                      <Badge variant={STATUS_CONFIG[ticket.status]?.variant || "secondary"}>
                        {STATUS_CONFIG[ticket.status]?.label || ticket.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span>项目: {ticket.project?.name || "-"}</span>
                      {ticket.assignee && <span>负责人: {ticket.assignee.name}</span>}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
