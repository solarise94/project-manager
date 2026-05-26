import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActorContextFromSession } from "@/lib/agent-actions/actor";
import { AgentActionError, AgentActionInputError } from "@/lib/agent-actions/errors";
import { getAgentProposalForActor, mapAgentProposalRecord } from "@/lib/agent-actions/proposals";
import { getAgentAction, executeAgentAction } from "@/lib/agent-actions/registry";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!id) {
      throw new AgentActionInputError("proposal id is required");
    }

    const actor = getActorContextFromSession(session);
    const proposal = await getAgentProposalForActor(actor, id);
    if (proposal.status !== "PENDING") {
      throw new AgentActionInputError("Only pending proposals can be confirmed");
    }

    const action = getAgentAction(proposal.actionKey);
    if (!action) {
      throw new AgentActionInputError(`Unknown action: ${proposal.actionKey}`);
    }

    const input = JSON.parse(proposal.inputJson) as unknown;
    try {
      const executed = await executeAgentAction(actor, proposal.actionKey, input, {
        allowConfirm: true,
        proposalId: proposal.id,
      });
      const target = action.resolveTarget
        ? await action.resolveTarget(action.parseInput(input), executed.result)
        : null;
      const updated = await prisma.agentProposal.update({
        where: { id: proposal.id },
        data: {
          status: "CONFIRMED",
          resultJson: JSON.stringify(executed.result),
          error: null,
          targetType: target?.type ?? proposal.targetType,
          targetId: target?.id ?? proposal.targetId,
          decidedAt: new Date(),
        },
      });

      return NextResponse.json({
        ok: true,
        proposal: mapAgentProposalRecord(updated),
        result: executed.result,
      });
    } catch (error) {
      await prisma.agentProposal.update({
        where: { id: proposal.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "Proposal execution failed",
          decidedAt: new Date(),
        },
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof AgentActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("agent proposal confirm failed:", error);
    return NextResponse.json({ error: "Failed to confirm proposal" }, { status: 500 });
  }
}
