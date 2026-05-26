import { prisma } from "@/lib/prisma";
import { AgentActionForbiddenError, AgentActionInputError, AgentActionNotFoundError } from "./errors";
import { createAgentActionLog } from "./logs";
import { getAgentAction } from "./registry";
import type { ActorContext, AgentActionProposalRecord } from "./types";

function parseStoredObject(value: string, label: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(label);
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AgentActionInputError(`${label} is invalid`);
  }
}

function parseStoredJson(value: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function mapAgentProposalRecord(proposal: {
  id: string;
  userId: string;
  agentRunId: string | null;
  actionKey: string;
  title: string;
  summary: string;
  riskLevel: string;
  status: string;
  inputJson: string;
  resultJson: string | null;
  error: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
}): AgentActionProposalRecord {
  return {
    id: proposal.id,
    userId: proposal.userId,
    agentRunId: proposal.agentRunId,
    actionKey: proposal.actionKey,
    title: proposal.title,
    summary: proposal.summary,
    riskLevel: proposal.riskLevel as AgentActionProposalRecord["riskLevel"],
    status: proposal.status,
    input: parseStoredObject(proposal.inputJson, "proposal input"),
    result: parseStoredJson(proposal.resultJson),
    error: proposal.error,
    targetType: proposal.targetType,
    targetId: proposal.targetId,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    decidedAt: proposal.decidedAt?.toISOString() ?? null,
  };
}

export async function listAgentProposals(actor: ActorContext, status?: string) {
  const proposals = await prisma.agentProposal.findMany({
    where: {
      userId: actor.userId,
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return proposals.map(mapAgentProposalRecord);
}

export async function createAgentProposal(actor: ActorContext, actionKey: string, rawInput: unknown) {
  const action = getAgentAction(actionKey);
  if (!action) {
    throw new AgentActionNotFoundError(actionKey);
  }
  if (action.riskLevel !== "confirm") {
    throw new AgentActionInputError(`${actionKey} is not a confirm action`);
  }

  const available = await action.availability(actor);
  if (!available) {
    throw new AgentActionForbiddenError();
  }
  if (!action.buildProposal) {
    throw new AgentActionInputError(`${actionKey} does not support proposals`);
  }

  const input = action.parseInput(rawInput);
  const proposal = await action.buildProposal(actor, input);
  const created = await prisma.agentProposal.create({
    data: {
      userId: actor.userId,
      agentRunId: actor.agentRunId ?? null,
      actionKey: action.key,
      title: proposal.title,
      summary: proposal.summary,
      riskLevel: action.riskLevel,
      inputJson: JSON.stringify(proposal.proposalInput ?? input),
      status: "PENDING",
      targetType: proposal.target?.type ?? null,
      targetId: proposal.target?.id ?? null,
    },
  });

  await createAgentActionLog(actor, action, {
    status: "PROPOSED",
    input,
    proposalId: created.id,
    target: proposal.target,
  });

  return mapAgentProposalRecord(created);
}

export async function getAgentProposalForActor(actor: ActorContext, proposalId: string) {
  const proposal = await prisma.agentProposal.findUnique({
    where: { id: proposalId },
  });

  if (!proposal || proposal.userId !== actor.userId) {
    throw new AgentActionForbiddenError("Proposal not found");
  }

  return proposal;
}
