import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOrderAccessBlocked, getOrderScopeWhere } from "@/lib/orders/permissions";
import { resolveCustomerRepresentative } from "@/lib/crm/customer-owner-representative";
import { resolveCustomerBusinessContext } from "@/lib/business/customer-context";
import { generateProjectNo } from "@/lib/project-number";
import { linkOrderToProject, OrderProjectCustomerConflictError } from "@/lib/orders/link-project";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isOrderAccessBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const search = url.searchParams.get("search")?.trim() || "";
  const source = url.searchParams.get("source")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "";
  const deliveryStatus = url.searchParams.get("deliveryStatus")?.trim() || "";
  const category = url.searchParams.get("category")?.trim() || "";
  const customerMatchStatus = url.searchParams.get("customerMatchStatus")?.trim() || "";
  const financeTreatment = url.searchParams.get("financeTreatment")?.trim() || "";
  const customerId = url.searchParams.get("customerId")?.trim() || "";
  const projectId = url.searchParams.get("projectId")?.trim() || "";
  const representativeId = url.searchParams.get("representativeId")?.trim() || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const scopeWhere = await getOrderScopeWhere(session.user.id, session.user.role);

  const andConditions: Record<string, unknown>[] = [];

  if (scopeWhere) andConditions.push(scopeWhere);

  if (search) {
    andConditions.push({
      OR: [
        { orderNo: { contains: search } },
        { externalOrderNo: { contains: search } },
        { title: { contains: search } },
        { buyerNameSnapshot: { contains: search } },
        { buyerPhoneSnapshot: { contains: search } },
        { buyerOrgNameSnapshot: { contains: search } },
        { buyerAddressSnapshot: { contains: search } },
      ],
    });
  }

  const filters: Record<string, unknown> = {};
  if (source) filters.source = source;
  if (status) filters.status = status;
  if (deliveryStatus) filters.deliveryStatus = deliveryStatus;
  if (category) filters.category = category;
  if (customerMatchStatus) filters.customerMatchStatus = customerMatchStatus;
  if (financeTreatment) filters.financeTreatment = financeTreatment;
  if (customerId) filters.customerId = customerId;
  if (representativeId) filters.representativeId = representativeId;
  if (Object.keys(filters).length > 0) andConditions.push(filters);

  if (projectId) andConditions.push({ projectLinks: { some: { projectId } } });

  andConditions.push({ deleted: false });

  const where: Record<string, unknown> = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where, orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, orderNo: true, source: true, sourcePlatform: true, externalOrderNo: true,
        title: true, category: true, status: true, deliveryStatus: true,
        orderedAt: true, confirmedAt: true,
        customerId: true, customer: { select: { id: true, name: true, customerCode: true, crmProfile: { select: { sourceCustomerId: true } } } },
        buyerNameSnapshot: true, buyerPhoneSnapshot: true, buyerWechatSnapshot: true, buyerOrgNameSnapshot: true, buyerAddressSnapshot: true,
        customerMatchStatus: true, customerMatchScore: true, customerMatchReason: true,
        totalAmount: true, financeAmountOverride: true, financeTreatment: true, financeNote: true,
        ownerUserId: true, representativeId: true,
        representative: { select: { id: true, name: true } },
        createdById: true, createdAt: true, updatedAt: true,
        projectLinks: { select: { id: true, treatment: true, allocatedAmount: true, isPrimary: true, project: { select: { id: true, name: true } } } },
        mergeSources: { select: { targetOrderId: true } },
        invoiceRequests: { where: { status: { not: "CANCELLED" } }, select: { status: true } },
        invoiceCoverage: { where: { invoiceRequest: { status: { not: "CANCELLED" } } }, select: { invoiceRequest: { select: { status: true } } } },
        sourceRecords: { select: { duplicateStatus: true }, take: 1, orderBy: { createdAt: "desc" } },
        _count: { select: { lines: true, receipts: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    title, description, category, status, orderedAt,
    customerId, representativeId, lines, totalAmount,
    projectAction, projectId, financeTreatment, financeNote,
    buyerNameSnapshot, buyerPhoneSnapshot, buyerWechatSnapshot, buyerOrgNameSnapshot, buyerAddressSnapshot,
    projectDraft, initialCost, initialCostType, initialCostRemark,
  } = body as Record<string, unknown>;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const orderCategory = (typeof category === "string" && category) ? category : "SERVICE";
  const orderStatus = (typeof status === "string" && status) ? status : "DRAFT";

  const lineItems = Array.isArray(lines) ? lines.filter((l: Record<string, unknown>) => l.itemName?.toString().trim()) : [];
  const computedAmount = lineItems.length > 0
    ? lineItems.reduce((s: number, l: Record<string, unknown>) => s + (Number(l.amount) || 0), 0)
    : (Number(totalAmount) || 0);

  // When customerId is present, always derive representative from CRM owner.
  let finalRepresentativeId: string | null = null;
  if (customerId) {
    const resolved = await resolveCustomerRepresentative(customerId as string);
    finalRepresentativeId = resolved.representativeId;
  } else {
    finalRepresentativeId = (representativeId as string) || null;
  }

  const draft = (projectDraft as Record<string, unknown>) || {};
  const costAmount = initialCost != null ? Number(initialCost) : 0;
  const autoProjectNoInDraft = projectAction === "GENERATE" && !(draft.projectNo as string)?.trim();

  // GENERATE requires a customer — project creation depends on CRM context
  if (projectAction === "GENERATE" && !customerId) {
    return NextResponse.json({ error: "生成项目需要先选择或新建客户" }, { status: 400 });
  }

  // LINK requires a valid project — verify it exists before creating the order
  if (projectAction === "LINK") {
    if (!projectId) {
      return NextResponse.json({ error: "绑定已有项目需要提供项目ID" }, { status: 400 });
    }
    const linkTarget = await prisma.project.findUnique({ where: { id: projectId as string }, select: { id: true } });
    if (!linkTarget) {
      return NextResponse.json({ error: "指定的项目不存在" }, { status: 404 });
    }
  }

  // ── Transaction: order + project + cost — all-or-nothing ──
  // Retry up to 3 times on auto-generated orderNo/projectNo unique collision
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      order = await prisma.$transaction(async (tx) => {
        // Generate orderNo inside the transaction for concurrency safety
        const today = new Date();
        const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
        const lastOrder = await tx.order.findFirst({
          where: { orderNo: { startsWith: `SO-${dateStr}` } },
          orderBy: { orderNo: "desc" },
          select: { orderNo: true },
        });
        let seq = 1;
        if (lastOrder) {
          const parts = lastOrder.orderNo.split("-");
          seq = parseInt(parts[parts.length - 1] || "0", 10) + 1;
        }
        const orderNo = `SO-${dateStr}-${String(seq).padStart(4, "0")}`;

        const created = await tx.order.create({
          data: {
            orderNo,
        source: "MANUAL",
        title: title.trim(),
        description: (description as string)?.trim() || null,
        category: orderCategory,
        status: orderStatus,
        orderedAt: orderedAt ? new Date(orderedAt as string) : new Date(),
        confirmedAt: orderStatus === "CONFIRMED" ? new Date() : null,
        customerId: (customerId as string) || null,
        customerMatchStatus: customerId ? "MANUAL_MATCHED" : "UNMATCHED",
        customerMatchReason: customerId ? "created_with_customer" : null,
        representativeId: finalRepresentativeId,
        totalAmount: computedAmount,
        financeTreatment: (projectAction === "GENERATE" || projectAction === "LINK") ? "PROJECT_INCLUDED" : ((financeTreatment as string) || "AUTO"),
        financeNote: (financeNote as string)?.trim() || null,
        buyerNameSnapshot: (buyerNameSnapshot as string)?.trim() || null,
        buyerPhoneSnapshot: (buyerPhoneSnapshot as string)?.trim() || null,
        buyerWechatSnapshot: (buyerWechatSnapshot as string)?.trim() || null,
        buyerOrgNameSnapshot: (buyerOrgNameSnapshot as string)?.trim() || null,
        buyerAddressSnapshot: (buyerAddressSnapshot as string)?.trim() || null,
        createdById: session.user.id,
        lines: lineItems.length > 0 ? {
          create: lineItems.map((l: Record<string, unknown>, i: number) => ({
            itemName: String(l.itemName).trim(),
            spec: l.spec?.toString().trim() || null,
            unit: l.unit?.toString().trim() || null,
            quantity: l.quantity != null ? Number(l.quantity) : null,
            unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
            amount: Number(l.amount) || 0,
            category: orderCategory,
            sortOrder: i,
          })),
        } : undefined,
      },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        customer: { select: { id: true, name: true } },
      },
    });

        let effectiveOrderCustomerId = created.customerId;

    // ── Project generation ──────────────────────────────────────────
    if (projectAction === "GENERATE" && customerId) {
      const ctx = await resolveCustomerBusinessContext(customerId as string);
      const newProjectNo = await generateProjectNo(tx);
      const pStartDate = (draft.startDate as string) || new Date().toISOString().slice(0, 10);
      const pBudgetCost = draft.budgetCost != null ? Number(draft.budgetCost) : null;

      // Derive project fields from order — backend兜底, doesn't fully trust frontend
      const firstLine = created.lines?.[0];
      const derivedFromLine = firstLine
        ? [firstLine.itemName, firstLine.spec].filter(Boolean).join(" / ")
        : null;
      const derivedProjectContent =
        (draft.projectContent as string)?.trim() ||
        derivedFromLine ||
        title.trim();
      const derivedProjectType =
        (draft.projectType as string)?.trim() ||
        (orderCategory === "PRODUCT" ? "商品" : "服务");
      const derivedQuantity =
        draft.quantity != null && draft.quantity !== ""
          ? Number(draft.quantity)
          : firstLine?.quantity ?? null;

      const project = await tx.project.create({
        data: {
          projectNo: newProjectNo,
          orderNumber: orderNo,
          name: title.trim(),
          description: (description as string)?.trim() || null,
          customerId: customerId as string,
          client: ctx.clientName,
          organization: ctx.organizationName,
          representativeId: ctx.representativeId,
          representative: ctx.representativeName,
          projectType: derivedProjectType,
          projectContent: derivedProjectContent,
          quantity: derivedQuantity,
          procurementSource: (draft.procurementSource as string) || null,
          brand: (draft.brand as string) || null,
          techSupport: (draft.techSupport as string) || null,
          budgetAmount: computedAmount,
          budgetCost: pBudgetCost,
          startDate: new Date(pStartDate),
          status: "NOT_STARTED",
          members: {
            create: { userId: session.user.id, role: "OWNER" },
          },
        },
      });

      await tx.orderProjectLink.create({
        data: {
          orderId: created.id,
          projectId: project.id,
          relationType: "GENERATED",
          treatment: "PROJECT_INCLUDED",
          isPrimary: true,
          createdById: session.user.id,
        },
      });

      await tx.activityLog.create({
        data: {
          type: "PROJECT_CREATED",
          content: `通过订单 ${orderNo} 生成了项目 "${project.name}"`,
          projectId: project.id,
          userId: session.user.id,
        },
      });

      if (pBudgetCost) {
        const { syncProjectBudgetCost } = await import("@/lib/finance/ledger");
        await syncProjectBudgetCost(project.id, pBudgetCost, session.user.id, tx as Parameters<typeof syncProjectBudgetCost>[3]);
      }
    }

    // ── Project linking ─────────────────────────────────────────────
    if (projectAction === "LINK" && projectId) {
      const linkResult = await linkOrderToProject(
        tx, created.id, projectId as string,
        session.user.id,
        { treatment: "PROJECT_INCLUDED", isPrimary: true },
        created.customerId,
      );
      if (linkResult.orderUpdateData) {
        await tx.order.update({
          where: { id: created.id },
          data: linkResult.orderUpdateData,
        });
        const inheritedCustomerId =
          typeof linkResult.orderUpdateData.customerId === "string"
            ? linkResult.orderUpdateData.customerId
            : null;
        if (inheritedCustomerId) {
          effectiveOrderCustomerId = inheritedCustomerId;
        }
      }
    }

    // ── Order-level initial cost ────────────────────────────────────
    if (costAmount > 0) {
      await tx.financeCost.create({
        data: {
          orderId: created.id,
          customerId: effectiveOrderCustomerId,
          amount: costAmount,
          costType: (initialCostType as string) || "OTHER",
          remark: (initialCostRemark as string)?.trim() || null,
          sourceType: "ORDER_INITIAL_COST",
          sourceKey: `order-initial-cost:${created.id}`,
          createdById: session.user.id,
        },
      });
    }

    return created;
  });
      break;
    } catch (err) {
      if (err instanceof OrderProjectCustomerConflictError) {
        return NextResponse.json({
          error: "订单客户与项目客户不一致",
          orderCustomerId: err.orderCustomerId,
          projectCustomerId: err.projectCustomerId,
        }, { status: 409 });
      }
      const isP2002 = typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
      const target = Array.isArray(((err as { meta?: { target?: unknown } }).meta?.target)) ? ((err as { meta?: { target?: string[] } }).meta?.target || []) : [];
      // Retry auto-generated orderNo collisions (always auto) and auto-generated projectNo collisions
      const canRetry = isP2002 && attempt < 2 && (
        target.includes("orderNo") ||
        (autoProjectNoInDraft && target.includes("projectNo"))
      );
      if (canRetry) continue;
      if (isP2002 && target.includes("orderNo")) return NextResponse.json({ error: "订单号冲突，请重试" }, { status: 409 });
      if (isP2002 && target.includes("projectNo")) return NextResponse.json({ error: "项目号已被使用" }, { status: 409 });
      throw err;
    }
  }

  return NextResponse.json({ order }, { status: 201 });
}
