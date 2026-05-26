import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActorContextFromSession } from "@/lib/agent-actions/actor";
import { AgentActionForbiddenError, AgentActionInputError, AgentActionNotFoundError } from "@/lib/agent-actions/errors";
import { prisma } from "@/lib/prisma";
import { assertCrmProfileAccessByCustomerId } from "@/lib/crm/permissions";
import { canReadFinance } from "@/lib/finance/permissions";
import { canReadProject } from "@/lib/permissions";
import type { AgentViewIntent } from "@/lib/agent-runtime/types";
import { getOrderScopeWhere, isOrderAccessBlocked } from "@/lib/orders/permissions";

const NAV_ROUTE_ALLOWLIST = [
  /^\/agent$/,
  /^\/projects$/,
  /^\/orders$/,
  /^\/crm\/customers$/,
  /^\/crm\/follow-ups$/,
  /^\/finance\/invoices$/,
  /^\/tickets$/,
] as const;

const PANEL_ALLOWLIST = new Set(["proposal", "memory", "proactive", "history", "timeline"]);
const FILTER_ALLOWLIST = new Set([
  "status",
  "source",
  "projectId",
  "customerId",
  "orderId",
  "stage",
  "importance",
  "ownerUserId",
  "tab",
  "hasRedAdjustment",
]);

function parseIntent(body: unknown): AgentViewIntent {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AgentActionInputError("intent is required");
  }

  const raw = "intent" in body ? (body as { intent?: unknown }).intent : body;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgentActionInputError("intent must be an object");
  }

  const intent = raw as Record<string, unknown>;
  const type = typeof intent.type === "string" ? intent.type : "";
  const label = typeof intent.label === "string" ? intent.label.trim() : "";
  if (!type || !label) {
    throw new AgentActionInputError("intent.type and intent.label are required");
  }

  return {
    type: type as AgentViewIntent["type"],
    route: typeof intent.route === "string" ? intent.route.trim() : undefined,
    entityType: typeof intent.entityType === "string" ? intent.entityType as AgentViewIntent["entityType"] : undefined,
    entityId: typeof intent.entityId === "string" ? intent.entityId.trim() : undefined,
    panel: typeof intent.panel === "string" ? intent.panel.trim() : undefined,
    filters: intent.filters && typeof intent.filters === "object" && !Array.isArray(intent.filters)
      ? intent.filters as Record<string, string | number | boolean | null>
      : undefined,
    label,
    reason: typeof intent.reason === "string" ? intent.reason.trim() : undefined,
  };
}

function assertAllowedNavigateRoute(route: string) {
  if (!NAV_ROUTE_ALLOWLIST.some((pattern) => pattern.test(route))) {
    throw new AgentActionForbiddenError("Route is not allowed for view intent");
  }
}

async function resolveProjectRoute(userId: string, role: string, entityId: string) {
  const readable = await canReadProject(entityId, userId, role);
  if (!readable) {
    throw new AgentActionForbiddenError("Project is not readable");
  }
  return `/projects/${entityId}`;
}

async function resolveOrderRoute(userId: string, role: string, entityId: string) {
  if (isOrderAccessBlocked(role)) {
    throw new AgentActionForbiddenError("Order access is blocked");
  }

  const scopeWhere = await getOrderScopeWhere(userId, role);
  const order = await prisma.order.findFirst({
    where: {
      AND: [
        scopeWhere ?? {},
        { id: entityId, deleted: false },
      ],
    },
    select: { id: true },
  });
  if (!order) {
    throw new AgentActionNotFoundError(entityId);
  }
  return `/orders/${entityId}`;
}

async function resolveCustomerRoute(userId: string, role: string, entityId: string) {
  await assertCrmProfileAccessByCustomerId(entityId, userId, role);
  return `/crm/customers/${entityId}`;
}

async function resolveTicketRoute(userId: string, role: string, entityId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: entityId },
    select: { id: true, projectId: true },
  });
  if (!ticket) {
    throw new AgentActionNotFoundError(entityId);
  }

  const readable = await canReadProject(ticket.projectId, userId, role);
  if (!readable) {
    throw new AgentActionForbiddenError("Ticket is not readable");
  }
  return `/tickets?ticketId=${ticket.id}`;
}

async function resolveInvoiceRoute(role: string, entityId: string) {
  if (!canReadFinance(role)) {
    throw new AgentActionForbiddenError("Invoice is not readable");
  }

  const [projectInvoice, orderInvoice] = await Promise.all([
    prisma.projectInvoice.findUnique({
      where: { id: entityId },
      select: { id: true },
    }),
    prisma.externalOrderInvoiceRequest.findUnique({
      where: { id: entityId },
      select: { id: true },
    }),
  ]);

  if (!projectInvoice && !orderInvoice) {
    throw new AgentActionNotFoundError(entityId);
  }

  return `/finance/invoices?invoiceId=${entityId}`;
}

async function resolveEntityRoute(
  userId: string,
  role: string,
  entityType: NonNullable<AgentViewIntent["entityType"]>,
  entityId: string,
) {
  if (entityType === "project") return resolveProjectRoute(userId, role, entityId);
  if (entityType === "order") return resolveOrderRoute(userId, role, entityId);
  if (entityType === "customer") return resolveCustomerRoute(userId, role, entityId);
  if (entityType === "ticket") return resolveTicketRoute(userId, role, entityId);
  if (entityType === "invoice") return resolveInvoiceRoute(role, entityId);
  throw new AgentActionForbiddenError("Entity type is not allowed");
}

function buildFilterSearchParams(filters: Record<string, string | number | boolean | null>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!FILTER_ALLOWLIST.has(key)) {
      throw new AgentActionForbiddenError(`Filter ${key} is not allowed`);
    }
    if (value !== null) {
      searchParams.set(key, String(value));
    }
  }
  return searchParams;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const intent = parseIntent(body);
    const actor = getActorContextFromSession(session);

    if (intent.type === "navigate") {
      const route = intent.route?.trim();
      if (!route) {
        throw new AgentActionInputError("route is required for navigate intent");
      }
      assertAllowedNavigateRoute(route);
      return NextResponse.json({
        ok: true,
        applied: {
          route,
          label: intent.label,
          mode: "navigate",
        },
      });
    }

    if (intent.type === "focus_entity") {
      if (!intent.entityType || !intent.entityId) {
        throw new AgentActionInputError("entityType and entityId are required for focus_entity");
      }
      const route = await resolveEntityRoute(actor.userId, actor.role, intent.entityType, intent.entityId);
      return NextResponse.json({
        ok: true,
        applied: {
          route,
          label: intent.label,
          mode: "navigate",
        },
      });
    }

    if (intent.type === "set_filter") {
      const route = intent.route?.trim();
      if (!route) {
        throw new AgentActionInputError("route is required for set_filter");
      }
      assertAllowedNavigateRoute(route);
      const searchParams = buildFilterSearchParams(intent.filters ?? {});
      return NextResponse.json({
        ok: true,
        applied: {
          route,
          searchParams: Object.fromEntries(searchParams.entries()),
          label: intent.label,
          mode: "navigate",
        },
      });
    }

    if (intent.type === "open_panel") {
      const panel = intent.panel?.trim();
      if (!panel || !PANEL_ALLOWLIST.has(panel)) {
        throw new AgentActionForbiddenError("Panel is not allowed");
      }
      return NextResponse.json({
        ok: true,
        applied: {
          panel,
          label: intent.label,
          mode: "panel",
        },
      });
    }

    throw new AgentActionForbiddenError("Unsupported view intent");
  } catch (error) {
    if (error instanceof AgentActionInputError || error instanceof AgentActionForbiddenError || error instanceof AgentActionNotFoundError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("agent view intent apply failed:", error);
    return NextResponse.json({ error: "Failed to apply agent view intent" }, { status: 500 });
  }
}
