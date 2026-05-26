import type { Session } from "next-auth";
import { AgentActionForbiddenError } from "./errors";
import type { ActorContext } from "./types";

export function getActorContextFromSession(session: Session | null): ActorContext {
  if (!session?.user?.id || !session.user.role) {
    throw new AgentActionForbiddenError("Unauthorized");
  }

  return {
    userId: session.user.id,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
  };
}
