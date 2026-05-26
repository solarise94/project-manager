import {
  AgentActionConfirmationRequiredError,
  AgentActionForbiddenError,
  AgentActionNotFoundError,
} from "./errors";
import { createAgentActionLog } from "./logs";
import type {
  ActorContext,
  AgentActionDefinition,
  AgentActionExecutionResult,
  AgentActionTarget,
} from "./types";
import { registerBuiltinAgentActions } from "./actions";

declare global {
  var __agentActionRegistry: Map<string, AgentActionDefinition<unknown, unknown>> | undefined;
  var __agentActionRegistryBuiltinsRegistered: boolean | undefined;
}

function getRegistryStore() {
  if (!globalThis.__agentActionRegistry) {
    globalThis.__agentActionRegistry = new Map<string, AgentActionDefinition<unknown, unknown>>();
  }
  return globalThis.__agentActionRegistry;
}

export function registerAgentAction<Input, Output>(action: AgentActionDefinition<Input, Output>) {
  const store = getRegistryStore();
  store.set(action.key, action as AgentActionDefinition<unknown, unknown>);
}

export function ensureBuiltinAgentActionsRegistered() {
  if (globalThis.__agentActionRegistryBuiltinsRegistered) return;
  registerBuiltinAgentActions();
  globalThis.__agentActionRegistryBuiltinsRegistered = true;
}

export function getAgentAction(key: string) {
  ensureBuiltinAgentActionsRegistered();
  return getRegistryStore().get(key);
}

export function listAgentActions() {
  ensureBuiltinAgentActionsRegistered();
  return Array.from(getRegistryStore().values()).sort((left, right) => left.key.localeCompare(right.key));
}

export async function listAvailableAgentActions(actor: ActorContext) {
  const actions = listAgentActions();
  const checks = await Promise.all(actions.map(async (action) => ({ action, available: await action.availability(actor) })));
  return checks.filter((item) => item.available).map((item) => item.action);
}

export async function executeAgentAction<Output>(
  actor: ActorContext,
  key: string,
  rawInput: unknown,
  opts: { allowConfirm?: boolean; proposalId?: string | null } = {},
): Promise<AgentActionExecutionResult<Output>> {
  const action = getAgentAction(key);
  if (!action) {
    throw new AgentActionNotFoundError(key);
  }

  const available = await action.availability(actor);
  if (!available) {
    throw new AgentActionForbiddenError();
  }

  if (action.riskLevel !== "safe" && !opts.allowConfirm) {
    throw new AgentActionConfirmationRequiredError();
  }

  const parsed = action.parseInput(rawInput);
  try {
    const result = await action.execute(actor, parsed) as Output;
    const target = action.resolveTarget
      ? await action.resolveTarget(parsed, result)
      : null;
    await createAgentActionLog(actor, action, {
      status: opts.allowConfirm ? "CONFIRMED_EXECUTED" : "EXECUTED",
      input: parsed,
      output: result,
      proposalId: opts.proposalId ?? null,
      target: target as AgentActionTarget | null,
    });
    return { action: action as AgentActionDefinition<unknown, Output>, result };
  } catch (error) {
    await createAgentActionLog(actor, action, {
      status: opts.allowConfirm ? "CONFIRMED_FAILED" : "FAILED",
      input: parsed,
      error: error instanceof Error ? error.message : "Action execution failed",
      proposalId: opts.proposalId ?? null,
    });
    throw error;
  }
}
