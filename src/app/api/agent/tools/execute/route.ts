import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActorContextFromSession } from "@/lib/agent-actions/actor";
import { AgentActionError, AgentActionInputError } from "@/lib/agent-actions/errors";
import { createAgentProposal } from "@/lib/agent-actions/proposals";
import { executeAgentAction, getAgentAction } from "@/lib/agent-actions/registry";
import {
  ensureAgentRunBelongsToSession,
  getActorContextFromAgentRun,
  isValidInternalToolToken,
} from "@/lib/agent-actions/run-context";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      throw new AgentActionInputError("Request body must be an object");
    }

    const actionKey = typeof body.actionKey === "string" ? body.actionKey.trim() : "";
    if (!actionKey) {
      throw new AgentActionInputError("actionKey is required");
    }

    const agentRunId = typeof body.agentRunId === "string" ? body.agentRunId.trim() : "";
    const internalToken = req.headers.get("x-agent-internal-token");

    let actor;
    if (internalToken && isValidInternalToolToken(internalToken)) {
      if (!agentRunId) {
        throw new AgentActionInputError("agentRunId is required for internal tool execution");
      }
      actor = await getActorContextFromAgentRun(agentRunId);
    } else {
      const session = await getServerSession(authOptions);
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (agentRunId) {
        await ensureAgentRunBelongsToSession(agentRunId, session);
        actor = await getActorContextFromAgentRun(agentRunId);
      } else {
        actor = getActorContextFromSession(session);
      }
    }

    const action = getAgentAction(actionKey);
    if (!action) {
      throw new AgentActionInputError(`Unknown action: ${actionKey}`);
    }

    if (action.riskLevel === "confirm") {
      const proposal = await createAgentProposal(actor, actionKey, body.input);
      return NextResponse.json({
        ok: true,
        actionKey,
        mode: "proposal",
        proposal,
      }, { status: 202 });
    }

    const executed = await executeAgentAction(actor, actionKey, body.input);

    return NextResponse.json({
      ok: true,
      actionKey,
      mode: "result",
      result: executed.result,
    });
  } catch (error) {
    if (error instanceof AgentActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    console.error("agent tool execute failed:", error);
    return NextResponse.json({ error: "Failed to execute agent action" }, { status: 500 });
  }
}
