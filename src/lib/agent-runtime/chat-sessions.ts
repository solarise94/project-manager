import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/agent-actions/types";
import { AgentActionForbiddenError, AgentActionInputError } from "@/lib/agent-actions/errors";
import { parseJsonValue, serializeJsonValue } from "./serde";
import type {
  AgentChatMessageRecord,
  AgentChatSessionDetailRecord,
  AgentChatSessionSummaryRecord,
  AgentTimelineItem,
} from "./types";

function mapAgentChatMessage(message: {
  id: string;
  sessionId: string;
  agentRunId: string | null;
  userId: string;
  role: string;
  content: string;
  state: string;
  timelineJson: string | null;
  tokenUsageJson: string | null;
  metadataJson: string | null;
  createdAt: Date;
}): AgentChatMessageRecord {
  return {
    id: message.id,
    sessionId: message.sessionId,
    agentRunId: message.agentRunId,
    userId: message.userId,
    role: message.role,
    content: message.content,
    state: message.state,
    timeline: parseJsonValue<AgentTimelineItem[]>(message.timelineJson, []),
    tokenUsage: parseJsonValue<Record<string, unknown> | null>(message.tokenUsageJson, null),
    metadata: parseJsonValue<Record<string, unknown> | null>(message.metadataJson, null),
    createdAt: message.createdAt.toISOString(),
  };
}

function mapAgentChatSessionSummary(session: {
  id: string;
  userId: string;
  agentRunId: string | null;
  title: string | null;
  status: string;
  source: string;
  summary: string | null;
  compactSummary: string | null;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  _count?: { messages?: number };
}): AgentChatSessionSummaryRecord {
  return {
    id: session.id,
    userId: session.userId,
    agentRunId: session.agentRunId,
    title: session.title,
    status: session.status,
    source: session.source,
    summary: session.summary,
    compactSummary: session.compactSummary,
    metadata: parseJsonValue<Record<string, unknown> | null>(session.metadataJson, null),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    lastMessageAt: session.lastMessageAt.toISOString(),
    messageCount: session._count?.messages ?? 0,
  };
}

export async function assertAgentRunOwnership(actor: ActorContext, agentRunId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    select: { id: true, userId: true },
  });
  if (!run || run.userId !== actor.userId) {
    throw new AgentActionForbiddenError("Agent run not found");
  }
  return run;
}

export async function listAgentChatSessions(
  actor: ActorContext,
  opts: { status?: string; limit?: number } = {},
) {
  const sessions = await prisma.agentChatSession.findMany({
    where: {
      userId: actor.userId,
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: Math.max(1, Math.min(opts.limit ?? 30, 100)),
    select: {
      id: true,
      userId: true,
      agentRunId: true,
      title: true,
      status: true,
      source: true,
      summary: true,
      compactSummary: true,
      metadataJson: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
  });

  return sessions.map(mapAgentChatSessionSummary);
}

export async function createAgentChatSession(
  actor: ActorContext,
  input: {
    agentRunId?: string | null;
    title?: string | null;
    status?: string;
    source?: string;
    summary?: string | null;
    compactSummary?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  if (input.agentRunId) {
    await assertAgentRunOwnership(actor, input.agentRunId);
  }

  const created = await prisma.agentChatSession.create({
    data: {
      userId: actor.userId,
      agentRunId: input.agentRunId ?? null,
      title: input.title?.trim() || null,
      status: input.status?.trim() || "ACTIVE",
      source: input.source?.trim() || "CHAT",
      summary: input.summary?.trim() || null,
      compactSummary: input.compactSummary?.trim() || null,
      metadataJson: serializeJsonValue(input.metadata),
      lastMessageAt: new Date(),
    },
    select: {
      id: true,
      userId: true,
      agentRunId: true,
      title: true,
      status: true,
      source: true,
      summary: true,
      compactSummary: true,
      metadataJson: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
  });

  return mapAgentChatSessionSummary(created);
}

export async function getAgentChatSessionDetail(actor: ActorContext, sessionId: string) {
  const session = await prisma.agentChatSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      agentRunId: true,
      title: true,
      status: true,
      source: true,
      summary: true,
      compactSummary: true,
      metadataJson: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sessionId: true,
          agentRunId: true,
          userId: true,
          role: true,
          content: true,
          state: true,
          timelineJson: true,
          tokenUsageJson: true,
          metadataJson: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session || session.userId !== actor.userId) {
    throw new AgentActionForbiddenError("Chat session not found");
  }

  const summary = mapAgentChatSessionSummary(session);
  const detail: AgentChatSessionDetailRecord = {
    ...summary,
    messages: session.messages.map(mapAgentChatMessage),
  };
  return detail;
}

export async function updateAgentChatSession(
  actor: ActorContext,
  sessionId: string,
  input: {
    title?: string | null;
    status?: string;
    source?: string;
    summary?: string | null;
    compactSummary?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const existing = await prisma.agentChatSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true },
  });

  if (!existing || existing.userId !== actor.userId) {
    throw new AgentActionForbiddenError("Chat session not found");
  }

  const updated = await prisma.agentChatSession.update({
    where: { id: sessionId },
    data: {
      ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
      ...(input.status !== undefined ? { status: input.status.trim() || "ACTIVE" } : {}),
      ...(input.source !== undefined ? { source: input.source.trim() || "CHAT" } : {}),
      ...(input.summary !== undefined ? { summary: input.summary?.trim() || null } : {}),
      ...(input.compactSummary !== undefined ? { compactSummary: input.compactSummary?.trim() || null } : {}),
      ...(input.metadata !== undefined ? { metadataJson: serializeJsonValue(input.metadata) } : {}),
    },
    select: {
      id: true,
      userId: true,
      agentRunId: true,
      title: true,
      status: true,
      source: true,
      summary: true,
      compactSummary: true,
      metadataJson: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
  });

  return mapAgentChatSessionSummary(updated);
}

export async function createAgentChatMessage(
  actor: ActorContext,
  input: {
    sessionId: string;
    agentRunId?: string | null;
    role: string;
    content: string;
    state?: string;
    timeline?: AgentTimelineItem[];
    tokenUsage?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const session = await prisma.agentChatSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, userId: true },
  });
  if (!session || session.userId !== actor.userId) {
    throw new AgentActionForbiddenError("Chat session not found");
  }

  if (!input.content.trim()) {
    throw new AgentActionInputError("content is required");
  }

  const created = await prisma.$transaction(async (tx) => {
    const message = await tx.agentChatMessage.create({
      data: {
        sessionId: input.sessionId,
        agentRunId: input.agentRunId ?? null,
        userId: actor.userId,
        role: input.role.trim(),
        content: input.content,
        state: input.state?.trim() || "done",
        timelineJson: serializeJsonValue(input.timeline ?? []),
        tokenUsageJson: serializeJsonValue(input.tokenUsage),
        metadataJson: serializeJsonValue(input.metadata),
      },
      select: {
        id: true,
        sessionId: true,
        agentRunId: true,
        userId: true,
        role: true,
        content: true,
        state: true,
        timelineJson: true,
        tokenUsageJson: true,
        metadataJson: true,
        createdAt: true,
      },
    });

    await tx.agentChatSession.update({
      where: { id: input.sessionId },
      data: { lastMessageAt: message.createdAt },
    });

    return message;
  });

  return mapAgentChatMessage(created);
}
