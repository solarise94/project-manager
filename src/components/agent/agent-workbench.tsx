"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  BellDot,
  BrainCircuit,
  FolderKanban,
  HeartHandshake,
  Loader2,
  MessageSquareText,
  Package,
  Plus,
  Search,
  Sparkles,
  ScissorsLineDashed,
} from "lucide-react";
import { toast } from "sonner";
import type { AgentTimelineItem, AgentViewIntent } from "@/lib/agent-runtime/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentChatPanel, type AgentChatMessage, type AgentProposal } from "./chat-panel";
import { ProposalPanel } from "./proposal-panel";

interface AgentActionSummary {
  key: string;
  title: string;
  description: string;
  domain: "projects" | "orders" | "crm" | "finance" | "tickets";
  riskLevel: "safe" | "confirm" | "restricted";
  readOnly: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

interface AgentChatSessionSummary {
  id: string;
  agentRunId?: string | null;
  title?: string | null;
  status: string;
  source: string;
  compactSummary?: string | null;
  lastMessageAt: string;
  messageCount: number;
}

interface AgentChatSessionDetail extends AgentChatSessionSummary {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    state: string;
    timeline: AgentTimelineItem[];
    createdAt: string;
  }>;
}

interface AgentMemoryItem {
  id: string;
  kind: string;
  content: string;
  confidence: number;
  status: string;
  updatedAt: string;
}

interface AgentProactiveTaskItem {
  id: string;
  kind: string;
  title: string;
  status: string;
  triggerAt: string;
}

type RuntimeEvent =
  | { type: "thinking_delta"; id: string; delta: string }
  | { type: "text_delta"; id: string; delta: string }
  | { type: "tool_start"; id: string; tool_name: string; label?: string; input?: unknown }
  | { type: "tool_end"; id: string; tool_name: string; label?: string; output?: unknown }
  | { type: "tool_error"; id: string; tool_name: string; label?: string; error?: string }
  | { type: "compact_start"; id: string; tokens_before?: number }
  | { type: "compact_end"; id: string; summary?: string; tokens_before?: number; tokens_after?: number }
  | { type: "memory_suggestion"; id?: string; memory?: Record<string, unknown> }
  | { type: "view_intent"; id?: string; intent?: Record<string, unknown> }
  | { type: "proactive_task_suggestion"; id?: string; task?: Record<string, unknown> }
  | { type: "message_end"; content?: string }
  | { type: "error"; error?: string }
  | { type: "usage"; usage?: Record<string, unknown> };

const DOMAIN_ICON = {
  projects: FolderKanban,
  orders: Package,
  crm: HeartHandshake,
  finance: Sparkles,
  tickets: Search,
};

const DOMAIN_HINT = {
  projects: "适合问项目进度、成员、最近工单",
  orders: "适合问订单状态、回款、项目关联",
  crm: "适合问客户资料、跟进任务、联系人",
  finance: "适合问开票准备、财务摘要",
  tickets: "适合让它整理文本并生成待确认工单",
} as const;

const ACTION_EXAMPLES: Record<string, string> = {
  "projects.search": "比如：帮我找肺癌相关项目",
  "projects.get_summary": "比如：继续看这个项目的摘要",
  "projects.draft_from_text": "比如：把这段需求整理成项目草稿",
  "orders.search": "比如：查最近待回款的订单",
  "orders.get_finance_snapshot": "比如：看这个订单的财务摘要",
  "orders.link_to_project": "比如：把这个订单挂到某个项目下",
  "crm.search_customers": "比如：找张老师相关客户",
  "crm.create_followup_task": "比如：帮我给这个客户建个跟进提醒",
  "finance.prepare_invoice_draft": "比如：先准备一份开票草稿",
  "tickets.create_from_text": "比如：把这段需求整理成工单",
};

function createMessage(role: "user" | "assistant", content: string, extra: Partial<AgentChatMessage> = {}): AgentChatMessage {
  return {
    id: `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function formatSessionTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createStreamingAssistantMessage() {
  return createMessage("assistant", "", {
    state: "streaming",
    timeline: [],
  });
}

function mapSessionMessage(message: AgentChatSessionDetail["messages"][number]): AgentChatMessage {
  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    createdAt: message.createdAt,
    state: message.state,
    timeline: Array.isArray(message.timeline) ? message.timeline : [],
  };
}

function upsertTimeline(messages: AgentChatMessage[], messageId: string, updater: (timeline: AgentTimelineItem[]) => void) {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const timeline = [...(message.timeline ?? [])];
    updater(timeline);
    return { ...message, timeline };
  });
}

function upsertThinkingItem(timeline: AgentTimelineItem[], id: string, delta: string) {
  const existing = timeline.find((item) => item.kind === "thinking" && item.id === id);
  if (existing && existing.kind === "thinking") {
    existing.content = `${existing.content || ""}${delta}`;
    existing.status = "running";
    return;
  }
  timeline.push({ id, kind: "thinking", content: delta, status: "running" });
}

function upsertToolItem(
  timeline: AgentTimelineItem[],
  id: string,
  patch: Partial<Extract<AgentTimelineItem, { kind: "tool" }>> & { toolName: string; label: string },
) {
  const existing = timeline.find((item) => item.kind === "tool" && item.id === id);
  if (existing && existing.kind === "tool") {
    Object.assign(existing, patch);
    return;
  }
  timeline.push({
    id,
    kind: "tool",
    toolName: patch.toolName,
    label: patch.label,
    status: patch.status || "running",
    input: patch.input,
    output: patch.output,
    error: patch.error,
  });
}

function upsertCompactItem(
  timeline: AgentTimelineItem[],
  id: string,
  patch: Partial<Extract<AgentTimelineItem, { kind: "compact" }>>,
) {
  const existing = timeline.find((item) => item.kind === "compact" && item.id === id);
  if (existing && existing.kind === "compact") {
    Object.assign(existing, patch);
    return;
  }
  timeline.push({
    id,
    kind: "compact",
    content: typeof patch.content === "string" ? patch.content : "",
    status: patch.status || "running",
    tokensBefore: patch.tokensBefore,
    tokensAfter: patch.tokensAfter,
  });
}

function appendRuntimeEvent(messages: AgentChatMessage[], assistantId: string, event: RuntimeEvent) {
  if (event.type === "text_delta") {
    return messages.map((message) => (
      message.id === assistantId
        ? { ...message, content: `${message.content}${event.delta}` }
        : message
    ));
  }

  if (event.type === "thinking_delta") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      upsertThinkingItem(timeline, event.id, event.delta);
    });
  }

  if (event.type === "tool_start") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      upsertToolItem(timeline, event.id, {
        toolName: event.tool_name,
        label: event.label || event.tool_name,
        status: "running",
        input: event.input,
      });
    });
  }

  if (event.type === "tool_end") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      upsertToolItem(timeline, event.id, {
        toolName: event.tool_name,
        label: event.label || event.tool_name,
        status: "done",
        output: event.output,
      });
    });
  }

  if (event.type === "tool_error") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      upsertToolItem(timeline, event.id, {
        toolName: event.tool_name,
        label: event.label || event.tool_name,
        status: "error",
        error: event.error || "Tool execution failed",
      });
    });
  }

  if (event.type === "compact_start") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      upsertCompactItem(timeline, event.id, {
        status: "running",
        tokensBefore: event.tokens_before,
      });
    });
  }

  if (event.type === "compact_end") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      upsertCompactItem(timeline, event.id, {
        content: event.summary || "",
        status: "done",
        tokensBefore: event.tokens_before,
        tokensAfter: event.tokens_after,
      });
    });
  }

  if (event.type === "memory_suggestion") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      timeline.push({
        id: event.id || `memory_${timeline.length}`,
        kind: "memory",
        content: typeof event.memory?.content === "string" ? event.memory.content : "已保存 memory",
        status: "saved",
        memoryId: typeof event.memory?.id === "string" ? event.memory.id : undefined,
      });
    });
  }

  if (event.type === "view_intent") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      timeline.push({
        id: event.id || `view_${timeline.length}`,
        kind: "view",
        intent: {
          type: typeof event.intent?.type === "string" ? event.intent.type as "navigate" | "focus_entity" | "open_panel" | "set_filter" : "navigate",
          route: typeof event.intent?.route === "string" ? event.intent.route : undefined,
          entityType: typeof event.intent?.entityType === "string" ? event.intent.entityType as "project" | "order" | "customer" | "invoice" | "ticket" : undefined,
          entityId: typeof event.intent?.entityId === "string" ? event.intent.entityId : undefined,
          panel: typeof event.intent?.panel === "string" ? event.intent.panel : undefined,
          filters: event.intent?.filters && typeof event.intent.filters === "object" ? event.intent.filters as Record<string, string | number | boolean | null> : undefined,
          label: typeof event.intent?.label === "string" ? event.intent.label : "视图建议",
          reason: typeof event.intent?.reason === "string" ? event.intent.reason : undefined,
        },
        status: "suggested",
      });
    });
  }

  if (event.type === "proactive_task_suggestion") {
    return upsertTimeline(messages, assistantId, (timeline) => {
      timeline.push({
        id: event.id || `proactive_${timeline.length}`,
        kind: "proactive",
        content: typeof event.task?.title === "string" ? event.task.title : "已安排主动提醒",
        status: "scheduled",
        taskId: typeof event.task?.id === "string" ? event.task.id : undefined,
      });
    });
  }

  if (event.type === "message_end") {
    return messages.map((message) => (
      message.id === assistantId
        ? { ...message, content: event.content || message.content, state: "done" }
        : message
    ));
  }

  if (event.type === "error") {
    return messages.map((message) => (
      message.id === assistantId
        ? {
            ...message,
            state: "error",
            content: message.content || event.error || "Agent runtime failed",
          }
        : message
    ));
  }

  return messages;
}

export function AgentWorkbench() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [actions, setActions] = useState<AgentActionSummary[]>([]);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [compactBusy, setCompactBusy] = useState(false);
  const [loadingActions, setLoadingActions] = useState(true);
  const [loadingProposals, setLoadingProposals] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMemory, setLoadingMemory] = useState(true);
  const [loadingProactive, setLoadingProactive] = useState(true);
  const [search, setSearch] = useState("");
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [sessions, setSessions] = useState<AgentChatSessionSummary[]>([]);
  const [memoryItems, setMemoryItems] = useState<AgentMemoryItem[]>([]);
  const [proactiveItems, setProactiveItems] = useState<AgentProactiveTaskItem[]>([]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [router, status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function loadActions() {
      setLoadingActions(true);
      try {
        const res = await fetch("/api/agent/actions");
        if (!res.ok) throw new Error("Failed to load actions");
        const data = await res.json() as { actions: AgentActionSummary[] };
        if (!cancelled) {
          setActions(Array.isArray(data.actions) ? data.actions : []);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "无法加载 agent actions");
        }
      } finally {
        if (!cancelled) {
          setLoadingActions(false);
        }
      }
    }

    void loadActions();
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function refreshSessions() {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/agent/chat-sessions");
      if (!res.ok) throw new Error("Failed to load chat sessions");
      const data = await res.json() as { sessions: AgentChatSessionSummary[] };
      const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
      setSessions(nextSessions);
      setActiveSessionId((current) => {
        if (current && nextSessions.some((item) => item.id === current)) return current;
        return nextSessions[0]?.id ?? null;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法加载会话列表");
    } finally {
      setLoadingSessions(false);
    }
  }

  async function refreshMemory() {
    setLoadingMemory(true);
    try {
      const res = await fetch("/api/agent/memory?status=ACTIVE&limit=8");
      if (!res.ok) throw new Error("Failed to load memory");
      const data = await res.json() as { items: AgentMemoryItem[] };
      setMemoryItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法加载 memory");
    } finally {
      setLoadingMemory(false);
    }
  }

  async function refreshProactiveTasks() {
    setLoadingProactive(true);
    try {
      const res = await fetch("/api/agent/proactive-tasks?limit=8");
      if (!res.ok) throw new Error("Failed to load proactive tasks");
      const data = await res.json() as { items: AgentProactiveTaskItem[] };
      setProactiveItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法加载主动提醒");
    } finally {
      setLoadingProactive(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function loadInitialSessions() {
      try {
        const res = await fetch("/api/agent/chat-sessions");
        if (!res.ok) throw new Error("Failed to load chat sessions");
        const data = await res.json() as { sessions: AgentChatSessionSummary[] };
        if (cancelled) return;

        const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
        setSessions(nextSessions);
        setActiveSessionId((current) => {
          if (current && nextSessions.some((item) => item.id === current)) return current;
          return nextSessions[0]?.id ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "无法加载会话列表");
        }
      } finally {
        if (!cancelled) {
          setLoadingSessions(false);
        }
      }
    }

    void loadInitialSessions();
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function loadSidebarState() {
      try {
        const [memoryRes, proactiveRes] = await Promise.all([
          fetch("/api/agent/memory?status=ACTIVE&limit=8"),
          fetch("/api/agent/proactive-tasks?limit=8"),
        ]);
        if (!memoryRes.ok) throw new Error("Failed to load memory");
        if (!proactiveRes.ok) throw new Error("Failed to load proactive tasks");

        const [memoryData, proactiveData] = await Promise.all([
          memoryRes.json() as Promise<{ items: AgentMemoryItem[] }>,
          proactiveRes.json() as Promise<{ items: AgentProactiveTaskItem[] }>,
        ]);

        if (cancelled) return;
        setMemoryItems(Array.isArray(memoryData.items) ? memoryData.items : []);
        setProactiveItems(Array.isArray(proactiveData.items) ? proactiveData.items : []);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "无法加载 agent 辅助状态");
        }
      } finally {
        if (!cancelled) {
          setLoadingMemory(false);
          setLoadingProactive(false);
        }
      }
    }

    void loadSidebarState();
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !activeSessionId) return;
    let cancelled = false;

    async function loadSessionDetail() {
      setLoadingMessages(true);
      try {
        const res = await fetch(`/api/agent/chat-sessions/${activeSessionId}`);
        if (!res.ok) throw new Error("Failed to load chat session");
        const data = await res.json() as { session: AgentChatSessionDetail };
        if (!cancelled && data.session) {
          startTransition(() => {
            setAgentRunId(data.session.agentRunId ?? null);
            setMessages(Array.isArray(data.session.messages) ? data.session.messages.map(mapSessionMessage) : []);
          });
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "无法加载会话消息");
        }
      } finally {
        if (!cancelled) {
          setLoadingMessages(false);
        }
      }
    }

    void loadSessionDetail();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function loadProposals() {
      setLoadingProposals(true);
      try {
        const res = await fetch("/api/agent/proposals");
        if (!res.ok) throw new Error("Failed to load proposals");
        const data = await res.json() as { proposals: AgentProposal[] };
        if (!cancelled) {
          setProposals(Array.isArray(data.proposals) ? data.proposals : []);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "无法加载 proposals");
        }
      } finally {
        if (!cancelled) {
          setLoadingProposals(false);
        }
      }
    }

    void loadProposals();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const filteredActions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((action) =>
      [action.key, action.title, action.description, action.domain].some((value) => value.toLowerCase().includes(q)),
    );
  }, [actions, search]);

  const visibleProposals = useMemo(() => (
    agentRunId
      ? proposals.filter((proposal) => proposal.agentRunId === agentRunId || proposal.agentRunId == null)
      : proposals
  ), [agentRunId, proposals]);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  async function refreshProposals() {
    const res = await fetch("/api/agent/proposals");
    if (!res.ok) throw new Error("Failed to load proposals");
    const data = await res.json() as { proposals: AgentProposal[] };
    setProposals(Array.isArray(data.proposals) ? data.proposals : []);
  }

  async function confirmProposal(proposalId: string) {
    if (proposalBusyId) return;
    setProposalBusyId(proposalId);
    try {
      const res = await fetch(`/api/agent/proposals/${proposalId}/confirm`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "确认失败");

      toast.success("proposal 已执行");
      setMessages((current) => [
        ...current,
        createMessage("assistant", "已根据你的确认执行该动作。", {
          proposals: data.proposal ? [data.proposal as AgentProposal] : [],
        }),
      ]);
      await refreshProposals();
      await refreshMemory();
      await refreshProactiveTasks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "确认失败");
    } finally {
      setProposalBusyId(null);
    }
  }

  async function rejectProposal(proposalId: string) {
    if (proposalBusyId) return;
    setProposalBusyId(proposalId);
    try {
      const res = await fetch(`/api/agent/proposals/${proposalId}/reject`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "拒绝失败");

      toast.success("proposal 已拒绝");
      setMessages((current) => [
        ...current,
        createMessage("assistant", "这条 proposal 已标记为暂不执行。", {
          proposals: data.proposal ? [data.proposal as AgentProposal] : [],
        }),
      ]);
      await refreshProposals();
      await refreshMemory();
      await refreshProactiveTasks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "拒绝失败");
    } finally {
      setProposalBusyId(null);
    }
  }

  async function runPiStream(content: string, userMessage: AgentChatMessage, assistantId: string) {
    const res = await fetch("/api/agent/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: activeSessionId,
        agentRunId,
        message: content,
      }),
    });

    if (res.status === 409) {
      return false;
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(typeof data.error === "string" ? data.error : "Agent stream failed");
    }

    const nextSessionId = res.headers.get("x-agent-session-id");
    const nextRunId = res.headers.get("x-agent-run-id");
    if (nextSessionId) setActiveSessionId(nextSessionId);
    if (nextRunId) setAgentRunId(nextRunId);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as RuntimeEvent;
        setMessages((current) => appendRuntimeEvent(current, assistantId, event));
      }
    }

    const lastLine = `${buffer}${decoder.decode()}`.trim();
    if (lastLine) {
      const event = JSON.parse(lastLine) as RuntimeEvent;
      setMessages((current) => appendRuntimeEvent(current, assistantId, event));
    }

    await refreshSessions();
    await refreshMemory();
    await refreshProactiveTasks();
    if (nextSessionId) {
      const detailRes = await fetch(`/api/agent/chat-sessions/${nextSessionId}`);
      if (detailRes.ok) {
        const data = await detailRes.json() as { session: AgentChatSessionDetail };
        setMessages(Array.isArray(data.session.messages) ? data.session.messages.map(mapSessionMessage) : [userMessage]);
        setAgentRunId(data.session.agentRunId ?? nextRunId ?? null);
      }
    }
    return true;
  }

  async function runLegacyChat(content: string) {
    const res = await fetch("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentRunId,
        message: content,
        history: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Agent chat failed");
    }

    if (typeof data.agentRunId === "string" && data.agentRunId) {
      setAgentRunId((current) => current ?? data.agentRunId);
    }

    setMessages((current) => [
      ...current,
      createMessage("assistant", data.reply, {
        toolRuns: Array.isArray(data.toolRuns) ? data.toolRuns : [],
        followUps: Array.isArray(data.followUps) ? data.followUps : [],
        proposals: Array.isArray(data.proposals) ? data.proposals : [],
      }),
    ]);
  }

  async function sendMessage(nextMessage?: string) {
    const content = (nextMessage ?? draft).trim();
    if (!content || busy) return;

    const userMessage = createMessage("user", content);
    const assistantMessage = createStreamingAssistantMessage();
    setDraft("");
    setBusy(true);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      const handledByPi = await runPiStream(content, userMessage, assistantMessage.id);
      if (!handledByPi) {
        setMessages((current) => current.filter((message) => message.id !== assistantMessage.id));
        await runLegacyChat(content);
      }
    } catch (error) {
      setMessages((current) => current.map((message) => (
        message.id === assistantMessage.id
          ? {
              ...message,
              state: "error",
              content: "这次没有成功返回结果。你可以稍后重试，或者换一种问法。",
            }
          : message
      )));
      toast.error(error instanceof Error ? error.message : "Agent chat failed");
    } finally {
      setBusy(false);
    }
  }

  async function compactConversation() {
    if (!activeSessionId || compactBusy || busy) return;
    setCompactBusy(true);
    try {
      const res = await fetch("/api/agent/chat-compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId }),
      });
      const data = await res.json();
      if (res.status === 409) {
        toast.message("当前还是 legacy runtime，暂未启用服务端 compact。");
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Compact failed");
      }
      toast.success("上下文摘要已更新");
      await refreshSessions();
      const detailRes = await fetch(`/api/agent/chat-sessions/${activeSessionId}`);
      if (detailRes.ok) {
        const detail = await detailRes.json() as { session: AgentChatSessionDetail };
        setMessages(detail.session.messages.map(mapSessionMessage));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上下文压缩失败");
    } finally {
      setCompactBusy(false);
    }
  }

  async function applyViewIntent(intent: AgentViewIntent) {
    try {
      const res = await fetch("/api/agent/view-intents/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "视图切换失败");
      }

      if (data.applied?.mode === "navigate" && typeof data.applied.route === "string") {
        const url = new URL(data.applied.route, window.location.origin);
        if (data.applied.searchParams && typeof data.applied.searchParams === "object") {
          for (const [key, value] of Object.entries(data.applied.searchParams as Record<string, unknown>)) {
            if (value !== null && value !== undefined) {
              url.searchParams.set(key, String(value));
            }
          }
        }
        router.push(`${url.pathname}${url.search}`);
        return;
      }

      toast.message(typeof data.applied?.label === "string" ? data.applied.label : "视图建议已应用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视图切换失败");
    }
  }

  function startNewConversation() {
    if (busy || proposalBusyId) return;
    setActiveSessionId(null);
    setAgentRunId(null);
    setMessages([]);
    setDraft("");
  }

  if (status === "loading") {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[19rem_minmax(0,1fr)_22rem]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/85 shadow-sm" style={{ flex: 2 }}>
            <div className="shrink-0 border-b border-border/60 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">可用能力</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  onClick={startNewConversation}
                  disabled={busy || proposalBusyId != null}
                >
                  <Plus className="h-3.5 w-3.5" />
                  新会话
                </Button>
              </div>
              <div className="mt-2">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索能力"
                  className="border-input"
                />
              </div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                这里不是命令列表，而是 agent 当前可调度的系统能力和业务工具。
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2 px-3 py-3">
                {loadingActions ? (
                  <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中
                  </div>
                ) : null}

                {!loadingActions && filteredActions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
                    没有匹配的能力。
                  </div>
                ) : null}

                {filteredActions.map((action) => {
                  const Icon = DOMAIN_ICON[action.domain] ?? Sparkles;
                  const example = ACTION_EXAMPLES[action.key] ?? `比如：请帮我处理和${action.title}相关的问题`;
                  const hint = DOMAIN_HINT[action.domain] ?? "适合用自然语言直接提问";
                  return (
                    <button
                      key={action.key}
                      type="button"
                      onClick={() => setDraft(example.replace("比如：", "").trim())}
                      className="w-full rounded-xl border border-border/70 bg-background px-3 py-3 text-left transition-colors hover:bg-muted/30"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 rounded-lg bg-muted p-1.5">
                          <Icon className="h-4 w-4 text-foreground" />
                        </div>
                        <div>
                          <div className="text-sm font-medium">{action.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{action.description}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
                          <div className="mt-2 rounded-lg bg-muted/30 px-2 py-1.5 text-[11px] text-foreground">
                            {example}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="flex min-h-[160px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/85 shadow-sm" style={{ flex: 1 }}>
            <div className="shrink-0 border-b border-border/60 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                最近会话
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2 px-3 py-3">
                {loadingSessions ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载会话中
                  </div>
                ) : null}

                {!loadingSessions && sessions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-xs leading-5 text-muted-foreground">
                    还没有历史会话。发送第一条消息后，这里会开始积累服务端会话记录。
                  </div>
                ) : null}

                {sessions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSessionId(item.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      item.id === activeSessionId
                        ? "border-foreground/15 bg-foreground/[0.045]"
                        : "border-border/70 bg-background hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{item.title?.trim() || "未命名会话"}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          最近活动 {formatSessionTime(item.lastMessageAt)}
                        </div>
                      </div>
                      <Badge variant={item.id === activeSessionId ? "secondary" : "outline"} className="rounded-md">
                        {item.messageCount}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <AgentChatPanel
          messages={messages}
          draft={draft}
          busy={busy || loadingMessages}
          compactBusy={compactBusy}
          chatLabel={activeSession?.title?.trim() || "Agent 对话"}
          agentRunId={agentRunId}
          sessionId={activeSessionId}
          proposalBusyId={proposalBusyId}
          userName={session.user.name}
          onDraftChange={setDraft}
          onSend={() => void sendMessage()}
          onUseFollowUp={(value) => void sendMessage(value)}
          onConfirmProposal={(proposalId) => void confirmProposal(proposalId)}
          onRejectProposal={(proposalId) => void rejectProposal(proposalId)}
          onCompact={activeSessionId ? () => void compactConversation() : undefined}
          onApplyViewIntent={(intent) => void applyViewIntent(intent)}
        />

        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex-1 min-h-0 overflow-hidden">
            <ProposalPanel
              proposals={visibleProposals}
              busyProposalId={proposalBusyId}
              onConfirm={(proposalId) => void confirmProposal(proposalId)}
              onReject={(proposalId) => void rejectProposal(proposalId)}
            />
          </div>

          <div className="shrink-0 rounded-2xl border border-border/60 bg-card/85 px-4 py-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BrainCircuit className="h-4 w-4 text-muted-foreground" />
              Memory
            </div>
            <div className="mt-3 space-y-2">
              {loadingMemory ? (
                <div className="text-xs text-muted-foreground">加载中…</div>
              ) : memoryItems.length === 0 ? (
                <div className="text-xs leading-5 text-muted-foreground">还没有激活的用户偏好或工作记忆。</div>
              ) : (
                memoryItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border/70 bg-background/85 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.kind}</div>
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {Math.round(item.confidence * 100)}%
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm leading-6">{item.content}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="shrink-0 rounded-2xl border border-border/60 bg-card/85 px-4 py-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BellDot className="h-4 w-4 text-muted-foreground" />
              主动提醒
            </div>
            <div className="mt-3 space-y-2">
              {loadingProactive ? (
                <div className="text-xs text-muted-foreground">加载中…</div>
              ) : proactiveItems.length === 0 ? (
                <div className="text-xs leading-5 text-muted-foreground">当前没有待执行或历史主动提醒。</div>
              ) : (
                proactiveItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border/70 bg-background/85 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{item.title}</div>
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {item.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(item.triggerAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="shrink-0 rounded-2xl border border-border/60 bg-card/85 px-4 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">上下文与快捷提问</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                disabled={!activeSessionId || compactBusy || busy}
                onClick={() => void compactConversation()}
              >
                <ScissorsLineDashed className="h-3.5 w-3.5" />
                Compact
              </Button>
            </div>
            {loadingProposals ? <div className="mt-2 text-xs text-muted-foreground">正在刷新 proposal 列表…</div> : null}
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              {activeSession?.compactSummary?.trim()
                ? "当前会话已存在 compact 摘要，后续会优先注入 runtime。"
                : "当前会话还没有 compact 摘要，需要时可以手动压缩。"}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                "待回款订单",
                "最近 CRM 客户",
                "项目状态变化",
                "帮我给一个 CRM 客户新建跟进任务",
              ].map((prompt) => (
                <Button
                  key={prompt}
                  variant="outline"
                  size="sm"
                  className="h-auto whitespace-normal rounded-lg px-3 py-2 text-left"
                  onClick={() => setDraft(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
