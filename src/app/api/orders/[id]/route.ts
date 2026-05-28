import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOrderAccessBlocked, getOrderScopeWhere } from "@/lib/orders/permissions";
import { ORDER_STATUS_TRANSITIONS, ORDER_DELIVERY_TRANSITIONS } from "@/lib/orders/constants";
import { resolveCustomerRepresentative } from "@/lib/crm/customer-owner-representative";
import { transitionCrmStage } from "@/lib/crm/lifecycle";
import { getInvoicesForOrder } from "@/lib/finance/order-invoices";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isOrderAccessBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, customerCode: true, organization: true, organizationId: true, org: { select: { canonicalName: true } }, crmProfile: { select: { sourceCustomerId: true } } } },
      representative: { select: { id: true, name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      sourceRecords: { orderBy: { createdAt: "desc" } },
      projectLinks: {
        include: {
          project: { select: { id: true, name: true, status: true } },
        },
      },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 50 },
      mergeSources: {
        include: { sourceOrder: { select: { id: true, orderNo: true } } },
      },
      mergeTargets: {
        include: { targetOrder: { select: { id: true, orderNo: true } } },
      },
      receipts: { where: { deleted: false }, select: { id: true, amount: true, receivedAt: true, source: true, remark: true, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      financeCosts: { select: { id: true, amount: true, costType: true, remark: true, createdAt: true }, take: 20, orderBy: { createdAt: "desc" } },
      _count: { select: { lines: true, sourceRecords: true, projectLinks: true, receipts: { where: { deleted: false } }, invoiceRequests: true, financeCosts: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.deleted && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Unified invoices (includes legacy direct + legacy coverage + new direct + new coverage)
  const unifiedInvoices = await getInvoicesForOrder(id);

  // Scope check for non-ADMIN
  if (session.user.role !== "ADMIN") {
    const scopeWhere = await getOrderScopeWhere(session.user.id, session.user.role);
    if (scopeWhere) {
      // Check if this order is inside the scope
      const inScope = await prisma.order.count({
        where: { id, deleted: false, AND: [scopeWhere] },
      });
      if (inScope === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  return NextResponse.json({ order, invoices: unifiedInvoices });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true, deliveryStatus: true, source: true, customerId: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const {
    title, description, category, status, deliveryStatus,
    orderedAt, confirmedAt, deliveredAt,
    customerId, customerMatchStatus, customerMatchScore, customerMatchReason,
    representativeId,
    financeAmountOverride, financeTreatment, financeNote,
    buyerNameSnapshot, buyerPhoneSnapshot, buyerWechatSnapshot, buyerOrgNameSnapshot, buyerAddressSnapshot,
    lines,
  } = body as Record<string, unknown>;

  const data: Record<string, unknown> = {};

  if (title !== undefined) data.title = String(title).trim();
  if (description !== undefined) data.description = (description as string)?.trim() || null;
  if (category !== undefined) data.category = category;
  if (status !== undefined) data.status = status;
  if (deliveryStatus !== undefined) data.deliveryStatus = deliveryStatus;
  if (orderedAt !== undefined) data.orderedAt = orderedAt ? new Date(orderedAt as string) : null;
  if (confirmedAt !== undefined) data.confirmedAt = confirmedAt ? new Date(confirmedAt as string) : null;
  if (deliveredAt !== undefined) data.deliveredAt = deliveredAt ? new Date(deliveredAt as string) : null;
  if (customerId !== undefined) data.customerId = (customerId as string) || null;
  if (customerMatchStatus !== undefined) data.customerMatchStatus = customerMatchStatus;
  if (customerMatchScore !== undefined) data.customerMatchScore = customerMatchScore;
  if (customerMatchReason !== undefined) data.customerMatchReason = (customerMatchReason as string) || null;
  // ── Resolve representative ──────────────────────────────────────────
  const customerTouched = customerId !== undefined;
  const normalizedCustomerId = customerTouched ? ((customerId as string) || null) : null;
  const effectiveCustomerId = customerTouched ? normalizedCustomerId : (existing.customerId ?? null);

  if (effectiveCustomerId) {
    // Customer exists — force CRM owner, ignore any passed representativeId
    const resolved = await resolveCustomerRepresentative(effectiveCustomerId);
    data.representativeId = resolved.representativeId;
  } else if (customerTouched) {
    // Customer explicitly cleared — clear representative too
    data.representativeId = null;
  } else if (representativeId !== undefined) {
    // No customer and customer not being changed — allow manual rep
    if (representativeId) {
      const rep = await prisma.representative.findUnique({ where: { id: representativeId as string } });
      if (!rep || rep.archived) {
        return NextResponse.json({ error: "指定的代表不存在" }, { status: 400 });
      }
      data.representativeId = rep.id;
    } else {
      data.representativeId = null;
    }
  }
  if (financeAmountOverride !== undefined) data.financeAmountOverride = financeAmountOverride === null ? null : Number(financeAmountOverride);
  if (financeTreatment !== undefined) data.financeTreatment = financeTreatment;
  if (financeNote !== undefined) data.financeNote = (financeNote as string)?.trim() || null;
  if (buyerNameSnapshot !== undefined) data.buyerNameSnapshot = (buyerNameSnapshot as string)?.trim() || null;
  if (buyerPhoneSnapshot !== undefined) data.buyerPhoneSnapshot = (buyerPhoneSnapshot as string)?.trim() || null;
  if (buyerWechatSnapshot !== undefined) data.buyerWechatSnapshot = (buyerWechatSnapshot as string)?.trim() || null;
  if (buyerOrgNameSnapshot !== undefined) data.buyerOrgNameSnapshot = (buyerOrgNameSnapshot as string)?.trim() || null;
  if (buyerAddressSnapshot !== undefined) data.buyerAddressSnapshot = (buyerAddressSnapshot as string)?.trim() || null;

  // ── Financial lock (unified, covers lines + standalone finance fields) ──
  const lineItems = Array.isArray(lines) ? lines as Array<Record<string, unknown>> : undefined;
  const touchesFinanceFields = lineItems !== undefined
    || financeAmountOverride !== undefined
    || financeTreatment !== undefined;

  let hasFinancialRecords = false;
  if (touchesFinanceFields) {
    const finCheck = await prisma.order.findUnique({
      where: { id },
      select: {
        _count: { select: { receipts: { where: { deleted: false } }, financeCosts: true } },
        invoiceRequests: { where: { status: { not: "CANCELLED" } }, select: { id: true }, take: 1 },
        invoiceCoverage: { where: { invoiceRequest: { status: { not: "CANCELLED" } } }, select: { id: true }, take: 1 },
      },
    });
    hasFinancialRecords = !!(finCheck && (
      finCheck._count.receipts > 0 ||
      finCheck._count.financeCosts > 0 ||
      finCheck.invoiceRequests.length > 0 ||
      finCheck.invoiceCoverage.length > 0
    ));
  }

  if (lineItems !== undefined) {
    if (existing.source !== "MANUAL") {
      return NextResponse.json({ error: "只能编辑手动创建的订单明细" }, { status: 400 });
    }
    if (hasFinancialRecords) {
      return NextResponse.json({ error: "该订单已有回款/发票/成本记录，无法修改明细" }, { status: 400 });
    }
  }

  if ((financeAmountOverride !== undefined || financeTreatment !== undefined) && hasFinancialRecords) {
    return NextResponse.json({ error: "该订单已有回款/发票/成本记录，无法修改金额相关字段" }, { status: 400 });
  }

  if (Object.keys(data).length === 0 && lineItems === undefined) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // ── Status / delivery status transition validation ─────────────────────
  if (status !== undefined && status !== existing.status) {
    const allowed = ORDER_STATUS_TRANSITIONS[existing.status as keyof typeof ORDER_STATUS_TRANSITIONS];
    if (!allowed || !allowed.includes(status as string)) {
      return NextResponse.json({ error: `无法从 ${existing.status} 转换为 ${status}` }, { status: 400 });
    }
  }
  if (deliveryStatus !== undefined && deliveryStatus !== existing.deliveryStatus) {
    const allowed = ORDER_DELIVERY_TRANSITIONS[existing.deliveryStatus as keyof typeof ORDER_DELIVERY_TRANSITIONS];
    if (!allowed || !allowed.includes(deliveryStatus as string)) {
      return NextResponse.json({ error: `无法从 ${existing.deliveryStatus} 转换为 ${deliveryStatus}` }, { status: 400 });
    }
  }

  // ── Execute update with optional line replacement ──────────────────────
  let updated: Awaited<ReturnType<typeof prisma.order.update>>;

  if (lineItems !== undefined) {
    const computedAmount = lineItems.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    data.totalAmount = computedAmount;

    updated = await prisma.$transaction(async (tx) => {
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      if (lineItems.length > 0) {
        await tx.orderLine.createMany({
          data: lineItems.map((l, i) => ({
            orderId: id,
            itemName: String(l.itemName).trim(),
            spec: (l.spec as string)?.trim() || null,
            unit: (l.unit as string)?.trim() || null,
            quantity: l.quantity != null ? Number(l.quantity) : null,
            unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
            amount: Number(l.amount) || 0,
            sortOrder: i,
          })),
        });
      }
      return tx.order.update({
        where: { id },
        data,
        include: {
          customer: { select: { id: true, name: true, customerCode: true } },
          representative: { select: { id: true, name: true } },
          lines: { orderBy: { sortOrder: "asc" } },
          projectLinks: { include: { project: { select: { id: true, name: true, status: true } } } },
        },
      });
    });
  } else {
    updated = await prisma.order.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        representative: { select: { id: true, name: true } },
        lines: { orderBy: { sortOrder: "asc" } },
        projectLinks: { include: { project: { select: { id: true, name: true, status: true } } } },
      },
    });
  }

  // ── Record status / delivery status history ────────────────────────────
  if (status !== undefined && status !== existing.status) {
    await prisma.orderStatusHistory.create({
      data: {
        orderId: id,
        oldStatus: existing.status,
        newStatus: status as string,
        createdById: session.user.id,
      },
    });
  }
  if (deliveryStatus !== undefined && deliveryStatus !== existing.deliveryStatus) {
    await prisma.orderStatusHistory.create({
      data: {
        orderId: id,
        oldDeliveryStatus: existing.deliveryStatus,
        newDeliveryStatus: deliveryStatus as string,
        createdById: session.user.id,
      },
    });
  }

  // ── CRM 阶段同步 ─────────────────────────────────────────────────────
  const syncCustomerIds = new Set<string>();
  if (existing.customerId) syncCustomerIds.add(existing.customerId);
  if (updated.customerId) syncCustomerIds.add(updated.customerId);

  // 订单状态变更驱动特定 CRM 事件
  if (status !== undefined && status !== existing.status) {
    const effectiveCustomerId = updated.customerId || existing.customerId;
    if (effectiveCustomerId) {
      const profile = await prisma.crmCustomerProfile.findUnique({
        where: { sourceCustomerId: effectiveCustomerId },
        select: { id: true },
      });
      if (profile) {
        if (status === "CONFIRMED") {
          await transitionCrmStage(profile.id, { type: "ORDER_CONFIRMED", orderId: id }).catch((err) => {
            console.error(`[CRM][ORDER] ORDER_CONFIRMED transition failed for ${profile.id}:`, err);
          });
        } else if (existing.status === "CONFIRMED") {
          await transitionCrmStage(profile.id, { type: "ORDER_CLOSED", orderId: id }).catch((err) => {
            console.error(`[CRM][ORDER] ORDER_CLOSED transition failed for ${profile.id}:`, err);
          });
        } else {
          // 其他状态变更兜底
          await transitionCrmStage(profile.id, { type: "DORMANT_SCAN" }).catch(() => {});
        }
      }
    }
  } else {
    // 非状态变更，对受影响客户兜底同步
    for (const customerId of syncCustomerIds) {
      const profile = await prisma.crmCustomerProfile.findUnique({
        where: { sourceCustomerId: customerId },
        select: { id: true },
      });
      if (profile) {
        await transitionCrmStage(profile.id, { type: "DORMANT_SCAN" }).catch(() => {});
      }
    }
  }

  return NextResponse.json({ order: updated });
}
