import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/agent-actions/types";
import { AgentActionForbiddenError } from "@/lib/agent-actions/errors";
import { parseJsonValue, serializeJsonValue } from "./serde";
import type { AgentMemoryRecord } from "./types";

function mapAgentMemory(memory: {
  id: string;
  userId: string;
  scope: string;
  kind: string;
  content: string;
  confidence: number;
  source: string;
  sourceMessageId: string | null;
  status: string;
  metadataJson: string | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AgentMemoryRecord {
  return {
    id: memory.id,
    userId: memory.userId,
    scope: memory.scope,
    kind: memory.kind,
    content: memory.content,
    confidence: memory.confidence,
    source: memory.source,
    sourceMessageId: memory.sourceMessageId,
    status: memory.status,
    metadata: parseJsonValue<Record<string, unknown> | null>(memory.metadataJson, null),
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    lastUsedAt: memory.lastUsedAt?.toISOString() ?? null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export async function listAgentMemory(
  actor: ActorContext,
  opts: { kind?: string; status?: string; limit?: number } = {},
) {
  const items = await prisma.agentMemory.findMany({
    where: {
      userId: actor.userId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
    take: Math.max(1, Math.min(opts.limit ?? 50, 200)),
  });

  return items.map(mapAgentMemory);
}

export async function createAgentMemory(
  actor: ActorContext,
  input: {
    scope?: string;
    kind: string;
    content: string;
    confidence?: number;
    source?: string;
    sourceMessageId?: string | null;
    status?: string;
    metadata?: Record<string, unknown> | null;
    expiresAt?: string | null;
    lastUsedAt?: string | null;
  },
) {
  const created = await prisma.agentMemory.create({
    data: {
      userId: actor.userId,
      scope: input.scope?.trim() || "USER",
      kind: input.kind.trim(),
      content: input.content.trim(),
      confidence: input.confidence ?? 0.8,
      source: input.source?.trim() || "USER_EXPLICIT",
      sourceMessageId: input.sourceMessageId?.trim() || null,
      status: input.status?.trim() || "ACTIVE",
      metadataJson: serializeJsonValue(input.metadata),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      lastUsedAt: input.lastUsedAt ? new Date(input.lastUsedAt) : null,
    },
  });

  return mapAgentMemory(created);
}

export async function updateAgentMemory(
  actor: ActorContext,
  memoryId: string,
  input: {
    scope?: string;
    kind?: string;
    content?: string;
    confidence?: number;
    source?: string;
    sourceMessageId?: string | null;
    status?: string;
    metadata?: Record<string, unknown> | null;
    expiresAt?: string | null;
    lastUsedAt?: string | null;
  },
) {
  const existing = await prisma.agentMemory.findUnique({
    where: { id: memoryId },
    select: { id: true, userId: true },
  });

  if (!existing || existing.userId !== actor.userId) {
    throw new AgentActionForbiddenError("Memory not found");
  }

  const updated = await prisma.agentMemory.update({
    where: { id: memoryId },
    data: {
      ...(input.scope !== undefined ? { scope: input.scope.trim() || "USER" } : {}),
      ...(input.kind !== undefined ? { kind: input.kind.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content.trim() } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.source !== undefined ? { source: input.source.trim() || "USER_EXPLICIT" } : {}),
      ...(input.sourceMessageId !== undefined ? { sourceMessageId: input.sourceMessageId?.trim() || null } : {}),
      ...(input.status !== undefined ? { status: input.status.trim() || "ACTIVE" } : {}),
      ...(input.metadata !== undefined ? { metadataJson: serializeJsonValue(input.metadata) } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
      ...(input.lastUsedAt !== undefined ? { lastUsedAt: input.lastUsedAt ? new Date(input.lastUsedAt) : null } : {}),
    },
  });

  return mapAgentMemory(updated);
}
