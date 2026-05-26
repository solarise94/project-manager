import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActorContextFromSession } from "@/lib/agent-actions/actor";
import { AgentActionError, AgentActionInputError } from "@/lib/agent-actions/errors";
import { createAgentActionLog } from "@/lib/agent-actions/logs";
import { getAgentProposalForActor, mapAgentProposalRecord } from "@/lib/agent-actions/proposals";
import { getAgentAction } from "@/lib/agent-actions/registry";

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
      throw new AgentActionInputError("Only pending proposals can be rejected");
    }

    const action = getAgentAction(proposal.actionKey);
    if (!action) {
      throw new AgentActionInputError(`Unknown action: ${proposal.actionKey}`);
    }

    const updated = await prisma.agentProposal.update({
      where: { id: proposal.id },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
      },
    });

    await createAgentActionLog(actor, action, {
      status: "REJECTED",
      input: JSON.parse(proposal.inputJson),
      proposalId: proposal.id,
      target: {
        type: proposal.targetType,
        id: proposal.targetId,
      },
    });

    return NextResponse.json({
      ok: true,
      proposal: mapAgentProposalRecord(updated),
    });
  } catch (error) {
    if (error instanceof AgentActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("agent proposal reject failed:", error);
    return NextResponse.json({ error: "Failed to reject proposal" }, { status: 500 });
  }
}
