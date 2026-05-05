import { prisma } from "@/lib/prisma";

export const VALID_COST_TYPES = [
  "PROCUREMENT", "EXPERIMENT", "LABOR", "LOGISTICS",
  "PLATFORM", "MARKETING", "ENTERTAINMENT", "REFUND", "OTHER",
] as const;

export type CostType = (typeof VALID_COST_TYPES)[number];

export function isValidCostType(v: string): v is CostType {
  return VALID_COST_TYPES.includes(v as CostType);
}

/**
 * Validate and resolve cost entity references.
 * Ensures customer/order/project exist and are mutually consistent.
 */
export async function resolveAndValidateCostRefs(params: {
  customerId?: string | null;
  orderId?: string | null;
  projectId?: string | null;
}): Promise<{
  valid: boolean;
  error?: string;
  resolvedCustomerId: string | null;
  resolvedProjectId: string | null;
}> {
  const { customerId, orderId, projectId } = params;
  let resolvedCustomerId = customerId || null;
  let resolvedProjectId = projectId || null;

  // Validate order exists and resolve its customer/project
  if (orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deleted: false },
      select: {
        id: true,
        customerId: true,
        projectLinks: { select: { projectId: true } },
      },
    });
    if (!order) return { valid: false, error: `订单 ${orderId.slice(-6)} 不存在`, resolvedCustomerId: null, resolvedProjectId: null };

    // Resolve customer from order
    if (!resolvedCustomerId && order.customerId) resolvedCustomerId = order.customerId;
    if (resolvedCustomerId && order.customerId && order.customerId !== resolvedCustomerId) {
      return { valid: false, error: "订单客户与传入客户不一致", resolvedCustomerId: null, resolvedProjectId: null };
    }

    // Resolve project from order links
    if (!resolvedProjectId && order.projectLinks.length > 0) resolvedProjectId = order.projectLinks[0].projectId;
    if (resolvedProjectId && order.projectLinks.length > 0) {
      const belongs = order.projectLinks.some((l) => l.projectId === resolvedProjectId);
      if (!belongs) {
        return { valid: false, error: "传入项目不属于该订单的关联项目", resolvedCustomerId: null, resolvedProjectId: null };
      }
    }
  }

  // Validate project exists and resolve its customer
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId, deleted: false },
      select: { id: true, customerId: true },
    });
    if (!project) return { valid: false, error: `项目 ${projectId.slice(-6)} 不存在`, resolvedCustomerId: null, resolvedProjectId: null };

    if (!resolvedCustomerId && project.customerId) resolvedCustomerId = project.customerId;
    if (resolvedCustomerId && project.customerId && project.customerId !== resolvedCustomerId) {
      return { valid: false, error: "项目客户与传入客户不一致", resolvedCustomerId: null, resolvedProjectId: null };
    }
  }

  // Validate customer exists
  if (customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId, deleted: false },
      select: { id: true },
    });
    if (!customer) return { valid: false, error: `客户 ${customerId.slice(-6)} 不存在`, resolvedCustomerId: null, resolvedProjectId: null };
  }

  return { valid: true, resolvedCustomerId, resolvedProjectId };
}
