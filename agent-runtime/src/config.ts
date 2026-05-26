export interface RuntimeConfig {
  host: string;
  port: number;
  token: string;
  provider: "minimax";
  model: string;
  minimaxBaseUrl: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  contextWindowTokens: number;
  keepRecentTokens: number;
  reserveTokens: number;
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    host: process.env.AGENT_RUNTIME_HOST || "127.0.0.1",
    port: Number(process.env.AGENT_RUNTIME_PORT || "31110"),
    token: process.env.AGENT_RUNTIME_TOKEN || "dev-agent-runtime-token",
    provider: "minimax",
    model: process.env.MINIMAX_MODEL || "MiniMax-M2.7",
    minimaxBaseUrl: process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1",
    thinkingLevel: (
      process.env.AGENT_RUNTIME_THINKING_LEVEL === "off" ||
      process.env.AGENT_RUNTIME_THINKING_LEVEL === "minimal" ||
      process.env.AGENT_RUNTIME_THINKING_LEVEL === "low" ||
      process.env.AGENT_RUNTIME_THINKING_LEVEL === "high" ||
      process.env.AGENT_RUNTIME_THINKING_LEVEL === "xhigh"
    )
      ? process.env.AGENT_RUNTIME_THINKING_LEVEL
      : "medium",
    contextWindowTokens: Number(process.env.AGENT_CONTEXT_WINDOW_TOKENS || "1000000"),
    keepRecentTokens: Number(process.env.AGENT_COMPACTION_KEEP_RECENT_TOKENS || "12000"),
    reserveTokens: Number(process.env.AGENT_COMPACTION_RESERVE_TOKENS || "8000"),
  };
}
