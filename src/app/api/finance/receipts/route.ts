import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked } from "@/lib/finance/permissions";
import { getOrderScopeWhere } from "@/lib/orders/permissions";
import { prisma } from "@/lib/prisma";

async function resolveOrderAndCheckScope(
  userId: string,
  role: string,
  orderId: string,
): Promise<{ valid: boolean; customerId: string | null }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, customerId: true },
  });
  if (!order) return { valid: false, customerId: null };

  if (role === "ADMIN") return { valid: true, customerId: order.customerId };

  const orderScope = await getOrderScopeWhere(userId, role);
  if (!orderScope) return { valid: false, customerId: null };
  const inScope = await prisma.order.count({ where: { id: orderId, AND: [orderScope] } });
  if (inScope === 0) return { valid: false, customerId: null };

  return { valid: true, customerId: order.customerId };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const orderId = url.searchParams.get("orderId")?.trim();
  const customerId = url.searchParams.get("customerId")?.trim();
  const projectId = url.searchParams.get("projectId")?.trim();
  const source = url.searchParams.get("source")?.trim();
  const dateFrom = url.searchParams.get("dateFrom")?.trim();
  const dateTo = url.searchParams.get("dateTo")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const includeDeleted = url.searchParams.get("includeDeleted") === "1" && session.user.role === "ADMIN";
  const deletedOnly = url.searchParams.get("deletedOnly") === "1" && session.user.role === "ADMIN";

  // If projectId is passed, resolve to order IDs via OrderProjectLink
  let resolvedOrderIds: string[] | null = null;
  if (projectId) {
    const links = await prisma.orderProjectLink.findMany({
      where: { projectId },
      select: { orderId: true },
    });
    resolvedOrderIds = links.map((l) => l.orderId);
    if (resolvedOrderIds.length === 0) {
      resolvedOrderIds = ["__NO_MATCH__"];
    }
  }

  if (session.user.role !== "ADMIN") {
    // Validate specific ID filters against scope
    if (orderId) {
      const { valid } = await resolveOrderAndCheckScope(session.user.id, session.user.role, orderId);
      if (!valid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const andConditions: Record<string, unknown>[] = [];
  // Filters for specific orders must cover both legacy 1-to-1 AND allocation-based
  // receipts (which have orderId=NULL but allocations.some.orderId = X).
  if (orderId) {
    andConditions.push({
      OR: [
        { orderId },
        { allocations: { some: { orderId } } },
      ],
    });
  }
  if (customerId) {
    andConditions.push({
      OR: [
        { customerId },
        { allocations: { some: { order: { customerId } } } },
      ],
    });
  }
  if (resolvedOrderIds) {
    andConditions.push({
      OR: [
        { orderId: { in: resolvedOrderIds } },
        { allocations: { some: { orderId: { in: resolvedOrderIds } } } },
      ],
    });
  }
  if (source) andConditions.push({ source });
  if (search) {
    andConditions.push({
      OR: [
        { customer: { name: { contains: search } } },
        { order: { orderNo: { contains: search } } },
        { order: { externalOrderNo: { contains: search } } },
      ],
    });
  }
  if (dateFrom || dateTo) {
    const receivedAtFilter: Record<string, Date> = {};
    if (dateFrom) receivedAtFilter.gte = new Date(dateFrom);
    if (dateTo) receivedAtFilter.lte = new Date(dateTo + "T23:59:59.999Z");
    andConditions.push({ receivedAt: receivedAtFilter });
  }

  // Non-ADMIN: scope by order visibility
  // Must cover both legacy 1-to-1 (receipt.orderId) and allocation-based
  // receipts (receipt.orderId=NULL but allocations.some.orderId in scope).
  if (session.user.role !== "ADMIN") {
    if (orderId) {
      // Specific orderId was already validated by resolveOrderAndCheckScope above
      andConditions.push({
        OR: [
          { orderId },
          { allocations: { some: { orderId } } },
        ],
      });
    } else {
      const orderScope = await getOrderScopeWhere(session.user.id, session.user.role);
      if (!orderScope) return NextResponse.json({ receipts: [], total: 0, page, pageSize });

      const scopedOrders = await prisma.order.findMany({
        where: orderScope,
        select: { id: true },
      });
      const scopedOrderIds = scopedOrders.map((o) => o.id);
      if (scopedOrderIds.length === 0) return NextResponse.json({ receipts: [], total: 0, page, pageSize });

      andConditions.push({
        OR: [
          { orderId: { in: scopedOrderIds } },
          { allocations: { some: { orderId: { in: scopedOrderIds } } } },
        ],
      });
    }
  }

  // Deletion filter: non-ADMIN always sees only non-deleted; ADMIN can toggle
  if (deletedOnly) {
    andConditions.push({ deleted: true });
  } else if (!includeDeleted) {
    andConditions.push({ deleted: false });
  }

  const where: Record<string, unknown> = andConditions.length === 1
    ? andConditions[0]
    : (andConditions.length > 0 ? { AND: andConditions } : {});

  const [receipts, total] = await Promise.all([
    prisma.financeReceipt.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        amount: true,
        receivedAt: true,
        source: true,
        remark: true,
        deleted: true,
        deletedAt: true,
        deletedById: true,
        deleteReason: true,
        customer: { select: { id: true, name: true } },
        order: { select: { id: true, orderNo: true, externalOrderNo: true } },
        createdBy: { select: { id: true, name: true } },
        allocations: { select: { id: true, invoiceId: true, amount: true } },
      },
    }),
    prisma.financeReceipt.count({ where }),
  ]);

  // Resolve deletedBy user names
  const deletedByIds = [...new Set(receipts.map((r) => r.deletedById).filter(Boolean))] as string[];
  const deletedByUsers = deletedByIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: deletedByIds } }, select: { id: true, name: true } })
    : [];
  const deletedByNameMap = new Map(deletedByUsers.map((u) => [u.id, u.name]));

  const result = receipts.map((r) => ({
    ...r,
    deletedByName: r.deletedById ? (deletedByNameMap.get(r.deletedById) || null) : null,
    allocationCount: r.allocations.length,
  }));

  return NextResponse.json({ receipts: result, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Intentionally audit-friendly: USER can create receipts, but only ADMIN can edit/delete later.
  if (session.user.role !== "ADMIN" && session.user.role !== "USER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    orderId,
    amount,
    receivedAt,
    source,
    remark,
    allocations,
    organizationId,
  } = body;

  // ─── Allocation branch (new: payment voucher matching) ───
  if (allocations && Array.isArray(allocations) && allocations.length > 0) {
    // §6.2: reject 1-to-1 fields when allocations present
    if (orderId) {
      return NextResponse.json({ error: "使用 allocations 时不能同时传 orderId" }, { status: 400 });
    }
    if (body.externalOrderInvoiceRequestId) {
      return NextResponse.json({ error: "使用 allocations 时不能同时传 externalOrderInvoiceRequestId" }, { status: 400 });
    }
    if (body.projectInvoiceId) {
      return NextResponse.json({ error: "使用 allocations 时不能同时传 projectInvoiceId" }, { status: 400 });
    }
    return handleAllocationReceipt(session.user.id, session.user.role, {
      amount,
      receivedAt,
      source,
      remark,
      organizationId,
      allocations,
      orderId,
    });
  }

  // ─── Legacy 1-to-1 branch (existing) ───
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "回款必须关联订单" }, { status: 400 });
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });
  }

  const { valid, customerId } = await resolveOrderAndCheckScope(session.user.id, session.user.role, orderId);
  if (!valid) return NextResponse.json({ error: "Forbidden: 订单不可见或不存在" }, { status: 403 });

  const receipt = await prisma.financeReceipt.create({
    data: {
      orderId,
      customerId,
      amount,
      receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
      source: source || "MANUAL",
      remark: remark?.trim() || null,
      createdById: session.user.id,
    },
    include: {
      customer: { select: { id: true, name: true } },
      order: { select: { id: true, orderNo: true } },
    },
  });

  return NextResponse.json({ receipt }, { status: 201 });
}

// ─── Allocation Receipt Handler ─────────────────────────────────

async function handleAllocationReceipt(
  userId: string,
  role: string,
  body: {
    amount?: number;
    receivedAt?: string;
    source?: string;
    remark?: string;
    organizationId?: string;
    allocations: Array<{ invoiceId: string; amount: number }>;
    orderId?: string;
  },
) {
  const { amount, receivedAt, source, remark, organizationId, allocations, orderId: bodyOrderId } = body;

  // Validate amount
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });
  }

  // Validate allocations array
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return NextResponse.json({ error: "allocations 不能为空" }, { status: 400 });
  }

  // §1.1 S2: organizationId is mandatory for allocation-based receipts
  if (!organizationId || typeof organizationId !== "string") {
    return NextResponse.json({ error: "凭证匹配必须提供 organizationId（付款机构）" }, { status: 400 });
  }

  // Validate the organization exists
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "付款机构不存在" }, { status: 400 });
  }

  // Validate each allocation entry
  for (const alloc of allocations) {
    if (!alloc.invoiceId || typeof alloc.invoiceId !== "string") {
      return NextResponse.json({ error: "每条 allocation 必须包含 invoiceId" }, { status: 400 });
    }
    if (!alloc.amount || typeof alloc.amount !== "number" || alloc.amount <= 0) {
      return NextResponse.json({ error: "每条 allocation 的 amount 必须大于 0" }, { status: 400 });
    }
  }

  // Fetch all invoices in one query
  const invoiceIds = allocations.map((a) => a.invoiceId);
  const invoices = await prisma.externalOrderInvoiceRequest.findMany({
    where: { id: { in: invoiceIds } },
    include: {
      orderCoverage: { select: { id: true } },
      adjustmentsAsOriginal: { select: { kind: true } },
    },
  });

  if (invoices.length !== invoiceIds.length) {
    const foundIds = new Set(invoices.map((i) => i.id));
    const missing = invoiceIds.filter((id) => !foundIds.has(id));
    return NextResponse.json({
      error: `发票不存在: ${missing.join(", ")}`,
    }, { status: 400 });
  }

  const invoiceMap = new Map(invoices.map((i) => [i.id, i]));

  // Validate each invoice
  for (const alloc of allocations) {
    const inv = invoiceMap.get(alloc.invoiceId)!;

    // Status must be ISSUED
    if (inv.status !== "ISSUED") {
      return NextResponse.json({
        error: `发票 ${inv.id} 状态不是 ISSUED（当前: ${inv.status}）`,
      }, { status: 400 });
    }

    // Must not be RED-adjusted
    const isRed = inv.adjustmentsAsOriginal?.some((a) => a.kind === "RED");
    if (isRed) {
      return NextResponse.json({
        error: `发票 ${inv.id} 已冲红`,
      }, { status: 400 });
    }

    // Phase 1: must have orderId and no coverage
    if (!inv.orderId) {
      return NextResponse.json({
        error: `发票 ${inv.id} 未关联订单（Phase 1 仅支持 direct-order 发票）`,
      }, { status: 400 });
    }
    if (inv.orderCoverage && inv.orderCoverage.length > 0) {
      return NextResponse.json({
        error: `发票 ${inv.id} 覆盖了多个订单（Phase 1 不支持 covered invoice）`,
      }, { status: 400 });
    }

    // Must have matching buyerOrganizationId (now mandatory, but keep defensive check)
    if (inv.buyerOrganizationId !== organizationId) {
      return NextResponse.json({
        error: `发票 ${inv.id} 的付款机构 (${inv.buyerOrganizationId || "未设置"}) 与凭证机构 (${organizationId}) 不一致`,
      }, { status: 400 });
    }
  }

  // ─── Object-level scope check ──────────────────────────────
  const orderIds = [...new Set(invoices.map((i) => i.orderId!).filter(Boolean))] as string[];
  if (role !== "ADMIN") {
    for (const oid of orderIds) {
      const { valid } = await resolveOrderAndCheckScope(userId, role, oid);
      if (!valid) {
        return NextResponse.json(
          { error: `Forbidden: 订单 ${oid} 不可见，无法对其发票创建回款` },
          { status: 403 },
        );
      }
    }
  }

  // Validate total allocation == receipt amount (per §1.1 S3)
  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(totalAllocated - amount) > 0.001) {
    return NextResponse.json({
      error: `分摊金额合计 (${totalAllocated}) 与凭证金额 (${amount}) 不一致`,
    }, { status: 400 });
  }

  // Build order breakdown and resolve customer (orderIds already computed for scope above)
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, customerId: true },
  });
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  // Resolve customer for receipt-level reference.
  // Cross-customer receipts are rejected: all invoices must belong to the same customer.
  // This prevents partial-scope visibility leaks where a user with access to only one
  // customer could see allocations belonging to another customer.
  const uniqueCustomerIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))];
  if (uniqueCustomerIds.length > 1) {
    return NextResponse.json({
      error: `凭证匹配不允许跨客户核销。以下发票属于不同客户: ${uniqueCustomerIds.join(", ")}`,
    }, { status: 400 });
  }
  const primaryCustomerId = uniqueCustomerIds[0] ?? null;

  // Build cross-order breakdown
  const orderBreakdown = new Map<string, number>();
  for (const alloc of allocations) {
    const inv = invoiceMap.get(alloc.invoiceId)!;
    const oid = inv.orderId!;
    orderBreakdown.set(oid, (orderBreakdown.get(oid) || 0) + alloc.amount);
  }

  const crossOrder = orderBreakdown.size > 1;

  try {
    // Single transaction: create receipt + N allocations
    const result = await prisma.$transaction(async (tx) => {
      // Within transaction, re-check outstanding for each invoice to prevent double-spend
      for (const alloc of allocations) {
        const inv = invoiceMap.get(alloc.invoiceId)!;

        // Sum existing allocations (new table)
        const existingAllocs = await tx.financeReceiptAllocation.findMany({
          where: {
            invoiceId: alloc.invoiceId,
            receipt: { deleted: false },
          },
          select: { amount: true },
        });
        const allocSum = existingAllocs.reduce((s, a) => s + a.amount, 0);

        // Sum legacy receipts
        const legacyReceipts = await tx.financeReceipt.findMany({
          where: {
            externalOrderInvoiceRequestId: alloc.invoiceId,
            deleted: false,
            allocations: { none: {} },
          },
          select: { amount: true },
        });
        const legacySum = legacyReceipts.reduce((s, r) => s + r.amount, 0);

        const totalOccupied = allocSum + legacySum;
        const outstanding = inv.totalAmount - totalOccupied;

        if (outstanding < alloc.amount - 0.001) {
          throw Object.assign(
            new Error(`发票 ${inv.id} 剩余可核销金额 (${outstanding.toFixed(2)}) 不足本次分摊 (${alloc.amount})`),
            { status: 409, body: { error: "CONCURRENT_OVERPAYMENT", invoiceId: alloc.invoiceId, outstanding, requested: alloc.amount } },
          );
        }
      }

      // Create receipt (1-to-1 fields NULL per §6.2)
      const receipt = await tx.financeReceipt.create({
        data: {
          amount,
          receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
          source: source || "BANK",
          remark: remark?.trim() || null,
          createdById: userId,
          customerId: primaryCustomerId,
          organizationId: organizationId || null,
          // 1-to-1 fields explicitly NULL
          orderId: null,
          externalOrderInvoiceRequestId: null,
          projectInvoiceId: null,
          externalOrderId: null,
          projectId: null,
        },
      });

      // Create allocations
      const createdAllocations = [];
      for (const alloc of allocations) {
        const inv = invoiceMap.get(alloc.invoiceId)!;
        const created = await tx.financeReceiptAllocation.create({
          data: {
            receiptId: receipt.id,
            invoiceId: alloc.invoiceId,
            orderId: inv.orderId,
            amount: alloc.amount,
            createdById: userId,
          },
        });
        createdAllocations.push(created);

        // Compute new outstanding
        const existingAllocs = await tx.financeReceiptAllocation.findMany({
          where: {
            invoiceId: alloc.invoiceId,
            receipt: { deleted: false },
          },
          select: { amount: true },
        });
        const allocSum = existingAllocs.reduce((s, a) => s + a.amount, 0);

        const legacyReceipts = await tx.financeReceipt.findMany({
          where: {
            externalOrderInvoiceRequestId: alloc.invoiceId,
            deleted: false,
            allocations: { none: {} },
          },
          select: { amount: true },
        });
        const legacySum = legacyReceipts.reduce((s, r) => s + r.amount, 0);

        const totalOccupied = allocSum + legacySum;
        const newOutstanding = Math.max(inv.totalAmount - totalOccupied, 0);

        createdAllocations[createdAllocations.length - 1] = {
          ...created,
          newOutstanding: Math.round(newOutstanding * 100) / 100,
        } as typeof created & { newOutstanding: number };
      }

      return { receipt, allocations: createdAllocations };
    });

    return NextResponse.json({
      receipt: {
        id: result.receipt.id,
        amount: result.receipt.amount,
        receivedAt: result.receipt.receivedAt.toISOString(),
        source: result.receipt.source,
      },
      allocations: result.allocations.map((a) => ({
        invoiceId: a.invoiceId,
        orderId: a.orderId,
        amount: a.amount,
        newOutstanding: (a as unknown as { newOutstanding: number }).newOutstanding,
      })),
      crossOrder,
      orderBreakdown: Array.from(orderBreakdown.entries()).map(([orderId, sum]) => ({
        orderId,
        sum: Math.round(sum * 100) / 100,
      })),
    }, { status: 201 });
  } catch (err: unknown) {
    const e = err as { status?: number; body?: unknown; message?: string };
    if (e.status === 409) {
      return NextResponse.json(e.body || { error: e.message }, { status: 409 });
    }
    throw err;
  }
}
