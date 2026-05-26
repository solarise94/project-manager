"use client";

import { AlertTriangle, CheckCircle2, Search, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AgentToolRun } from "./chat-panel";

function isProjectSearchResult(value: unknown): value is {
  items: Array<{
    id: string;
    name: string;
    status?: string | null;
    representative?: string | null;
    updatedAt?: string | null;
  }>;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      "items" in value &&
      Array.isArray((value as { items?: unknown }).items),
  );
}

function isProjectSummaryResult(value: unknown): value is {
  project?: {
    name?: string;
    status?: string;
    customerName?: string | null;
    representative?: string | null;
  };
  counts?: {
    tickets?: number;
    comments?: number;
    attachments?: number;
    linkedOrders?: number;
    members?: number;
  };
  recentTickets?: Array<{
    id: string;
    title: string;
    status: string;
  }>;
} {
  return Boolean(value && typeof value === "object" && "project" in value);
}

function renderStructuredResult(toolRun: AgentToolRun) {
  if (toolRun.status !== "done") return null;

  if (toolRun.actionKey === "projects.search" && isProjectSearchResult(toolRun.result)) {
    return (
      <div className="space-y-2">
        {toolRun.result.items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
            没有匹配项目。
          </div>
        ) : (
          toolRun.result.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border/70 bg-muted/15 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{item.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.representative ? `代表 ${item.representative}` : "未填写代表"}
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {item.status ?? "UNKNOWN"}
                </Badge>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (toolRun.actionKey === "projects.get_summary" && isProjectSummaryResult(toolRun.result)) {
    const project = toolRun.result.project;
    const counts = toolRun.result.counts;
    const recentTickets = toolRun.result.recentTickets ?? [];
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-3">
          <div className="text-sm font-medium text-foreground">{project?.name ?? "项目摘要"}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>状态：{project?.status ?? "-"}</div>
            <div>客户：{project?.customerName ?? "-"}</div>
            <div>代表：{project?.representative ?? "-"}</div>
            <div>成员：{counts?.members ?? 0}</div>
            <div>工单：{counts?.tickets ?? 0}</div>
            <div>订单：{counts?.linkedOrders ?? 0}</div>
          </div>
        </div>
        {recentTickets.length > 0 ? (
          <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              最近工单
            </div>
            <div className="space-y-2">
              {recentTickets.map((ticket, index) => (
                <div key={ticket.id} className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-foreground">{index + 1}. {ticket.title}</div>
                  <Badge variant="outline" className="rounded-full">
                    {ticket.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

export function ActionResultPanel({
  toolRuns,
}: {
  toolRuns: AgentToolRun[];
}) {
  return (
    <Card className="flex min-h-[24rem] flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          工具结果
        </CardTitle>
        <Badge variant="outline" className="rounded-md">
          {toolRuns.length}
        </Badge>
      </CardHeader>

      <ScrollArea className="flex-1">
        <CardContent className="space-y-3 px-4 py-4">
          {toolRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-5 text-sm text-muted-foreground">
              对话触发查询后，最近一次工具执行会出现在这里。
            </div>
          ) : null}

          {toolRuns.map((toolRun, index) => {
            const structuredResult = renderStructuredResult(toolRun);
            return (
              <div key={`${toolRun.actionKey}-${index}`} className="rounded-lg border border-border/70 bg-background px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{toolRun.actionKey}</div>
                    {toolRun.reason ? <div className="mt-1 text-xs text-muted-foreground">{toolRun.reason}</div> : null}
                  </div>
                  <Badge variant={toolRun.status === "done" ? "secondary" : "destructive"} className="rounded-md">
                    {toolRun.status === "done" ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {toolRun.status}
                  </Badge>
                </div>

                <div className="mt-3 rounded-md bg-muted/30 p-2.5 text-[11px] leading-5 text-muted-foreground">
                  <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
                    <Search className="h-3 w-3" />
                    input
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(toolRun.input, null, 2)}</pre>
                </div>

                {structuredResult ? (
                  <div className="mt-2">{structuredResult}</div>
                ) : (
                  <div className="mt-2 rounded-md bg-muted/20 p-2.5 text-[11px] leading-5 text-muted-foreground">
                    <div className="mb-1 font-medium text-foreground">result</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words">
                      {toolRun.status === "done"
                        ? JSON.stringify(toolRun.result, null, 2)
                        : toolRun.error}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}
