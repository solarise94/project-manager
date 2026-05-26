import { randomUUID } from "crypto";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { AgentActionForbiddenError, AgentActionInputError } from "./errors";
import type { ActorContext, AgentRunRecord } from "./types";

declare global {
  var __agentInternalToolToken: string | undefined;
}

function mapAgentRunRecord(run: {
  id: string;
  userId: string;
  role: string;
  name: string | null;
  email: string | null;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date;
}): AgentRunRecord {
  return {
    id: run.id,
    userId: run.userId,
    role: run.role,
    name: run.name,
    email: run.email,
    status: run.status,
    source: run.source,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    lastUsedAt: run.lastUsedAt.toISOString(),
  };
}

function sessionToActor(session: Session) {
  if (!session.user?.id || !session.user.role) {
    throw new AgentActionForbiddenError("Unauthorized");
  }

  return {
    userId: session.user.id,
    role: session.user.role,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
  };
}

export async function createAgentRunFromSession(session: Session, source = "CHAT") {
  const actor = sessionToActor(session);
  const run = await prisma.agentRun.create({
    data: {
      userId: actor.userId,
      role: actor.role,
      name: actor.name,
      email: actor.email,
      source,
      status: "ACTIVE",
      lastUsedAt: new Date(),
    },
  });

  return mapAgentRunRecord(run);
}

export async function getOrCreateAgentRunFromSession(session: Session, agentRunId?: string | null, source = "CHAT") {
  if (agentRunId) {
    await ensureAgentRunBelongsToSession(agentRunId, session);
    const touchedAt = new Date();
    const run = await prisma.agentRun.findUnique({ where: { id: agentRunId } });
    if (run) {
      const updated = await prisma.agentRun.update({
        where: { id: agentRunId },
        data: { lastUsedAt: touchedAt },
      });
      return mapAgentRunRecord(updated);
    }
  }
  return createAgentRunFromSession(session, source);
}

export async function getActorContextFromAgentRun(agentRunId: string): Promise<ActorContext> {
  const run = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
  });
  if (!run) {
    throw new AgentActionInputError("Agent run not found");
  }
  if (run.status !== "ACTIVE") {
    throw new AgentActionForbiddenError("Agent run is not active");
  }

  const touchedAt = new Date();
  await prisma.agentRun.update({
    where: { id: agentRunId },
    data: { lastUsedAt: touchedAt },
  });

  return {
    userId: run.userId,
    role: run.role,
    name: run.name,
    email: run.email,
    agentRunId: run.id,
  };
}

export async function listAgentRunsForUser(userId: string) {
  const runs = await prisma.agentRun.findMany({
    where: { userId },
    orderBy: { lastUsedAt: "desc" },
    take: 20,
  });

  return runs.map(mapAgentRunRecord);
}

export async function ensureAgentRunBelongsToSession(agentRunId: string, session: Session) {
  const actor = sessionToActor(session);
  const run = await prisma.agentRun.findUnique({
    where: { id: agentRunId },
    select: { id: true, userId: true, status: true },
  });
  if (!run || run.userId !== actor.userId) {
    throw new AgentActionForbiddenError("Agent run not found");
  }
  if (run.status !== "ACTIVE") {
    throw new AgentActionForbiddenError("Agent run is not active");
  }
  return run;
}

export function getInternalToolToken() {
  const configured = process.env.AGENT_INTERNAL_TOOL_TOKEN?.trim();
  if (configured) return configured;
  if (!globalThis.__agentInternalToolToken) {
    globalThis.__agentInternalToolToken = randomUUID();
  }
  return globalThis.__agentInternalToolToken;
}

export function isValidInternalToolToken(token: string | null | undefined) {
  if (!token) return false;
  return token === getInternalToolToken();
}
