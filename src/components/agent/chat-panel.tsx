"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  User,
  WandSparkles,
  XCircle,
} from "lucide-react";
import type { AgentTimelineItem, AgentViewIntent } from "@/lib/agent-runtime/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface AgentToolRun {
  actionKey: string;
  reason?: string;
  input: Record<string, unknown>;
  status: "done" | "error";
  result?: unknown;
  error?: string;
}

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  state?: string;
  timeline?: AgentTimelineItem[];
  toolRuns?: AgentToolRun[];
  followUps?: string[];
  proposals?: AgentProposal[];
}

export interface AgentProposal {
  id: string;
  agentRunId?: string | null;
  actionKey: string;
  title: string;
  summary: string;
  riskLevel: "safe" | "confirm" | "restricted";
  status: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  createdAt: string;
  decidedAt?: string | null;
}

export interface AgentRunSummary {
  id: string;
  userId: string;
  role: string;
  name?: string | null;
  email?: string | null;
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
}

function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function formatDateLabel(dateStr: string) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "今天";
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-2">
      <span
        className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
        style={{ animationDelay: "120ms" }}
      />
      <span
        className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
        style={{ animationDelay: "240ms" }}
      />
    </div>
  );
}

function DateSeparator({ dateStr }: { dateStr: string }) {
  return (
    <div className="flex items-center justify-center py-4">
      <span className="rounded-full border border-border/50 bg-background/80 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        {formatDateLabel(dateStr)}
      </span>
    </div>
  );
}

function CollapsibleToolRun({ toolRun }: { toolRun: AgentToolRun }) {
  const [open, setOpen] = useState(false);
  const isDone = toolRun.status === "done";

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-xs",
        isDone
          ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-950"
          : "border-rose-200/80 bg-rose-50/70 text-rose-950",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2"
      >
        <div className="flex items-center gap-1.5 font-medium">
          {isDone ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />
          )}
          <span>{toolRun.actionKey}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <span className="text-[11px]">{isDone ? "成功" : "失败"}</span>
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>

      {toolRun.reason ? <div className="mt-1 text-[11px] opacity-80">{toolRun.reason}</div> : null}

      {open ? (
        <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
          <div>
            <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">Input</div>
            <pre className="max-h-32 overflow-auto rounded-md bg-background/80 p-2 text-[11px] leading-4">
              {JSON.stringify(toolRun.input, null, 2)}
            </pre>
          </div>
          <div>
            <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">
              {isDone ? "Result" : "Error"}
            </div>
            <pre className="max-h-40 overflow-auto rounded-md bg-background/80 p-2 text-[11px] leading-4">
              {isDone ? JSON.stringify(toolRun.result, null, 2) : toolRun.error}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChatEmptyState({ onUseFollowUp }: { onUseFollowUp: (value: string) => void }) {
  const suggestions = [
    "帮我找最近待回款的订单",
    "查一下最近活跃的 CRM 客户",
    "汇总本周项目状态变化",
    "帮我新建一个跟进任务",
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/[0.08] shadow-sm">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-tight">SciManage Agent</h3>
      <p className="mt-2 max-w-md text-center text-sm leading-6 text-muted-foreground">
        直接提问即可查询项目、订单、CRM 与财务信息。新的 runtime 会保留会话上下文、compact 摘要和 memory。
      </p>
      <div className="mt-7 flex w-full max-w-xl flex-col gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onUseFollowUp(suggestion)}
            className="rounded-2xl border border-border/70 bg-background/90 px-4 py-3 text-left text-sm text-foreground shadow-sm transition-colors hover:bg-muted/40"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimelineItemView({
  item,
  onApplyViewIntent,
}: {
  item: AgentTimelineItem;
  onApplyViewIntent?: (intent: AgentViewIntent) => void;
}) {
  if (item.kind === "thinking") {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-700">
        <div className="font-medium text-slate-900">Thinking</div>
        {item.content ? <div className="mt-1 whitespace-pre-wrap leading-5">{item.content}</div> : null}
      </div>
    );
  }

  if (item.kind === "tool") {
    return (
      <div
        className={cn(
          "rounded-xl border px-3 py-2 text-xs",
          item.status === "error"
            ? "border-rose-200/80 bg-rose-50/80 text-rose-950"
            : item.status === "done"
              ? "border-emerald-200/80 bg-emerald-50/80 text-emerald-950"
              : "border-sky-200/80 bg-sky-50/80 text-sky-950",
        )}
      >
        <div className="font-medium">{item.label}</div>
        {item.error ? <div className="mt-1 leading-5">{item.error}</div> : null}
      </div>
    );
  }

  if (item.kind === "compact") {
    return (
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
        <div className="font-medium">Compact</div>
        {item.content ? <div className="mt-1 whitespace-pre-wrap leading-5">{item.content}</div> : null}
      </div>
    );
  }

  if (item.kind === "memory") {
    return (
      <div className="rounded-xl border border-violet-200/80 bg-violet-50/80 px-3 py-2 text-xs text-violet-950">
        <div className="font-medium">Memory</div>
        <div className="mt-1 leading-5">{item.content}</div>
      </div>
    );
  }

  if (item.kind === "view") {
    return (
      <div className="rounded-xl border border-cyan-200/80 bg-cyan-50/80 px-3 py-2 text-xs text-cyan-950">
        <div className="font-medium">View Intent</div>
        <div className="mt-1 leading-5">{item.intent.label}</div>
        {item.intent.reason ? <div className="mt-1 leading-5 opacity-80">{item.intent.reason}</div> : null}
        {onApplyViewIntent ? (
          <div className="mt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full border-cyan-300/80 bg-white/80 px-3 text-[11px]"
              onClick={() => onApplyViewIntent(item.intent)}
            >
              应用视图
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (item.kind === "proactive") {
    return (
      <div className="rounded-xl border border-fuchsia-200/80 bg-fuchsia-50/80 px-3 py-2 text-xs text-fuchsia-950">
        <div className="font-medium">Proactive</div>
        <div className="mt-1 leading-5">{item.content}</div>
      </div>
    );
  }

  return null;
}

function MessageTimeline({
  items,
  onApplyViewIntent,
}: {
  items: AgentTimelineItem[];
  onApplyViewIntent?: (intent: AgentViewIntent) => void;
}) {
  const visibleItems = items.filter((item) => item.kind !== "text");
  if (visibleItems.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {visibleItems.map((item) => (
        <TimelineItemView key={item.id} item={item} onApplyViewIntent={onApplyViewIntent} />
      ))}
    </div>
  );
}

export function AgentChatPanel({
  messages,
  draft,
  busy,
  compactBusy,
  chatLabel,
  agentRunId,
  sessionId,
  proposalBusyId,
  userName,
  onDraftChange,
  onSend,
  onUseFollowUp,
  onConfirmProposal,
  onRejectProposal,
  onCompact,
  onApplyViewIntent,
}: {
  messages: AgentChatMessage[];
  draft: string;
  busy: boolean;
  compactBusy?: boolean;
  chatLabel?: string;
  agentRunId?: string | null;
  sessionId?: string | null;
  proposalBusyId?: string | null;
  userName?: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onUseFollowUp: (value: string) => void;
  onConfirmProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string) => void;
  onCompact?: () => void;
  onApplyViewIntent?: (intent: AgentViewIntent) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
      <header className="border-b border-border/50 px-6 py-4 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold tracking-tight">{chatLabel || "Agent 对话"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {sessionId ? `会话 ${sessionId.slice(-8)}` : "新会话"}
              {agentRunId ? ` · Run ${agentRunId.slice(-8)}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onCompact ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full"
                disabled={busy || compactBusy}
                onClick={onCompact}
              >
                {compactBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                Compact
              </Button>
            ) : null}
            <Badge variant="outline" className="gap-1 rounded-full border-border/70 bg-background/80 px-3 py-1">
              <Sparkles className="h-3 w-3" />
              Pi SDK · MiniMax
            </Badge>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="mx-auto flex w-full max-w-4xl flex-col px-4 py-5 sm:px-6">
          {messages.length === 0 ? (
            <ChatEmptyState onUseFollowUp={onUseFollowUp} />
          ) : (
            messages.map((message, index) => {
              const showDate = index === 0 || !isSameDay(messages[index - 1].createdAt, message.createdAt);
              const isLastInGroup =
                index === messages.length - 1 ||
                messages[index + 1].role !== message.role ||
                !isSameDay(messages[index + 1].createdAt, message.createdAt);

              return (
                <div key={message.id}>
                  {showDate ? <DateSeparator dateStr={message.createdAt} /> : null}
                  <MessageRow
                    message={message}
                    isLastInGroup={isLastInGroup}
                    userName={userName}
                    proposalBusyId={proposalBusyId}
                    onConfirmProposal={onConfirmProposal}
                    onRejectProposal={onRejectProposal}
                    onUseFollowUp={onUseFollowUp}
                    onApplyViewIntent={onApplyViewIntent}
                  />
                </div>
              );
            })
          )}

          {busy ? (
            <div className="flex items-start gap-3 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.05]">
                <Sparkles className="h-4 w-4 text-foreground/70" />
              </div>
              <div className="rounded-3xl rounded-tl-lg border border-border/60 bg-white/90 px-4 py-2.5 shadow-sm">
                <TypingIndicator />
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-t border-border/50 bg-background/85 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl">
          <div className="rounded-[24px] border border-border/70 bg-white/95 p-3 shadow-sm">
            <div className="flex items-end gap-3">
              <Textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder="给 SciManage Agent 发消息"
                className="min-h-[88px] resize-none border-0 bg-transparent px-1 py-1 text-sm shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    onSend();
                  }
                }}
              />
              <Button
                size="icon-lg"
                onClick={onSend}
                disabled={busy || !draft.trim()}
                className="h-11 w-11 shrink-0 rounded-full"
              >
                <SendHorizontal className="h-4 w-4" />
                <span className="sr-only">发送</span>
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
              <span>{userName ? `当前用户：${userName}` : "当前会话已启用服务端持久化"}</span>
              <span>Ctrl/Cmd + Enter 发送</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageRow({
  message,
  isLastInGroup,
  userName,
  proposalBusyId,
  onConfirmProposal,
  onRejectProposal,
  onUseFollowUp,
  onApplyViewIntent,
}: {
  message: AgentChatMessage;
  isLastInGroup: boolean;
  userName?: string | null;
  proposalBusyId?: string | null;
  onConfirmProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string) => void;
  onUseFollowUp: (value: string) => void;
  onApplyViewIntent?: (intent: AgentViewIntent) => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3 py-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.05]">
          <Sparkles className="h-4 w-4 text-foreground/70" />
        </div>
      ) : null}

      <div className={cn("flex max-w-[86%] flex-col", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-3xl px-4 py-3 text-sm leading-7 shadow-sm",
            isUser
              ? "rounded-tr-lg bg-primary text-primary-foreground"
              : "rounded-tl-lg border border-border/60 bg-white/95 text-foreground",
          )}
        >
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>

        {!isUser && message.timeline && message.timeline.length > 0 ? (
          <div className="w-full">
            <MessageTimeline items={message.timeline} onApplyViewIntent={onApplyViewIntent} />
          </div>
        ) : null}

        {message.toolRuns && message.toolRuns.length > 0 ? (
          <div className="mt-3 w-full space-y-2">
            {message.toolRuns.map((toolRun) => (
              <CollapsibleToolRun key={`${message.id}-${toolRun.actionKey}`} toolRun={toolRun} />
            ))}
          </div>
        ) : null}

        {message.proposals && message.proposals.length > 0 ? (
          <div className="mt-3 w-full space-y-2">
            {message.proposals.map((proposal) => (
              <div
                key={proposal.id}
                className="rounded-2xl border border-amber-200/80 bg-amber-50/85 px-3 py-3 text-xs text-amber-950"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <div>
                      <div className="font-medium">{proposal.title}</div>
                      <div className="mt-1 leading-5 opacity-80">{proposal.summary}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 rounded-full border-amber-300/70 bg-white/70 text-amber-950">
                    {proposal.status}
                  </Badge>
                </div>

                {proposal.status === "PENDING" ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="h-8 rounded-full"
                      disabled={proposalBusyId === proposal.id}
                      onClick={() => onConfirmProposal(proposal.id)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      确认执行
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full border-amber-300/70 bg-transparent"
                      disabled={proposalBusyId === proposal.id}
                      onClick={() => onRejectProposal(proposal.id)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      暂不执行
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {message.followUps && message.followUps.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.followUps.map((followUp) => (
              <button
                key={followUp}
                type="button"
                onClick={() => onUseFollowUp(followUp)}
                className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
              >
                {followUp}
              </button>
            ))}
          </div>
        ) : null}

        {isLastInGroup ? (
          <div className="mt-1 px-1 text-[11px] text-muted-foreground">
            {isUser && userName ? `${userName} · ` : ""}
            {formatTime(message.createdAt)}
          </div>
        ) : null}
      </div>

      {isUser ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12">
          <User className="h-4 w-4 text-primary" />
        </div>
      ) : null}
    </div>
  );
}
