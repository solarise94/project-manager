export interface AgentViewIntent {
  type: "navigate" | "focus_entity" | "open_panel" | "set_filter";
  route?: string;
  entityType?: "project" | "order" | "customer" | "invoice" | "ticket";
  entityId?: string;
  panel?: string;
  filters?: Record<string, string | number | boolean | null>;
  label: string;
  reason?: string;
}

export type AgentTimelineItem =
  | {
      id: string;
      kind: "text";
      content: string;
      status?: string;
      startedAt?: number;
      endedAt?: number;
    }
  | {
      id: string;
      kind: "thinking";
      content?: string;
      status: "running" | "done" | "error";
      startedAt?: number;
      endedAt?: number;
    }
  | {
      id: string;
      kind: "tool";
      toolName: string;
      label: string;
      content?: string;
      status: "running" | "done" | "error";
      input?: unknown;
      output?: unknown;
      error?: string;
    }
  | {
      id: string;
      kind: "compact";
      content: string;
      status: "running" | "done" | "error";
      tokensBefore?: number;
      tokensAfter?: number;
    }
  | {
      id: string;
      kind: "memory";
      content: string;
      status: "suggested" | "saved" | "rejected";
      memoryId?: string;
    }
  | {
      id: string;
      kind: "view";
      intent: AgentViewIntent;
      status: "suggested" | "applied" | "rejected";
    }
  | {
      id: string;
      kind: "proactive";
      content: string;
      status: "suggested" | "scheduled" | "sent" | "rejected";
      taskId?: string;
    };

export interface AgentChatMessageRecord {
  id: string;
  sessionId: string;
  agentRunId?: string | null;
  userId: string;
  role: string;
  content: string;
  state: string;
  timeline: AgentTimelineItem[];
  tokenUsage?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AgentChatSessionSummaryRecord {
  id: string;
  userId: string;
  agentRunId?: string | null;
  title?: string | null;
  status: string;
  source: string;
  summary?: string | null;
  compactSummary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface AgentChatSessionDetailRecord extends AgentChatSessionSummaryRecord {
  messages: AgentChatMessageRecord[];
}

export interface AgentMemoryRecord {
  id: string;
  userId: string;
  scope: string;
  kind: string;
  content: string;
  confidence: number;
  source: string;
  sourceMessageId?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProactiveTaskRecord {
  id: string;
  userId: string;
  agentRunId?: string | null;
  sessionId?: string | null;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
  status: string;
  triggerAt: string;
  notificationId?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string | null;
}

export interface AgentRuntimeToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
