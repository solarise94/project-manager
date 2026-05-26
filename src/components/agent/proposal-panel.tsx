"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AgentProposal } from "./chat-panel";

const PROPOSAL_STATUS_OPTIONS = ["PENDING", "CONFIRMED", "REJECTED", "FAILED"] as const;

function renderProposalInput(input: AgentProposal["input"]) {
  const entries = Object.entries(input ?? {}).filter(([, value]) => value != null && value !== "");
  if (entries.length === 0) return "无额外参数";
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join("\n");
}

export function ProposalPanel({
  proposals,
  busyProposalId,
  onConfirm,
  onReject,
}: {
  proposals: AgentProposal[];
  busyProposalId?: string | null;
  onConfirm: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<(typeof PROPOSAL_STATUS_OPTIONS)[number] | "ALL">("PENDING");
  const visibleProposals = useMemo(
    () =>
      statusFilter === "ALL"
        ? proposals
        : proposals.filter((proposal) => proposal.status === statusFilter),
    [proposals, statusFilter]
  );

  return (
    <Card className="flex min-h-[16rem] flex-col h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          待确认动作
        </CardTitle>
        <Badge variant="outline" className="rounded-md">
          {proposals.filter((proposal) => proposal.status === "PENDING").length}
        </Badge>
      </CardHeader>

      <div className="flex flex-wrap gap-2 border-b px-4 py-3">
        <Button
          type="button"
          size="sm"
          variant={statusFilter === "ALL" ? "secondary" : "outline"}
          className="h-7 rounded-md text-xs"
          onClick={() => setStatusFilter("ALL")}
        >
          全部
        </Button>
        {PROPOSAL_STATUS_OPTIONS.map((status) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant={statusFilter === status ? "secondary" : "outline"}
            className="h-7 rounded-md text-xs"
            onClick={() => setStatusFilter(status)}
          >
            {status}
          </Button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <CardContent className="space-y-3 px-4 py-4">
          {visibleProposals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-5 text-sm text-muted-foreground">
              当前筛选下没有 proposal。
            </div>
          ) : null}

          {visibleProposals.map((proposal) => (
            <div key={proposal.id} className="rounded-lg border border-border/70 bg-background px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{proposal.title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{proposal.summary}</div>
                </div>
                <Badge variant={proposal.status === "PENDING" ? "secondary" : "outline"} className="rounded-md shrink-0">
                  {proposal.status}
                </Badge>
              </div>

              <div className="mt-2 text-[11px] text-muted-foreground">
                {new Date(proposal.createdAt).toLocaleString("zh-CN")}
              </div>

              <div className="mt-3 rounded-md bg-muted/25 p-2.5 text-[11px] leading-5 text-muted-foreground">
                <div className="font-medium text-foreground">target</div>
                <div className="mt-1">
                  {proposal.targetType || proposal.targetId
                    ? `${proposal.targetType ?? "unknown"} · ${proposal.targetId ?? "-"}`
                    : "未绑定目标对象"}
                </div>
              </div>

              <div className="mt-2 rounded-md bg-muted/15 p-2.5 text-[11px] leading-5 text-muted-foreground">
                <div className="font-medium text-foreground">input</div>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">
                  {renderProposalInput(proposal.input)}
                </pre>
              </div>

              {proposal.result ? (
                <div className="mt-2 rounded-md bg-emerald-50 p-2.5 text-[11px] leading-5 text-emerald-950">
                  <div className="font-medium">result</div>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(proposal.result, null, 2)}
                  </pre>
                </div>
              ) : null}

              {proposal.error ? (
                <div className="mt-2 rounded-md bg-rose-50 p-2.5 text-[11px] leading-5 text-rose-950">
                  <div className="font-medium">error</div>
                  <div className="mt-1 whitespace-pre-wrap break-words">{proposal.error}</div>
                </div>
              ) : null}

              {proposal.status === "PENDING" ? (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    className="h-8 rounded-md"
                    disabled={busyProposalId === proposal.id}
                    onClick={() => onConfirm(proposal.id)}
                  >
                    {busyProposalId === proposal.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    确认
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-md"
                    disabled={busyProposalId === proposal.id}
                    onClick={() => onReject(proposal.id)}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    拒绝
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}
