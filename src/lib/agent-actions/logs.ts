import { prisma } from "@/lib/prisma";
import type { ActorContext, AgentActionDefinition, AgentActionTarget } from "./types";

function stringify(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function normalizeTarget(target?: AgentActionTarget | null) {
  return {
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
  };
}

export async function createAgentActionLog(
  actor: ActorContext,
  action: AgentActionDefinition<unknown, unknown>,
  opts: {
    status: string;
    input: unknown;
    output?: unknown;
    error?: string | null;
    proposalId?: string | null;
    target?: AgentActionTarget | null;
  },
) {
  const target = normalizeTarget(opts.target);
  return prisma.agentActionLog.create({
    data: {
      userId: actor.userId,
      agentRunId: actor.agentRunId ?? null,
      actionKey: action.key,
      riskLevel: action.riskLevel,
      status: opts.status,
      inputJson: stringify(opts.input) ?? "{}",
      outputJson: stringify(opts.output),
      error: opts.error ?? null,
      proposalId: opts.proposalId ?? null,
      targetType: target.targetType,
      targetId: target.targetId,
    },
  });
}
