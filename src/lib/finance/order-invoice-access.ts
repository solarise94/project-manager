import { prisma } from "@/lib/prisma";
import { getOrderScopeWhere } from "@/lib/orders/permissions";

/**
 * Resolve all Order IDs that an invoice touches, including:
 * - direct orderId
 * - orderCoverage orderIds
 * - legacy externalOrderId (resolved back to Order.id)
 * - legacy coverage externalOrderIds (resolved back to Order.id)
 *
 * Returns de-duplicated order ids. May return empty array for orphan invoices.
 */
export async function resolveInvoiceTouchedOrderIds(invoiceId: string): Promise<string[]> {
  const invoice = await prisma.externalOrderInvoiceRequest.findUnique({
    where: { id: invoiceId },
    select: {
      orderId: true,
      externalOrderId: true,
      orderCoverage: { select: { orderId: true } },
      coverage: { select: { externalOrderId: true } },
    },
  });

  if (!invoice) return [];

  const touchedOrderIds: string[] = [
    ...(invoice.orderId ? [invoice.orderId] : []),
    ...invoice.orderCoverage.map((c) => c.orderId),
  ];

  const legacyExtIds = [
    ...(invoice.externalOrderId ? [invoice.externalOrderId] : []),
    ...invoice.coverage.map((c) => c.externalOrderId).filter((id): id is string => !!id),
  ];

  if (legacyExtIds.length > 0) {
    const legacyOrders = await prisma.order.findMany({
      where: { legacyExternalOrderId: { in: legacyExtIds } },
      select: { id: true },
    });
    for (const lo of legacyOrders) touchedOrderIds.push(lo.id);
  }

  return [...new Set(touchedOrderIds)];
}

/**
 * Assert the user can read the given order invoice.
 * Throws a Response-like error object for early return in route handlers.
 *
 * Returns normally if readable. Throws { status, body } if not.
 */
export async function assertOrderInvoiceReadable(
  invoiceId: string,
  userId: string,
  role: string,
): Promise<void> {
  if (role === "ADMIN") return;

  const orderScope = await getOrderScopeWhere(userId, role);
  const touchedOrderIds = await resolveInvoiceTouchedOrderIds(invoiceId);

  if (touchedOrderIds.length === 0) {
    throw { status: 403, body: { error: "Forbidden" } };
  }

  if (orderScope) {
    const scopedCount = await prisma.order.count({
      where: { AND: [{ id: { in: touchedOrderIds } }, orderScope] },
    });
    if (scopedCount === 0) {
      throw { status: 403, body: { error: "Forbidden" } };
    }
  }
}
