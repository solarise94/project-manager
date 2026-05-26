import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActorContextFromSession } from "@/lib/agent-actions/actor";
import { AgentActionError, AgentActionInputError } from "@/lib/agent-actions/errors";
import { createAgentProposal, listAgentProposals } from "@/lib/agent-actions/proposals";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const actor = getActorContextFromSession(session);
    const status = req.nextUrl.searchParams.get("status")?.trim() || undefined;
    const proposals = await listAgentProposals(actor, status);
    return NextResponse.json({ proposals });
  } catch (error) {
    if (error instanceof AgentActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("agent proposals list failed:", error);
    return NextResponse.json({ error: "Failed to load proposals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      throw new AgentActionInputError("Request body must be an object");
    }

    const actionKey = typeof body.actionKey === "string" ? body.actionKey.trim() : "";
    if (!actionKey) {
      throw new AgentActionInputError("actionKey is required");
    }

    const actor = getActorContextFromSession(session);
    const proposal = await createAgentProposal(actor, actionKey, body.input);
    return NextResponse.json({ ok: true, proposal }, { status: 201 });
  } catch (error) {
    if (error instanceof AgentActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("agent proposal create failed:", error);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }
}
