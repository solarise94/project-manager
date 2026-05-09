import { Prisma } from "@prisma/client";
import { resolveCustomerBusinessContext } from "@/lib/business/customer-context";

export class OrderProjectCustomerConflictError extends Error {
  constructor(
    public orderCustomerId: string,
    public projectCustomerId: string,
  ) {
    super("订单客户与项目客户不一致");
    this.name = "OrderProjectCustomerConflictError";
  }
}

type TransactionClient = Omit<Prisma.TransactionClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface LinkOptions {
  treatment?: string;
  allocatedAmount?: number | null;
  isPrimary?: boolean;
  note?: string | null;
}

export interface LinkResult {
  link: Awaited<ReturnType<TransactionClient["orderProjectLink"]["create"]>>;
  orderUpdateData?: Record<string, unknown>;
}

/**
 * Link an order to a project with customer conflict check and bidirectional CRM sync.
 *
 * Rules:
 * 1. Both have different customers → throw OrderProjectCustomerConflictError
 * 2. Order has customer, project doesn't → sync CRM (client, org, rep) to project
 * 3. Project has customer, order doesn't → sync CRM (buyer snapshots, rep, match status) to order
 */
export async function linkOrderToProject(
  tx: TransactionClient,
  orderId: string,
  projectId: string,
  userId: string,
  options: LinkOptions = {},
  existingOrderCustomer?: string | null,
): Promise<LinkResult> {
  const [orderCust, projectCust] = await Promise.all([
    existingOrderCustomer !== undefined
      ? { customerId: existingOrderCustomer }
      : tx.order.findUnique({ where: { id: orderId }, select: { customerId: true } }),
    tx.project.findUnique({ where: { id: projectId }, select: { customerId: true } }),
  ]);

  const oCustId = orderCust?.customerId || null;
  const pCustId = projectCust?.customerId || null;

  // Conflict: both have different customers
  if (oCustId && pCustId && oCustId !== pCustId) {
    throw new OrderProjectCustomerConflictError(oCustId, pCustId);
  }

  const result: LinkResult = { link: {} as LinkResult["link"] };

  // Sync CRM from order → project
  if (oCustId && !pCustId) {
    const ctx = await resolveCustomerBusinessContext(oCustId);
    await tx.project.update({
      where: { id: projectId },
      data: {
        customerId: oCustId,
        client: ctx.clientName,
        organization: ctx.organizationName,
        representativeId: ctx.representativeId,
        representative: ctx.representativeName,
      },
    });
  }

  // Sync CRM from project → order
  if (!oCustId && pCustId) {
    const ctx = await resolveCustomerBusinessContext(pCustId);
    result.orderUpdateData = {
      customerId: pCustId,
      buyerNameSnapshot: ctx.clientName,
      buyerOrgNameSnapshot: ctx.organizationName,
      representativeId: ctx.representativeId,
      customerMatchStatus: "MANUAL_MATCHED",
      customerMatchReason: "inherited_from_project_link",
    };
  }

  // Create the link with options
  result.link = await tx.orderProjectLink.create({
    data: {
      orderId,
      projectId,
      relationType: "LINKED",
      treatment: options.treatment || "PROJECT_INCLUDED",
      allocatedAmount: options.allocatedAmount ?? null,
      isPrimary: options.isPrimary === true,
      note: options.note?.trim() || null,
      createdById: userId,
    },
    include: {
      project: { select: { id: true, name: true, status: true } },
    },
  });

  return result;
}
