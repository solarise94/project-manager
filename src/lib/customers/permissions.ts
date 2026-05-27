import { prisma } from "@/lib/prisma";

export type AssertResult = { ok: true } | { ok: false; status: 404 | 403; message: string };

export async function assertCustomerEditable(
  customerId: string,
  userId: string,
  role: string,
): Promise<AssertResult> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, deleted: true },
  });

  if (!customer || customer.deleted) {
    return { ok: false, status: 404, message: "客户不存在" };
  }

  if (role === "ADMIN" || role === "USER") {
    return { ok: true };
  }

  if (role === "REPRESENTATIVE") {
    // Note: Customer master data editing is intentionally restricted to
    // explicitly-assigned customers only. Fallback-bound (SITE_BINDING /
    // ORG_BINDING) customers are visible/operable in CRM but their master
    // data cannot be edited by the representative. This prevents organization
    // bindings from silently expanding write permissions beyond CRM scope.
    const profile = await prisma.crmCustomerProfile.findUnique({
      where: { sourceCustomerId: customerId },
      select: { ownerUserId: true, assignmentStatus: true },
    });
    if (!profile || profile.ownerUserId !== userId || profile.assignmentStatus !== "ASSIGNED") {
      return { ok: false, status: 403, message: "只能编辑自己负责的客户" };
    }
    return { ok: true };
  }

  if (role === "REGIONAL_MANAGER") {
    return { ok: false, status: 403, message: "地区经理暂不支持编辑客户主数据" };
  }

  return { ok: false, status: 403, message: "Forbidden" };
}
