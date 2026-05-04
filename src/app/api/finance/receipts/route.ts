import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { prisma } from "@/lib/prisma";

async function resolveAndValidate(
  userId: string,
  role: string,
  customerId?: string | null,
  projectId?: string | null,
  externalOrderId?: string | null,
  projectInvoiceId?: string | null,
  externalOrderInvoiceRequestId?: string | null,
  source?: string,
): Promise<{ valid: boolean; resolvedCustomerId: string | null; resolvedProjectId: string | null }> {
  let resolvedCustId = customerId || null;
  let resolvedProjId = projectId || null;

  // --- Phase 1: Resolve all entity references (always, including ADMIN) ---

  if (externalOrderId) {
    const eo = await prisma.externalOrder.findUnique({
      where: { id: externalOrderId },
      select: { customerId: true, projectId: true },
    });
    if (!eo) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    if (!resolvedCustId && eo.customerId) resolvedCustId = eo.customerId;
    if (!resolvedProjId && eo.projectId) resolvedProjId = eo.projectId;
    if (customerId && eo.customerId && eo.customerId !== customerId) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    if (projectId && eo.projectId && eo.projectId !== projectId) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  }

  if (projectInvoiceId) {
    const inv = await prisma.projectInvoice.findUnique({
      where: { id: projectInvoiceId },
      select: { projectId: true, project: { select: { customerId: true } } },
    });
    if (!inv) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    if (!resolvedProjId) resolvedProjId = inv.projectId;
    if (!resolvedCustId && inv.project.customerId) resolvedCustId = inv.project.customerId;
    if (projectId && inv.projectId !== projectId) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    if (customerId && inv.project.customerId && inv.project.customerId !== customerId) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  }

  if (externalOrderInvoiceRequestId) {
    const eoi = await prisma.externalOrderInvoiceRequest.findUnique({
      where: { id: externalOrderInvoiceRequestId },
      select: { externalOrder: { select: { customerId: true, projectId: true } } },
    });
    if (!eoi) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    if (!resolvedCustId && eoi.externalOrder.customerId) resolvedCustId = eoi.externalOrder.customerId;
    if (!resolvedProjId && eoi.externalOrder.projectId) resolvedProjId = eoi.externalOrder.projectId;
    if (customerId && eoi.externalOrder.customerId && eoi.externalOrder.customerId !== customerId) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  }

  if (!resolvedCustId && resolvedProjId) {
    const proj = await prisma.project.findUnique({
      where: { id: resolvedProjId },
      select: { customerId: true },
    });
    if (proj?.customerId) resolvedCustId = proj.customerId;
  }

  // Cross-validate: if both customerId and projectId are resolved, they must be consistent
  if (resolvedCustId && resolvedProjId) {
    const proj = await prisma.project.findUnique({
      where: { id: resolvedProjId },
      select: { customerId: true },
    });
    if (proj?.customerId && proj.customerId !== resolvedCustId) {
      return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    }
  }

  // PINGOODMICE_ORDER receipts require a resolved customer
  if (source === "PINGOODMICE_ORDER" && !resolvedCustId) {
    return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  }

  // --- Phase 2: Scope validation (non-ADMIN only) ---

  if (role === "ADMIN") return { valid: true, resolvedCustomerId: resolvedCustId, resolvedProjectId: resolvedProjId };

  const [custScope, projScope] = await Promise.all([
    getFinanceCustomerScopeWhere(userId, role),
    getFinanceProjectScopeWhere(userId, role),
  ]);

  if (resolvedCustId && custScope && !custScope.id.in.includes(resolvedCustId)) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  if (resolvedProjId && projScope && !projScope.id.in.includes(resolvedProjId)) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  if (!resolvedCustId && !resolvedProjId && custScope) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };

  return { valid: true, resolvedCustomerId: resolvedCustId, resolvedProjectId: resolvedProjId };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const customerId = url.searchParams.get("customerId")?.trim();
  const projectId = url.searchParams.get("projectId")?.trim();
  const source = url.searchParams.get("source")?.trim();
  const dateFrom = url.searchParams.get("dateFrom")?.trim();
  const dateTo = url.searchParams.get("dateTo")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  if (session.user.role !== "ADMIN") {
    const [custScope, projScopePre] = await Promise.all([
      getFinanceCustomerScopeWhere(session.user.id, session.user.role),
      getFinanceProjectScopeWhere(session.user.id, session.user.role),
    ]);
    if (custScope && customerId && !custScope.id.in.includes(customerId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (projScopePre && projectId && !projScopePre.id.in.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (projectId) where.projectId = projectId;
  if (source) where.source = source;
  if (search) {
    where.OR = [
      { customer: { name: { contains: search } } },
      { project: { name: { contains: search } } },
      { externalOrder: { externalOrderNo: { contains: search } } },
    ];
  }
  if (dateFrom || dateTo) {
    const receivedAtFilter: Record<string, Date> = {};
    if (dateFrom) receivedAtFilter.gte = new Date(dateFrom);
    if (dateTo) receivedAtFilter.lte = new Date(dateTo + "T23:59:59.999Z");
    where.receivedAt = receivedAtFilter;
  }

  if (session.user.role !== "ADMIN") {
    const [custScope, projScope] = await Promise.all([
      getFinanceCustomerScopeWhere(session.user.id, session.user.role),
      getFinanceProjectScopeWhere(session.user.id, session.user.role),
    ]);
    const orConditions: Record<string, unknown>[] = [];
    if (custScope) orConditions.push({ customerId: { in: custScope.id.in } });
    if (projScope) orConditions.push({ projectId: { in: projScope.id.in } });
    if (orConditions.length > 0) {
      // Merge with existing OR from search, if any
      if (where.OR) {
        where.AND = [{ OR: orConditions }, { OR: where.OR }];
        delete where.OR;
      } else {
        where.OR = orConditions;
      }
    }
  }

  const [receipts, total] = await Promise.all([
    prisma.financeReceipt.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        externalOrder: { select: { id: true, externalOrderNo: true } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
    prisma.financeReceipt.count({ where }),
  ]);

  return NextResponse.json({ receipts, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { customerId, projectId, externalOrderId, projectInvoiceId, externalOrderInvoiceRequestId, amount, receivedAt, source, remark } = body;

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const scopeCheck = await resolveAndValidate(
    session.user.id, session.user.role,
    customerId, projectId,
    externalOrderId, projectInvoiceId, externalOrderInvoiceRequestId,
    source,
  );
  if (!scopeCheck.valid) {
    return NextResponse.json({ error: "Forbidden: entity outside your scope or inconsistent references" }, { status: 403 });
  }

  const effectiveCustomerId = customerId || scopeCheck.resolvedCustomerId || null;
  const effectiveProjectId = projectId || scopeCheck.resolvedProjectId || null;

  // Dedup check: same externalOrderId + source=PINGOODMICE_ORDER can only generate once
  if (externalOrderId && source === "PINGOODMICE_ORDER") {
    const existing = await prisma.financeReceipt.findFirst({
      where: { externalOrderId, source: "PINGOODMICE_ORDER" },
    });
    if (existing) {
      return NextResponse.json({ error: "该拼好鼠订单已生成回款记录" }, { status: 409 });
    }
  }

  const receipt = await prisma.financeReceipt.create({
    data: {
      customerId: effectiveCustomerId,
      projectId: effectiveProjectId,
      externalOrderId: externalOrderId || null,
      projectInvoiceId: projectInvoiceId || null,
      externalOrderInvoiceRequestId: externalOrderInvoiceRequestId || null,
      amount,
      receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
      source: source || "MANUAL",
      remark: remark || null,
      createdById: session.user.id,
    },
    include: {
      customer: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(receipt, { status: 201 });
}
