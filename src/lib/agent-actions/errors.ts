export class AgentActionError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "AGENT_ACTION_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class AgentActionInputError extends AgentActionError {
  constructor(message: string) {
    super(message, 400, "INVALID_ACTION_INPUT");
  }
}

export class AgentActionForbiddenError extends AgentActionError {
  constructor(message = "Forbidden") {
    super(message, 403, "ACTION_FORBIDDEN");
  }
}

export class AgentActionNotFoundError extends AgentActionError {
  constructor(key: string) {
    super(`Unknown action: ${key}`, 404, "ACTION_NOT_FOUND");
  }
}

export class AgentActionConfirmationRequiredError extends AgentActionError {
  constructor(message = "Action requires confirmation") {
    super(message, 409, "ACTION_CONFIRMATION_REQUIRED");
  }
}
