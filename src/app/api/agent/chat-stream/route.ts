import { randomUUID } from "crypto";
import { TextDecoder } from "util";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActorContextFromSession } from "@/lib/agent-actions/actor";
import { AgentActionError, AgentActionInputError } from "@/lib/agent-actions/errors";
import { listAvailableAgentActions } from "@/lib/agent-actions/registry";
import { getInternalToolToken, getOrCreateAgentRunFromSession } from "@/lib/agent-actions/run-context";
import { actionToTool } from "@/lib/agent-actions/tool-adapter";
import { getAppBaseUrl } from "@/lib/app-url";
import {
  createAgentChatMessage,
  createAgentChatSession,
  getAgentChatSessionDetail,
} from "@/lib/agent-runtime/chat-sessions";
import { getAgentRuntimeBaseUrl, getAgentRuntimeFlags, getAgentRuntimeToken, isPiAgentRuntimeEnabled } from "@/lib/agent-runtime/config";
import { listAgentMemory } from "@/lib/agent-runtime/memory";
import type { AgentTimelineItem, AgentViewIntent } from "@/lib/agent-runtime/types";

function normalizeTimeline(timeline: AgentTimelineItem[]) {
  return timeline.map((item) => {
    if (item.kind === "thinking") {
      return { ...item, status: item.status === "running" ? "done" : item.status };
    }
    if (item.kind === "tool" || item.kind === "compact") {
      return { ...item, status: item.status === "running" ? "done" : item.status };
    }
    return item;
  });
}

function upsertTextTimelineItem(timeline: AgentTimelineItem[], delta: string) {
  const existing = timeline.find((item) => item.kind === "text" && item.id === "assistant_text");
  if (existing && existing.kind === "text") {
    existing.content += delta;
    return;
  }
  timeline.push({ id: "assistant_text", kind: "text", content: delta, status: "done" });
}

function upsertThinkingTimelineItem(timeline: AgentTimelineItem[], id: string, delta: string) {
  const existing = timeline.find((item) => item.kind === "thinking" && item.id === id);
  if (existing && existing.kind === "thinking") {
    existing.content = `${existing.content || ""}${delta}`;
    existing.status = "running";
    return;
  }
  timeline.push({ id, kind: "thinking", content: delta, status: "running" });
}

function upsertToolTimelineItem(
  timeline: AgentTimelineItem[],
  id: string,
  patch: Partial<Extract<AgentTimelineItem, { kind: "tool" }>> & { toolName: string; label: string },
) {
  const existing = timeline.find((item) => item.kind === "tool" && item.id === id);
  if (existing && existing.kind === "tool") {
    Object.assign(existing, patch);
    return;
  }
  timeline.push({
    id,
    kind: "tool",
    toolName: patch.toolName,
    label: patch.label,
    status: patch.status || "running",
    content: patch.content,
    input: patch.input,
    output: patch.output,
    error: patch.error,
  });
}

function upsertCompactTimelineItem(
  timeline: AgentTimelineItem[],
  id: string,
  patch: Partial<Extract<AgentTimelineItem, { kind: "compact" }>> & { content?: string },
) {
  const existing = timeline.find((item) => item.kind === "compact" && item.id === id);
  if (existing && existing.kind === "compact") {
    Object.assign(existing, patch);
    return;
  }
  timeline.push({
    id,
    kind: "compact",
    content: patch.content || "",
    status: patch.status || "running",
    tokensBefore: patch.tokensBefore,
    tokensAfter: patch.tokensAfter,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPiAgentRuntimeEnabled()) {
    return NextResponse.json({ error: "AGENT_RUNTIME is not set to pi" }, { status: 409 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      throw new AgentActionInputError("Request body must be an object");
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      throw new AgentActionInputError("message is required");
    }

    const actor = getActorContextFromSession(session);
    const agentRun = await getOrCreateAgentRunFromSession(
      session,
      typeof body.agentRunId === "string" ? body.agentRunId.trim() : null,
      "CHAT",
    );

    let sessionDetail;
    if (typeof body.sessionId === "string" && body.sessionId.trim()) {
      sessionDetail = await getAgentChatSessionDetail(actor, body.sessionId.trim());
    } else {
      const chatSession = await createAgentChatSession(actor, {
        agentRunId: agentRun.id,
        title: message.slice(0, 48),
        source: "CHAT",
      });
      sessionDetail = await getAgentChatSessionDetail(actor, chatSession.id);
    }

    await createAgentChatMessage(actor, {
      sessionId: sessionDetail.id,
      agentRunId: agentRun.id,
      role: "user",
      content: message,
      timeline: [{ id: `user_${Date.now()}`, kind: "text", content: message, status: "done" }],
    });

    const actions = await listAvailableAgentActions({
      ...actor,
      agentRunId: agentRun.id,
    });
    const tools = actions.map(actionToTool);
    const memories = await listAgentMemory(actor, { status: "ACTIVE", limit: 20 });
    const flags = getAgentRuntimeFlags();
    const history = (await getAgentChatSessionDetail(actor, sessionDetail.id)).messages.map((item) => ({
      role: item.role,
      content: item.content,
      createdAt: item.createdAt,
    }));

    const runtimeRes = await fetch(`${getAgentRuntimeBaseUrl()}/chat-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-runtime-token": getAgentRuntimeToken(),
      },
      body: JSON.stringify({
        requestId: randomUUID(),
        agentRunId: agentRun.id,
        sessionId: sessionDetail.id,
        user: {
          id: actor.userId,
          role: actor.role,
          name: actor.name,
          email: actor.email,
        },
        message,
        history,
        compactSummary: sessionDetail.compactSummary,
        memories: memories.map((item) => ({
          id: item.id,
          kind: item.kind,
          content: item.content,
          confidence: item.confidence,
          status: item.status,
        })),
        availableTools: tools,
        bridge: {
          appBaseUrl: getAppBaseUrl(),
          internalToolToken: getInternalToolToken(),
        },
        context: {
          currentView: null,
          viewControlEnabled: flags.viewControlEnabled,
          webSearchEnabled: flags.webSearchEnabled,
          proactiveEnabled: flags.proactiveEnabled,
        },
      }),
    });

    if (!runtimeRes.ok || !runtimeRes.body) {
      const text = await runtimeRes.text().catch(() => "");
      throw new Error(text || "Runtime stream failed");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let assistantContent = "";
    let assistantState = "done";
    const assistantTimeline: AgentTimelineItem[] = [];
    let tokenUsage: Record<string, unknown> | null = null;

    function handleEvent(rawLine: string) {
      if (!rawLine.trim()) return;
      const event = JSON.parse(rawLine) as Record<string, unknown>;
      if (event.type === "thinking_delta" && typeof event.id === "string" && typeof event.delta === "string") {
        upsertThinkingTimelineItem(assistantTimeline, event.id, event.delta);
      } else if (event.type === "text_delta" && typeof event.delta === "string") {
        assistantContent += event.delta;
        upsertTextTimelineItem(assistantTimeline, event.delta);
      } else if (event.type === "tool_start" && typeof event.id === "string" && typeof event.tool_name === "string") {
        upsertToolTimelineItem(assistantTimeline, event.id, {
          toolName: event.tool_name,
          label: typeof event.label === "string" ? event.label : event.tool_name,
          status: "running",
          input: event.input,
        });
      } else if (event.type === "tool_end" && typeof event.id === "string" && typeof event.tool_name === "string") {
        upsertToolTimelineItem(assistantTimeline, event.id, {
          toolName: event.tool_name,
          label: typeof event.label === "string" ? event.label : event.tool_name,
          status: "done",
          output: event.output,
        });
      } else if (event.type === "tool_error" && typeof event.id === "string" && typeof event.tool_name === "string") {
        assistantState = "error";
        upsertToolTimelineItem(assistantTimeline, event.id, {
          toolName: event.tool_name,
          label: typeof event.label === "string" ? event.label : event.tool_name,
          status: "error",
          error: typeof event.error === "string" ? event.error : "Tool execution failed",
        });
      } else if (event.type === "compact_start" && typeof event.id === "string") {
        upsertCompactTimelineItem(assistantTimeline, event.id, {
          status: "running",
          tokensBefore: typeof event.tokens_before === "number" ? event.tokens_before : undefined,
        });
      } else if (event.type === "compact_end" && typeof event.id === "string") {
        upsertCompactTimelineItem(assistantTimeline, event.id, {
          content: typeof event.summary === "string" ? event.summary : "",
          status: "done",
          tokensBefore: typeof event.tokens_before === "number" ? event.tokens_before : undefined,
          tokensAfter: typeof event.tokens_after === "number" ? event.tokens_after : undefined,
        });
      } else if (event.type === "memory_suggestion" && event.memory && typeof event.memory === "object") {
        assistantTimeline.push({
          id: typeof event.id === "string" ? event.id : `memory_${assistantTimeline.length}`,
          kind: "memory",
          content: typeof (event.memory as Record<string, unknown>).content === "string"
            ? (event.memory as Record<string, unknown>).content as string
            : "memory suggestion",
          status: "suggested",
        });
      } else if (event.type === "view_intent" && event.intent && typeof event.intent === "object") {
        assistantTimeline.push({
          id: typeof event.id === "string" ? event.id : `view_${assistantTimeline.length}`,
          kind: "view",
          intent: event.intent as AgentViewIntent,
          status: "suggested",
        });
      } else if (event.type === "proactive_task_suggestion" && event.task && typeof event.task === "object") {
        assistantTimeline.push({
          id: typeof event.id === "string" ? event.id : `proactive_${assistantTimeline.length}`,
          kind: "proactive",
          content: typeof (event.task as Record<string, unknown>).title === "string"
            ? (event.task as Record<string, unknown>).title as string
            : "proactive task suggestion",
          status: "suggested",
        });
      } else if (event.type === "usage" && event.usage && typeof event.usage === "object") {
        tokenUsage = event.usage as Record<string, unknown>;
      } else if (event.type === "message_end" && typeof event.content === "string") {
        assistantContent = event.content;
      } else if (event.type === "error") {
        assistantState = "error";
      }
    }

    const stream = runtimeRes.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          handleEvent(line);
        }
      },
      async flush() {
        const lastLine = `${buffer}${decoder.decode()}`.trim();
        if (lastLine) {
          handleEvent(lastLine);
        }
        if (assistantContent.trim() || assistantTimeline.length > 0) {
          await createAgentChatMessage(actor, {
            sessionId: sessionDetail.id,
            agentRunId: agentRun.id,
            role: "assistant",
            content: assistantContent.trim() || "Pi runtime returned an empty reply.",
            state: assistantState,
            timeline: normalizeTimeline(assistantTimeline),
            tokenUsage,
          });
        }
      },
    }));

    return new Response(stream, {
      headers: {
        "Content-Type": runtimeRes.headers.get("content-type") || "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "x-agent-session-id": sessionDetail.id,
        "x-agent-run-id": agentRun.id,
      },
    });
  } catch (error) {
    if (error instanceof AgentActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("agent chat stream failed:", error);
    return NextResponse.json({ error: "Agent chat stream failed" }, { status: 500 });
  }
}
