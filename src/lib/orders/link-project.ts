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

export interface RepAssignedSnapshot {
  projectId: string;
  projectName: string;
  representativeId: string;
  representativeName: string;
  representativeEmail: string;
}

export interface LinkResult {
  link: Awaited<ReturnType<TransactionClient["orderProjectLink"]["create"]>>;
  orderUpdateData?: Record<string, unknown>;
  projectUpdateData?: Record<string, unknown>;
  /** snapshot of the representative newly/changed assigned to the project during this link */
  repAssignedToProject: RepAssignedSnapshot | null;
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
  const [orderInfo, projectInfo] = await Promise.all([
    tx.order.findUnique({
      where: { id: orderId },
      select: {
        customerId: true,
        orderNo: true,
        totalAmount: true,
        financeAmountOverride: true,
      },
    }),
    tx.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        customerId: true,
        representativeId: true,
        orderNumber: true,
        budgetAmount: true,
        budgetAmountSource: true,
        budgetCost: true,
      },
    }),
  ]);

  const oCustId = existingOrderCustomer !== undefined ? existingOrderCustomer : (orderInfo?.customerId || null);
  const pCustId = projectInfo?.customerId || null;

  // Conflict: both have different customers
  if (oCustId && pCustId && oCustId !== pCustId) {
    throw new OrderProjectCustomerConflictError(oCustId, pCustId);
  }

  const result: LinkResult = { link: {} as LinkResult["link"], repAssignedToProject: null };

  // Sync CRM from order → project
  if (oCustId && !pCustId) {
    const ctx = await resolveCustomerBusinessContext(oCustId);
    const prevRepId = projectInfo?.representativeId || null;
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
    if (ctx.representativeId && ctx.representativeId !== prevRepId) {
      const rep = await tx.representative.findUnique({
        where: { id: ctx.representativeId, archived: false },
        select: { id: true, name: true, email: true },
      });
      if (rep) {
        result.repAssignedToProject = {
          projectId,
          projectName: projectInfo!.name,
          representativeId: rep.id,
          representativeName: rep.name,
          representativeEmail: rep.email,
        };
      }
    }
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

  // Backfill project fields from order (only if project doesn't already have them)
  if (orderInfo) {
    const projectUpdates: Record<string, unknown> = {};
    // orderNumber is a cross-reference — always backfill if missing
    if (!projectInfo?.orderNumber && orderInfo.orderNo) {
      projectUpdates.orderNumber = orderInfo.orderNo;
    }
    // budgetAmount only backfills for PROJECT_INCLUDED, and only when the project
    // has no manually-set amount (both budgetAmount AND budgetAmountSource are null).
    // Once a project has MANUAL budget, link mutations never overwrite it.
    const treatment = options.treatment || "PROJECT_INCLUDED";
    if (
      treatment === "PROJECT_INCLUDED" &&
      projectInfo?.budgetAmount == null &&
      projectInfo?.budgetAmountSource == null
    ) {
      const orderAmount = orderInfo.financeAmountOverride ?? orderInfo.totalAmount;
      const effectiveAmount = options.allocatedAmount ?? orderAmount;
      if (effectiveAmount != null) {
        projectUpdates.budgetAmount = effectiveAmount;
        projectUpdates.budgetAmountSource = "ORDER_LINK";
      }
    }
    if (Object.keys(projectUpdates).length > 0) {
      await tx.project.update({ where: { id: projectId }, data: projectUpdates });
      result.projectUpdateData = projectUpdates;
    }
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
