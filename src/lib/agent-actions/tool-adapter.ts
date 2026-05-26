import type { AgentActionDefinition, AgentToolDefinition } from "./types";

export function actionToTool(action: AgentActionDefinition<unknown, unknown>): AgentToolDefinition {
  return {
    name: action.key,
    description: action.description,
    input_schema: action.inputSchema,
  };
}
