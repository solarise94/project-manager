import { Agent, estimateContextTokens, type AgentTool, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  completeSimple,
  getEnvApiKey,
  registerBuiltInApiProviders,
  type AssistantMessage,
  type Message,
  type Model,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { getRuntimeConfig } from "./config.js";
import type {
  RuntimeBridgeConfig,
  RuntimeChatStreamRequest,
  RuntimeCompactRequest,
  RuntimeHistoryMessage,
  RuntimeToolSpec,
} from "./types.js";

registerBuiltInApiProviders();

const config = getRuntimeConfig();

type RuntimeEvent = Record<string, unknown>;

interface ToolExecutionResponse {
  ok?: boolean;
  actionKey?: string;
  mode?: "result" | "proposal";
  result?: unknown;
  proposal?: {
    id?: string;
    title?: string;
    summary?: string;
    status?: string;
    [key: string]: unknown;
  };
  error?: string;
}

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

function createRuntimeModel(): Model<"openai-completions"> {
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: config.provider,
    baseUrl: config.minimaxBaseUrl,
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0.3,
      output: 1.2,
      cacheRead: 0.06,
      cacheWrite: 0.375,
    },
    contextWindow: Math.max(config.contextWindowTokens, 32768),
    maxTokens: 16384,
    compat: {
      supportsDeveloperRole: false,
    },
  };
}

function createUsageZero() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function createAssistantHistoryMessage(content: string, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: "openai-completions",
    provider: config.provider,
    model: config.model,
    usage: createUsageZero(),
    stopReason: "stop",
    timestamp,
  };
}

function normalizeTimestamp(value: string | undefined, fallback: number) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringifyJson(value: unknown, maxLength = 5000) {
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!raw) return "";
  return raw.length > maxLength ? `${raw.slice(0, maxLength)}\n...(truncated)` : raw;
}

function approximateTokenCount(text: string) {
  const normalized = text.trim();
  if (!normalized) return 0;
  const chineseCharCount = (normalized.match(/[\u3400-\u9fff]/g) || []).length;
  const otherCharCount = Math.max(0, normalized.length - chineseCharCount);
  return Math.max(1, chineseCharCount + Math.ceil(otherCharCount / 4));
}

function messageContentToText(message: Message) {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function getContextTokenCount(messages: Message[]) {
  const estimated = estimateContextTokens(messages).tokens;
  if (Number.isFinite(estimated) && estimated > 0) {
    return estimated;
  }

  return approximateTokenCount(
    messages
      .map((message) => messageContentToText(message))
      .join("\n"),
  );
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

function extractTextFromAssistant(message: AssistantMessage) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

function splitForPartialTag(text: string, tag: string) {
  for (let size = Math.min(tag.length - 1, text.length); size > 0; size -= 1) {
    if (text.endsWith(tag.slice(0, size))) {
      return {
        stable: text.slice(0, -size),
        carry: text.slice(-size),
      };
    }
  }
  return { stable: text, carry: "" };
}

function toHistoryMessage(history: RuntimeHistoryMessage, fallbackIndex: number): Message {
  const timestamp = normalizeTimestamp(history.createdAt, Date.now() + fallbackIndex);
  if (history.role === "assistant") {
    return createAssistantHistoryMessage(history.content, timestamp);
  }
  return {
    role: "user",
    content: history.content,
    timestamp,
  } satisfies UserMessage;
}

function stripDuplicatedCurrentMessage(history: RuntimeHistoryMessage[], message: string) {
  if (history.length === 0) return history;
  const last = history[history.length - 1];
  if (last.role === "user" && last.content.trim() === message.trim()) {
    return history.slice(0, -1);
  }
  return history;
}

function selectRecentHistory(history: RuntimeHistoryMessage[]) {
  const selected: Message[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = toHistoryMessage(history[index], index);
    const nextMessages = [candidate, ...selected];
    const tokens = getContextTokenCount(nextMessages);
    if (selected.length > 0 && tokens > config.keepRecentTokens) {
      break;
    }
    selected.unshift(candidate);
  }
  return selected;
}

function buildCompactSection(summary: string | null | undefined) {
  const text = summary?.trim();
  if (!text) return "";
  return `\n[压缩上下文摘要]\n${text}\n`;
}

function buildMemorySection(request: RuntimeChatStreamRequest) {
  if (request.memories.length === 0) return "";
  const lines = request.memories
    .slice(0, 12)
    .map((memory, index) => `${index + 1}. [${memory.kind}] ${memory.content}`);
  return `\n[用户长期偏好 / memory]\n${lines.join("\n")}\n`;
}

function buildSystemPrompt(request: RuntimeChatStreamRequest) {
  const viewInstruction = request.context.viewControlEnabled
    ? "当用户明确需要切换页面、聚焦实体或设置筛选时，可以使用 agent.suggest_view 提出受控视图意图。"
    : "当前不允许直接提出视图切换指令。";
  const proactiveInstruction = request.context.proactiveEnabled
    ? "当用户明确要求提醒、定时跟进或主动提示时，可以使用 agent.schedule_proactive_task。"
    : "当前不启用主动提醒创建。";
  const searchInstruction = request.context.webSearchEnabled
    ? "遇到需要联网核实、补充机构/人物/外部资料时，可以使用 web.search。"
    : "当前不启用联网搜索。";

  return [
    "你是 SciManage 的中文科研项目管理 Agent，服务于项目、订单、CRM、财务和工单工作流。",
    "原则：",
    "1. 内部数据优先使用系统工具，不要臆造项目、订单、客户、发票或权限结果。",
    "2. 当工具返回 proposal 模式时，表示动作尚未执行，只能向用户说明已生成待确认 proposal。",
    "3. 回答保持直接、清晰、偏执行，不写空泛套话。",
    `4. ${searchInstruction}`,
    `5. ${proactiveInstruction}`,
    `6. ${viewInstruction}`,
    "7. 用户明确表达稳定偏好、纠正你、或反复强调使用习惯时，可以使用 agent.save_memory 记录。",
    buildCompactSection(request.compactSummary),
    buildMemorySection(request),
  ].join("\n");
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  bridge: RuntimeBridgeConfig,
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-internal-token": bridge.internalToolToken,
    },
    body: JSON.stringify(body),
    signal,
  });

  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

async function executeBusinessTool(
  tool: RuntimeToolSpec,
  bridge: RuntimeBridgeConfig,
  agentRunId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const payload = await postJson<ToolExecutionResponse>(
    new URL("/api/agent/tools/execute", bridge.appBaseUrl).toString(),
    {
      agentRunId,
      actionKey: tool.name,
      input: params,
    },
    bridge,
    signal,
  );

  if (payload.mode === "proposal" && payload.proposal) {
    const title = payload.proposal.title || tool.name;
    const summary = typeof payload.proposal.summary === "string" ? payload.proposal.summary : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `已生成待确认 proposal：${title}${summary ? `\n${summary}` : ""}`,
        },
      ],
      details: payload,
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: stringifyJson(payload.result, 5000) || `${tool.name} 执行成功。`,
      },
    ],
    details: payload,
  };
}

async function performWebSearch(query: string, maxResults: number) {
  const baseHost = config.minimaxBaseUrl.replace(/\/v1\/?$/, "");
  const response = await fetch(`${baseHost}/v1/coding_plan/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getEnvApiKey(config.provider) || ""}`,
    },
    body: JSON.stringify({ q: query }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`MiniMax search failed (${response.status}): ${text}`);
  }

  const data = await response.json() as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  const organic = Array.isArray(data.organic) ? data.organic : [];
  return organic.slice(0, Math.max(1, Math.min(maxResults, 8))).map((item) => ({
    title: item.title || "",
    url: item.link || "",
    snippet: item.snippet || "",
  })) satisfies SearchResultItem[];
}

function buildSearchContent(results: SearchResultItem[]) {
  if (results.length === 0) {
    return "没有检索到可用结果。";
  }
  return results
    .map((item, index) => `${index + 1}. ${item.title}\nURL: ${item.url}\n摘要: ${item.snippet}`)
    .join("\n\n");
}

function buildRuntimeTools(request: RuntimeChatStreamRequest) {
  const businessTools = request.availableTools.map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.input_schema as never,
    executionMode: "sequential" as const,
    execute: async (
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ) => executeBusinessTool(tool, request.bridge, request.agentRunId, asRecord(params), signal),
  })) as AgentTool[];

  const extraTools: AgentTool[] = [];

  if (request.context.webSearchEnabled) {
    extraTools.push({
      name: "web.search",
      label: "联网搜索",
      description: "通过 MiniMax 搜索外部网页资料，适合核实公开信息、机构资料、新闻和外部背景。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          maxResults: { type: "number", description: "返回结果上限，默认 5，最多 8" },
        },
        required: ["query"],
        additionalProperties: false,
      } as never,
      executionMode: "sequential",
      execute: async (_toolCallId, params: unknown) => {
        const args = asRecord(params);
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) {
          throw new Error("query is required");
        }
        const maxResults = typeof args.maxResults === "number" ? args.maxResults : 5;
        const results = await performWebSearch(query, maxResults);
        return {
          content: [{ type: "text", text: buildSearchContent(results) }],
          details: { query, results },
        };
      },
    });
  }

  extraTools.push({
    name: "agent.save_memory",
    label: "记录用户偏好",
    description: "当用户明确表达稳定偏好、固定格式、常用工作习惯或对你的纠正时，保存为长期 memory。",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", description: "preference / working_context / instruction / correction" },
        content: { type: "string", description: "要保存的记忆内容，使用简洁中文陈述句" },
        confidence: { type: "number", description: "0 到 1，默认 0.85" },
      },
      required: ["kind", "content"],
      additionalProperties: false,
    } as never,
    executionMode: "sequential",
    execute: async (_toolCallId, params: unknown, signal?: AbortSignal) => {
      const args = asRecord(params);
      const payload = await postJson<{ item: Record<string, unknown> }>(
        new URL("/api/agent/memory", request.bridge.appBaseUrl).toString(),
        {
          agentRunId: request.agentRunId,
          kind: args.kind,
          content: args.content,
          confidence: typeof args.confidence === "number" ? args.confidence : 0.85,
          source: "AGENT",
          metadata: {
            sessionId: request.sessionId,
            requestId: request.requestId,
          },
        },
        request.bridge,
        signal,
      );

      return {
        content: [{ type: "text", text: `已记录 memory：${String(args.content ?? "")}` }],
        details: payload.item,
      };
    },
  });

  if (request.context.proactiveEnabled) {
    extraTools.push({
      name: "agent.schedule_proactive_task",
      label: "创建主动提醒",
      description: "为用户创建未来提醒、跟进或主动提示任务。仅在用户明确要求提醒、催办或后续主动提示时使用。",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", description: "reminder / daily_digest / followup_prompt / anomaly_watch" },
          title: { type: "string", description: "提醒标题" },
          content: { type: "string", description: "提醒内容" },
          triggerAt: { type: "string", description: "ISO 时间，例如 2026-05-26T09:00:00+08:00" },
          link: { type: "string", description: "可选跳转链接" },
        },
        required: ["kind", "title", "content", "triggerAt"],
        additionalProperties: false,
      } as never,
      executionMode: "sequential",
      execute: async (_toolCallId, params: unknown, signal?: AbortSignal) => {
        const args = asRecord(params);
        const payload = await postJson<{ item: Record<string, unknown> }>(
          new URL("/api/agent/proactive-tasks", request.bridge.appBaseUrl).toString(),
          {
            agentRunId: request.agentRunId,
            sessionId: request.sessionId,
            kind: args.kind,
            title: args.title,
            triggerAt: args.triggerAt,
            status: "SCHEDULED",
            payload: {
              content: args.content,
              link: args.link,
              source: "agent-runtime",
            },
          },
          request.bridge,
          signal,
        );

        return {
          content: [{ type: "text", text: `已安排提醒：${String(args.title ?? "")}` }],
          details: payload.item,
        };
      },
    });
  }

  if (request.context.viewControlEnabled) {
    extraTools.push({
      name: "agent.suggest_view",
      label: "建议视图切换",
      description: "提出一个受控的页面/面板/筛选意图，供前端未来决定是否应用。",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "navigate / focus_entity / open_panel / set_filter" },
          route: { type: "string" },
          entityType: { type: "string" },
          entityId: { type: "string" },
          panel: { type: "string" },
          label: { type: "string" },
          reason: { type: "string" },
          filters: { type: "object" },
        },
        required: ["type", "label"],
        additionalProperties: false,
      } as never,
      executionMode: "sequential",
      execute: async (_toolCallId, params: unknown) => {
        const args = asRecord(params);
        return {
          content: [{ type: "text", text: `已提出视图建议：${String(args.label ?? "未命名视图意图")}` }],
          details: args,
        };
      },
    });
  }

  return [...businessTools, ...extraTools];
}

function emitUsage(message: AssistantMessage, emit: (event: RuntimeEvent) => void) {
  emit({
    type: "usage",
    usage: {
      total_tokens: message.usage.totalTokens,
      input_tokens: message.usage.input,
      output_tokens: message.usage.output,
      cache_read_tokens: message.usage.cacheRead,
      cache_write_tokens: message.usage.cacheWrite,
    },
  });
}

function mapSpecialToolEvent(
  toolName: string,
  result: unknown,
  emit: (event: RuntimeEvent) => void,
) {
  const details = result && typeof result === "object" && "details" in (result as Record<string, unknown>)
    ? (result as { details?: unknown }).details
    : undefined;

  if (toolName === "agent.save_memory" && details && typeof details === "object") {
    emit({
      type: "memory_suggestion",
      id: `memory_${Date.now()}`,
      memory: details,
    });
  }

  if (toolName === "agent.schedule_proactive_task" && details && typeof details === "object") {
    emit({
      type: "proactive_task_suggestion",
      id: `proactive_${Date.now()}`,
      task: details,
    });
  }

  if (toolName === "agent.suggest_view" && details && typeof details === "object") {
    emit({
      type: "view_intent",
      id: `view_${Date.now()}`,
      intent: details,
    });
  }
}

export async function streamChat(
  request: RuntimeChatStreamRequest,
  emit: (event: RuntimeEvent) => void,
) {
  const model = createRuntimeModel();
  const baseHistory = stripDuplicatedCurrentMessage(request.history, request.message);
  const recentMessages = selectRecentHistory(baseHistory);
  const tools = buildRuntimeTools(request);
  const systemPrompt = buildSystemPrompt(request);
  const finalAssistantMessages: AssistantMessage[] = [];
  const inlineThinkState = {
    inThink: false,
    carry: "",
  };

  function emitSmartTextDelta(delta: string) {
    let remaining = `${inlineThinkState.carry}${delta}`;
    inlineThinkState.carry = "";

    while (remaining) {
      if (inlineThinkState.inThink) {
        const closeIndex = remaining.indexOf("</think>");
        if (closeIndex >= 0) {
          const thinkingText = remaining.slice(0, closeIndex);
          if (thinkingText) {
            emit({
              type: "thinking_delta",
              id: `thinking_${finalAssistantMessages.length}_inline`,
              delta: thinkingText,
            });
          }
          inlineThinkState.inThink = false;
          remaining = remaining.slice(closeIndex + "</think>".length);
          continue;
        }

        const { stable, carry } = splitForPartialTag(remaining, "</think>");
        if (stable) {
          emit({
            type: "thinking_delta",
            id: `thinking_${finalAssistantMessages.length}_inline`,
            delta: stable,
          });
        }
        inlineThinkState.carry = carry;
        return;
      }

      const openIndex = remaining.indexOf("<think>");
      if (openIndex >= 0) {
        const visibleText = remaining.slice(0, openIndex);
        if (visibleText) {
          emit({
            type: "text_delta",
            id: `text_${finalAssistantMessages.length}_0`,
            delta: visibleText,
          });
        }
        inlineThinkState.inThink = true;
        remaining = remaining.slice(openIndex + "<think>".length);
        continue;
      }

      const { stable, carry } = splitForPartialTag(remaining, "<think>");
      if (stable) {
        emit({
          type: "text_delta",
          id: `text_${finalAssistantMessages.length}_0`,
          delta: stable,
        });
      }
      inlineThinkState.carry = carry;
      return;
    }
  }

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: config.thinkingLevel as ThinkingLevel,
      tools,
      messages: recentMessages,
    },
    convertToLlm: (messages) => messages as Message[],
    sessionId: request.sessionId,
    toolExecution: "sequential",
    getApiKey: () => getEnvApiKey(config.provider),
  });

  agent.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "assistant") {
      emit({
        type: "message_start",
        message_id: `msg_${request.requestId}_${finalAssistantMessages.length}`,
      });
      return;
    }

    if (event.type === "message_update" && event.message.role === "assistant") {
      const partial = event.assistantMessageEvent;
      if (partial.type === "thinking_delta") {
        emit({
          type: "thinking_delta",
          id: `thinking_${finalAssistantMessages.length}_${partial.contentIndex}`,
          delta: partial.delta,
        });
      } else if (partial.type === "text_delta") {
        emitSmartTextDelta(partial.delta);
      }
      return;
    }

    if (event.type === "tool_execution_start") {
      emit({
        type: "tool_start",
        id: event.toolCallId,
        tool_name: event.toolName,
        label: event.toolName,
        input: event.args,
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      mapSpecialToolEvent(event.toolName, event.result, emit);
      emit({
        type: event.isError ? "tool_error" : "tool_end",
        id: event.toolCallId,
        tool_name: event.toolName,
        label: event.toolName,
        output: event.isError ? undefined : event.result,
        error: event.isError ? stringifyJson(event.result, 1200) : undefined,
      });
      return;
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      finalAssistantMessages.push(event.message);
      const content = extractTextFromAssistant(event.message);
      emit({
        type: "message_end",
        message_id: `msg_${request.requestId}_${finalAssistantMessages.length - 1}`,
        content,
      });
      emitUsage(event.message, emit);
      return;
    }

    if (event.type === "agent_end") {
      const lastAssistant = [...event.messages].reverse().find((message): message is AssistantMessage => (
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        message.role === "assistant"
      ));
      if (lastAssistant?.stopReason === "error" || lastAssistant?.stopReason === "aborted") {
        emit({
          type: "error",
          error: lastAssistant.errorMessage || "Agent runtime failed",
        });
      }
    }
  });

  try {
    await agent.prompt(request.message);
  } catch (error) {
    emit({
      type: "error",
      error: error instanceof Error ? error.message : "Unknown agent runtime error",
    });
  }
}

function buildCompactionPrompt(request: RuntimeCompactRequest) {
  const lines = request.history.map((message) => `${message.role}: ${message.content}`).join("\n");
  return [
    "请把下面的会话压缩成一段面向后续 agent 推理的中文摘要。",
    "要求：",
    "1. 保留用户目标、关键事实、已确认约束、已执行动作、待确认事项。",
    "2. 不要保留寒暄、重复表述和无关细节。",
    "3. 输出纯文本，不要 JSON，不要项目符号前缀。",
    request.compactSummary?.trim() ? `已有摘要：\n${request.compactSummary.trim()}` : "",
    "会话内容：",
    lines,
  ].filter(Boolean).join("\n\n");
}

export async function compactConversation(request: RuntimeCompactRequest) {
  const history = request.history.map((item, index) => toHistoryMessage(item, index));
  const tokensBefore = getContextTokenCount(history);

  try {
    const message = await completeSimple(
      createRuntimeModel(),
      {
        systemPrompt: "你负责为 agent 生成高密度的上下文压缩摘要。",
        messages: [{
          role: "user",
          content: buildCompactionPrompt(request),
          timestamp: Date.now(),
        }],
      },
      {
        reasoning: "minimal",
        apiKey: getEnvApiKey(config.provider),
      },
    );

    const summary = extractTextFromAssistant(message).trim();
    const tokensAfter = getContextTokenCount([{
      role: "user",
      content: summary,
      timestamp: Date.now(),
    }]);

    return {
      summary,
      tokensBefore,
      tokensAfter,
    };
  } catch {
    const summary = request.history
      .slice(-12)
      .map((item) => `${item.role}: ${item.content}`)
      .join("\n")
      .slice(0, 1600);
    const tokensAfter = getContextTokenCount([{
      role: "user",
      content: summary,
      timestamp: Date.now(),
    }]);

    return {
      summary,
      tokensBefore,
      tokensAfter,
    };
  }
}
