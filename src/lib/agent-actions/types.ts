export type JsonSchemaValue =
  | string
  | number
  | boolean
  | null
  | JsonSchemaObject
  | JsonSchemaValue[];

export interface JsonSchemaObject {
  [key: string]: JsonSchemaValue;
}

export type AgentActionDomain = "projects" | "orders" | "crm" | "finance" | "tickets";
export type AgentActionRiskLevel = "safe" | "confirm" | "restricted";

export interface ActorContext {
  userId: string;
  role: string;
  name?: string | null;
  email?: string | null;
  agentRunId?: string | null;
}

export interface AgentActionTarget {
  type?: string | null;
  id?: string | null;
}

export interface AgentProposalDescriptor {
  title: string;
  summary: string;
  target?: AgentActionTarget;
  proposalInput?: Record<string, unknown>;
}

export interface AgentActionDefinition<Input, Output> {
  key: string;
  title: string;
  description: string;
  domain: AgentActionDomain;
  riskLevel: AgentActionRiskLevel;
  readOnly: boolean;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  parseInput: (raw: unknown) => Input;
  availability: (actor: ActorContext) => Promise<boolean>;
  execute: (actor: ActorContext, input: Input) => Promise<Output>;
  buildProposal?: (actor: ActorContext, input: Input) => Promise<AgentProposalDescriptor>;
  resolveTarget?: (input: Input, output: Output) => Promise<AgentActionTarget | null> | AgentActionTarget | null;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchemaObject;
}

export interface AgentActionExecutionResult<Output> {
  action: AgentActionDefinition<unknown, Output>;
  result: Output;
}

export interface AgentActionProposalRecord {
  id: string;
  userId: string;
  agentRunId?: string | null;
  actionKey: string;
  title: string;
  summary: string;
  riskLevel: AgentActionRiskLevel;
  status: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string | null;
}

export interface AgentRunRecord {
  id: string;
  userId: string;
  role: string;
  name?: string | null;
  email?: string | null;
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
}
