import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { MinimaxChatProvider } from "@/lib/draft/providers/minimax-chat";
import { isMinimaxConfigured } from "@/lib/minimax";
import { AgentActionError, AgentActionInputError } from "@/lib/agent-actions/errors";
import { executeAgentAction, getAgentAction, listAvailableAgentActions } from "@/lib/agent-actions/registry";
import { getOrCreateAgentRunFromSession, getActorContextFromAgentRun, getInternalToolToken } from "@/lib/agent-actions/run-context";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PlannedToolCall {
  actionKey: string;
  input: Record<string, unknown>;
  reason?: string;
}

interface ToolExecutionResponse {
  ok: boolean;
  actionKey: string;
  mode: "result" | "proposal";
  result?: unknown;
  proposal?: unknown;
  error?: string;
}

async function normalizePlannedToolCall(
  actor: Awaited<ReturnType<typeof getActorContextFromAgentRun>>,
  toolCall: PlannedToolCall,
): Promise<PlannedToolCall> {
  if (toolCall.actionKey === "orders.get_finance_snapshot") {
    const rawOrderId = typeof toolCall.input.orderId === "string" ? toolCall.input.orderId.trim() : "";
    if (!rawOrderId) return toolCall;

    const search = await executeAgentAction(actor, "orders.search", {
      query: rawOrderId,
      limit: 5,
    });
    const items = (search.result as { items?: Array<{ id: string; orderNo?: string | null; externalOrderNo?: string | null }> }).items ?? [];
    const exactMatches = items.filter((item) => item.id === rawOrderId || item.orderNo === rawOrderId || item.externalOrderNo === rawOrderId);
    if (exactMatches.length === 1) {
      return {
        ...toolCall,
        input: { orderId: exactMatches[0].id },
        reason: `${toolCall.reason || "解析订单摘要"}（已根据订单号解析内部 ID）`,
      };
    }
  }

  if (toolCall.actionKey === "projects.get_summary") {
    const rawProjectId = typeof toolCall.input.projectId === "string" ? toolCall.input.projectId.trim() : "";
    if (!rawProjectId) return toolCall;

    const search = await executeAgentAction(actor, "projects.search", {
      query: rawProjectId,
      limit: 5,
    });
    const items = (search.result as { items?: Array<{ id: string; name?: string | null }> }).items ?? [];
    const exactMatches = items.filter((item) => item.id === rawProjectId || item.name === rawProjectId);
    if (exactMatches.length === 1) {
      return {
        ...toolCall,
        input: { projectId: exactMatches[0].id },
        reason: `${toolCall.reason || "解析项目摘要"}（已根据项目名称解析内部 ID）`,
      };
    }
  }

  return toolCall;
}

function shouldFollowProjectSummary(toolCall: PlannedToolCall) {
  if (toolCall.actionKey !== "projects.search") return false;
  return /摘要|详情|概览/.test(toolCall.reason ?? "");
}

async function executeToolViaInternalApi(
  origin: string,
  agentRunId: string,
  toolCall: PlannedToolCall,
) {
  const toolRes = await fetch(
    new URL("/api/agent/tools/execute", origin),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-internal-token": getInternalToolToken(),
      },
      body: JSON.stringify({
        agentRunId,
        actionKey: toolCall.actionKey,
        input: toolCall.input,
      }),
    },
  );

  const toolData = await toolRes.json() as ToolExecutionResponse;
  if (!toolRes.ok) {
    throw new Error(typeof toolData.error === "string" ? toolData.error : "Tool execution failed");
  }

  return toolData;
}

async function maybeExecuteFollowUpTool(
  origin: string,
  agentRunId: string,
  toolCall: PlannedToolCall,
  toolResult: unknown,
) {
  if (shouldFollowProjectSummary(toolCall)) {
    const items = (toolResult as { items?: Array<{ id: string }> }).items ?? [];
    if (items.length === 1 && items[0]?.id) {
      const followUpToolCall: PlannedToolCall = {
        actionKey: "projects.get_summary",
        input: { projectId: items[0].id },
        reason: "已定位到唯一项目，继续读取项目摘要",
      };
      return executeToolViaInternalApi(origin, agentRunId, followUpToolCall);
    }
  }

  return null;
}

function isChatMessage(value: unknown): value is ChatMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "role" in value &&
      "content" in value &&
      ((value as { role?: unknown }).role === "user" || (value as { role?: unknown }).role === "assistant") &&
      typeof (value as { content?: unknown }).content === "string",
  );
}

function stripFence(content: string) {
  return content
    .replace(/```json?\n?/g, "")
    .replace(/```/g, "")
    .trim();
}

function stripThought(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJsonCandidates(content: string) {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          candidates.push(content.slice(start, index + 1));
          start = -1;
        }
      }
    }
  }

  return candidates;
}

function findBalancedJsonObjectSegment(content: string, startPattern: RegExp) {
  const matched = startPattern.exec(content);
  if (!matched || matched.index < 0) return null;

  const openBraceIndex = content.indexOf("{", matched.index);
  if (openBraceIndex < 0) return null;

  let depth = 0;
  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(openBraceIndex, index + 1);
      }
    }
  }

  return null;
}

function fallbackParsePlannerResponse(content: string): { reply?: string; tool_calls?: PlannedToolCall[] } {
  const cleaned = stripThought(stripFence(content));
  const replyMatch = cleaned.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const actionBlocks = cleaned.match(/"actionKey"\s*:\s*"[^"]+"[\s\S]*?"input"\s*:\s*\{[\s\S]*?\}/g) ?? [];
  const toolCalls: PlannedToolCall[] = [];

  for (const block of actionBlocks) {
    const actionKeyMatch = block.match(/"actionKey"\s*:\s*"([^"]+)"/);
    if (!actionKeyMatch) continue;

    const inputSegment = findBalancedJsonObjectSegment(block, /"input"\s*:/);
    if (!inputSegment) continue;

    try {
      const input = JSON.parse(inputSegment) as Record<string, unknown>;
      const reasonMatch = block.match(/"reason"\s*:\s*"([^"]*)"/);
      toolCalls.push({
        actionKey: actionKeyMatch[1],
        input,
        reason: reasonMatch?.[1],
      });
    } catch {
      continue;
    }
  }

  return {
    reply: replyMatch?.[1],
    tool_calls: toolCalls,
  };
}

function parsePlannerResponse(content: string): { reply?: string; tool_calls?: PlannedToolCall[] } {
  const cleaned = stripThought(stripFence(content));
  const candidates = extractJsonCandidates(cleaned);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { reply?: string; tool_calls?: PlannedToolCall[] };
    } catch {
      continue;
    }
  }

  return fallbackParsePlannerResponse(cleaned);
}

function safeParsePlannerResponse(content: string) {
  try {
    const parsed = parsePlannerResponse(content);
    if ((parsed.reply && parsed.reply.trim()) || (parsed.tool_calls && parsed.tool_calls.length > 0)) {
      return parsed;
    }
    throw new Error("Planner response did not contain structured content");
  } catch {
    return { reply: stripThought(stripFence(content)), tool_calls: [] as PlannedToolCall[] };
  }
}

function serializeHistory(messages: ChatMessage[]) {
  return messages.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n");
}

function toolPlanningPrompt(actions: Awaited<ReturnType<typeof listAvailableAgentActions>>) {
  const toolSpecs = actions
    .map((action) => ({
      key: action.key,
      title: action.title,
      riskLevel: action.riskLevel,
      description: action.description,
      inputSchema: action.inputSchema,
    }));

  return [
    "你是 SciManage 的科研业务助理。你服务中文用户，场景是项目、订单、CRM、财务线索的查询和摘要，也可以为写操作生成待确认 proposal。",
    "",
    "你可以使用这些动作：",
    JSON.stringify(toolSpecs, null, 2),
    "",
    "输出必须是 JSON，不要写额外文字，格式固定为：",
    "{",
    '  "reply": "给用户的简短回应，若要先查数据可写正在查询的意图",',
    '  "tool_calls": [',
    "    {",
    '      "actionKey": "动作 key",',
    '      "input": { "参数": "值" },',
    '      "reason": "为什么需要这个动作"',
    "    }",
    "  ]",
    "}",
    "",
    "规则：",
    "1. 如无需查数据，tool_calls 返回空数组。",
    "2. 最多使用 3 个动作。",
    "3. 只能使用上面提供的动作 key。",
    "4. 参数必须严格贴合 inputSchema。",
    "5. riskLevel 为 safe 的动作会直接执行；riskLevel 为 confirm 的动作只会生成待用户确认的 proposal。",
    "6. projects.get_summary、orders.get_finance_snapshot 这类摘要动作必须使用内部 ID；如果用户只给名称、订单号或关键词，要先用 search 动作。",
    "7. 不得编造结果。",
  ].join("\n");
}

function toolSummaryPrompt() {
  return `你是 SciManage 的科研业务助理。你会基于用户问题和工具结果，给出清晰、克制、可执行的中文回答。

输出必须是 JSON，不要写额外文字，格式固定为：
{
  "reply": "给用户的最终回答",
  "follow_ups": ["可选的后续追问 1", "可选的后续追问 2"]
}

要求：
1. 直接回答，不解释你是如何被提示的。
2. 如果结果为空，要明确说没查到，并给出下一步建议。
3. 如果有 proposal，要明确告诉用户需要确认才能执行。
4. 对金额、数量、状态使用简洁表述。`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isMinimaxConfigured()) {
    return NextResponse.json({ error: "MiniMax API 未配置" }, { status: 503 });
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
    const requestedAgentRunId = typeof body.agentRunId === "string" ? body.agentRunId.trim() : "";

    const history = Array.isArray(body.history)
      ? body.history.filter(isChatMessage)
      : [];

    const agentRun = await getOrCreateAgentRunFromSession(session, requestedAgentRunId || null, "CHAT");
    const actor = await getActorContextFromAgentRun(agentRun.id);
    const actions = await listAvailableAgentActions(actor);
    const provider = new MinimaxChatProvider();

    const planningMessage = [
      history.length > 0 ? `历史对话：\n${serializeHistory(history)}` : "",
      `当前用户问题：${message}`,
    ].filter(Boolean).join("\n\n");

    const planResponse = await provider.chat({
      systemPrompt: toolPlanningPrompt(actions),
      userMessage: planningMessage,
      temperature: 0.2,
      maxTokens: 1400,
    });

    const plan = safeParsePlannerResponse(planResponse.content);
    const plannedToolCalls = Array.isArray(plan.tool_calls) ? plan.tool_calls.slice(0, 3) : [];

    const toolRuns: Array<{
      actionKey: string;
      reason?: string;
      input: Record<string, unknown>;
      status: "done" | "error";
      result?: unknown;
      error?: string;
    }> = [];
    const proposals: Array<unknown> = [];

    for (const toolCall of plannedToolCalls) {
      try {
        const normalizedToolCall = await normalizePlannedToolCall(actor, toolCall);
        const action = getAgentAction(normalizedToolCall.actionKey);
        if (!action) {
          throw new AgentActionInputError(`Unknown action: ${normalizedToolCall.actionKey}`);
        }

        const toolData = await executeToolViaInternalApi(req.nextUrl.origin, agentRun.id, normalizedToolCall);

        if (toolData.mode === "proposal") {
          proposals.push(toolData.proposal);
        } else {
          toolRuns.push({
            actionKey: normalizedToolCall.actionKey,
            reason: normalizedToolCall.reason,
            input: normalizedToolCall.input,
            status: "done",
            result: toolData.result,
          });

          const followUpToolData = await maybeExecuteFollowUpTool(
            req.nextUrl.origin,
            agentRun.id,
            normalizedToolCall,
            toolData.result,
          );
          if (followUpToolData?.mode === "proposal") {
            proposals.push(followUpToolData.proposal);
          } else if (followUpToolData?.mode === "result") {
            toolRuns.push({
              actionKey: normalizedToolCall.actionKey === "projects.search"
                ? "projects.get_summary"
                : normalizedToolCall.actionKey,
              reason: "已根据唯一匹配结果继续读取摘要",
              input: normalizedToolCall.actionKey === "projects.search"
                ? {
                    projectId: (toolData.result as { items?: Array<{ id: string }> }).items?.[0]?.id,
                  }
                : normalizedToolCall.input,
              status: "done",
              result: followUpToolData.result,
            });
          }
        }
      } catch (error) {
        toolRuns.push({
          actionKey: toolCall.actionKey,
          reason: toolCall.reason,
          input: toolCall.input,
          status: "error",
          error: error instanceof Error ? error.message : "Tool execution failed",
        });
      }
    }

    let reply = (plan.reply || "").trim();
    let followUps: string[] = [];

    if (toolRuns.length > 0 || proposals.length > 0) {
      try {
        const summaryResponse = await provider.chat({
          systemPrompt: toolSummaryPrompt(),
          userMessage: `用户问题：${message}

历史对话：
${serializeHistory(history)}

工具结果：
${JSON.stringify(toolRuns, null, 2)}

待确认 proposal：
${JSON.stringify(proposals, null, 2)}`,
          temperature: 0.2,
          maxTokens: 1800,
        });

        const summary = safeParsePlannerResponse(summaryResponse.content) as { reply?: string; follow_ups?: string[] };
        reply = (summary.reply || reply || "我已经查完结果。").trim();
        followUps = Array.isArray(summary.follow_ups)
          ? summary.follow_ups.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 3)
          : [];
      } catch (summaryError) {
        console.error("agent chat summary failed:", summaryError);
        if (proposals.length > 0 && toolRuns.length > 0) {
          reply = `我已经完成查询，并生成了 ${proposals.length} 条待确认动作。你可以先确认 proposal，再继续追问结果细节。`;
        } else if (proposals.length > 0) {
          reply = `我已经生成了 ${proposals.length} 条待确认动作。确认后系统才会真正执行写操作。`;
        } else if (toolRuns.some((toolRun) => toolRun.status === "done")) {
          reply = "我已经完成查询，但本次总结整理失败。你可以直接查看工具结果，或重试一次。";
        } else {
          reply = "我尝试执行了相关动作，但总结整理失败。你可以重试一次。";
        }
      }
    } else if (!reply) {
      reply = "我可以继续帮你查项目、订单、CRM 客户，或者根据现有内容做摘要。";
    }

    return NextResponse.json({
      ok: true,
      agentRunId: agentRun.id,
      reply,
      toolRuns,
      proposals,
      followUps,
    });
  } catch (error) {
    if (error instanceof AgentActionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    console.error("agent chat failed:", error);
    return NextResponse.json({ error: "Agent chat failed" }, { status: 500 });
  }
}
