export interface RuntimeHistoryMessage {
  role: string;
  content: string;
  createdAt?: string;
}

export interface RuntimeMemory {
  id: string;
  kind: string;
  content: string;
  confidence?: number;
  status?: string;
}

export interface RuntimeToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface RuntimeBridgeConfig {
  appBaseUrl: string;
  internalToolToken: string;
}

export interface RuntimeChatStreamRequest {
  requestId: string;
  agentRunId: string;
  sessionId: string;
  user: {
    id: string;
    role: string;
    name?: string | null;
    email?: string | null;
  };
  message: string;
  history: RuntimeHistoryMessage[];
  compactSummary?: string | null;
  memories: RuntimeMemory[];
  availableTools: RuntimeToolSpec[];
  bridge: RuntimeBridgeConfig;
  context: {
    currentView?: Record<string, unknown> | null;
    viewControlEnabled: boolean;
    webSearchEnabled: boolean;
    proactiveEnabled: boolean;
  };
}

export interface RuntimeCompactRequest {
  sessionId: string;
  history: RuntimeHistoryMessage[];
  compactSummary?: string | null;
}
